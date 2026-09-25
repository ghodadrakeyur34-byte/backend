import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { getSupabaseInstance } from './db.js';

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'property-images';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

let bucketChecked = false;

/**
 * Ensures the Supabase Storage bucket exists and is public.
 */
export async function ensureBucket() {
  if (bucketChecked) return true;
  const supabase = getSupabaseInstance();
  if (!supabase) {
    console.warn('[Storage] Supabase client not initialized.');
    return false;
  }

  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.warn('[Storage] Error listing buckets:', error.message);
      return false;
    }

    const exists = buckets?.some((b) => b.name === STORAGE_BUCKET);
    if (!exists) {
      console.log(`[Storage] Creating public bucket "${STORAGE_BUCKET}" in Supabase...`);
      const { error: createErr } = await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES)
      });
      if (createErr) {
        console.warn(`[Storage] Warning creating bucket "${STORAGE_BUCKET}":`, createErr.message);
      } else {
        console.log(`[Storage] Bucket "${STORAGE_BUCKET}" created successfully.`);
      }
    }
    bucketChecked = true;
    return true;
  } catch (err) {
    console.warn('[Storage] Bucket check error:', err.message);
    return false;
  }
}

/**
 * Validates actual file content magic bytes.
 */
export async function validateImageBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file content.' };
  }

  const typeResult = await fileTypeFromBuffer(buffer);
  if (!typeResult) {
    return { valid: false, error: 'Unable to determine file type from magic bytes. File may be corrupt or invalid.' };
  }

  if (!ALLOWED_MIME_TYPES.has(typeResult.mime)) {
    return {
      valid: false,
      error: `Invalid file type "${typeResult.mime}". Only JPEG, PNG, GIF, and WebP images are allowed.`
    };
  }

  return { valid: true, mime: typeResult.mime, ext: typeResult.ext };
}

/**
 * Uploads an image Buffer directly to Supabase Storage (never to local disk).
 * Returns the public CDN/Storage URL.
 */
export async function uploadImageToSupabase(buffer, prefix = 'prop') {
  const supabase = getSupabaseInstance();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured. Missing SUPABASE_KEY in environment.');
  }

  await ensureBucket();

  const validation = await validateImageBuffer(buffer);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const fileName = `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${validation.ext}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, buffer, {
      contentType: validation.mime,
      upsert: false
    });

  if (uploadError) {
    console.error('[Storage] Supabase upload failed:', uploadError);
    throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(fileName);

  if (!urlData || !urlData.publicUrl) {
    throw new Error('Failed to retrieve public URL from Supabase Storage.');
  }

  return urlData.publicUrl;
}

/**
 * Converts a base64 Data URL to a buffer and uploads directly to Supabase Storage.
 * If already a remote URL (http/https), returns it as-is.
 */
export async function uploadBase64Image(dataUri, prefix = 'prop') {
  if (!dataUri || typeof dataUri !== 'string') return null;

  // Already a remote URL
  if (dataUri.startsWith('http://') || dataUri.startsWith('https://')) {
    return dataUri;
  }

  if (!dataUri.startsWith('data:')) {
    return null;
  }

  const parts = dataUri.split(',');
  if (parts.length < 2) {
    return null;
  }

  const buffer = Buffer.from(parts[1], 'base64');
  return uploadImageToSupabase(buffer, prefix);
}

/**
 * Processes an array of images (which may contain base64 strings or URLs),
 * uploads any base64 images directly to Supabase Storage in parallel,
 * and returns an array of resulting public image URLs.
 */
export async function processListingImages(images = [], prefix = 'prop') {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }

  const results = await Promise.all(
    images.map(async (img) => {
      if (typeof img !== 'string') return null;
      if (img.startsWith('http://') || img.startsWith('https://')) {
        return img;
      }
      if (img.startsWith('data:')) {
        try {
          return await uploadBase64Image(img, prefix);
        } catch (err) {
          console.error('[Storage] Failed to upload base64 image to Supabase:', err.message);
          return null;
        }
      }
      return null;
    })
  );

  return results.filter(Boolean);
}

/**
 * Deletes an image from Supabase Storage by its public URL or path.
 */
export async function deleteStorageImage(imageUrlOrPath) {
  if (!imageUrlOrPath || typeof imageUrlOrPath !== 'string') return;
  const supabase = getSupabaseInstance();
  if (!supabase) return;

  try {
    let filePath = imageUrlOrPath;
    const bucketMarker = `/${STORAGE_BUCKET}/`;
    if (filePath.includes(bucketMarker)) {
      filePath = filePath.split(bucketMarker)[1];
    } else if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      // Not a Supabase storage URL for this bucket
      return;
    }

    if (filePath) {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      console.log(`[Storage] Deleted image "${filePath}" from Supabase Storage.`);
    }
  } catch (err) {
    console.warn('[Storage] Error deleting image from Supabase:', err.message);
  }
}
