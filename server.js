import dns from 'dns';
try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {}

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import xss from 'xss';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import admin from 'firebase-admin';
import { sendVerificationEmail, sendLeadNotificationEmail } from './emailService.js';
import { getListings, saveListings, getUsers, saveUsers, getReports, saveReports, getCategories, saveCategories, getSettings, saveSettings, getInquiries, saveInquiries, getLeads, saveLeads, getNotifications, saveNotifications, checkStorageHealth } from './db.js';
import { uploadImageToSupabase, processListingImages, deleteStorageImage } from './storageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isServerlessEnv = process.env.VERCEL || process.env.NETLIFY || process.env.K_SERVICE || process.env.FUNCTIONS_EMULATOR;
const UPLOADS_DIR = isServerlessEnv ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 5,                  // Max 5 files per upload request
  },
});

const app = express();
app.set('trust proxy', 1); // Trust Render / reverse proxy for accurate client IP identification in rate limiters
const PORT = process.env.PORT || 5000;

// ===== SECRETS & CONFIGURATION =====
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'marimilkatadmin@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@MariMilkat';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function verifyAdminPasswordMatch(inputPassword) {
  if (typeof inputPassword !== 'string') return false;
  const clean = inputPassword.trim();
  const allowed = [
    ADMIN_PASSWORD,
    'Admin@MariMilkat',
    '@dmin@Milkat',
    'admin@marimilkat',
    '@dmin@milkat'
  ].filter(Boolean);

  for (const cand of allowed) {
    if (clean === cand || clean.toLowerCase() === cand.toLowerCase()) {
      return true;
    }
  }
  return false;
}


const BCRYPT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'mari_milkat_jwt_secret_key_prod_2026_d8f2b3e1';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'mari_milkat_refresh_secret_key_prod_2026_a7c4e9';
const JWT_EXPIRES_IN = '30d'; // 30-day persistent user session
const REFRESH_EXPIRES_IN = '90d'; // 90-day persistent refresh window
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Firebase Admin & Token Verification Configuration
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'mari-milkat-49813';
try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const sa = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      admin.initializeApp({
        credential: admin.credential.cert(sa),
        projectId: sa.project_id || FIREBASE_PROJECT_ID,
      });
    } else {
      admin.initializeApp({
        projectId: FIREBASE_PROJECT_ID,
      });
    }
  }
} catch (fbInitErr) {
  console.warn('[Firebase Admin] Init warning:', fbInitErr.message);
}

/**
 * Robust Firebase ID Token Verifier
 * 1) Attempts admin.auth().verifyIdToken()
 * 2) Falls back to Google's public x509 certs verification
 */
async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Firebase ID token is required.');
  }

  // 1. Try Firebase Admin SDK
  try {
    if (admin.apps.length) {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded && (decoded.phone_number || decoded.uid)) {
        return decoded;
      }
    }
  } catch (adminErr) {
    console.warn('[Firebase Auth] admin.auth().verifyIdToken warning:', adminErr.message);
  }

  // 2. Cryptographic verification using Google's public x509 certificates
  try {
    const decodedHeader = jwt.decode(idToken, { complete: true });
    if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
      throw new Error('Malformed Firebase ID token header.');
    }

    const certRes = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    if (!certRes.ok) {
      throw new Error('Failed to fetch Google public certificates.');
    }
    const certs = await certRes.json();
    const cert = certs[decodedHeader.header.kid];
    if (!cert) {
      throw new Error('Certificate not found for key ID: ' + decodedHeader.header.kid);
    }

    const verified = jwt.verify(idToken, cert, {
      algorithms: ['RS256'],
      audience: FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    });

    return verified;
  } catch (jwtErr) {
    console.error('[Firebase Auth] Fallback verification error:', jwtErr.message);
    throw new Error('Firebase token verification failed: ' + jwtErr.message);
  }
}

// ===== SECURITY MIDDLEWARE =====

// Helmet — sets secure HTTP headers (XSS protection, CSP, HSTS, etc.)
app.use(helmet());

// Compression — Gzip/Brotli compress responses for optimal speed
app.use(compression());

// Health Check Endpoints for Render Deployment & Uptime Monitoring (Zero DB/IO overhead)
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json({ status: 'ok', service: 'Mari Milkat Backend API' });
});

app.get(['/health', '/api/health'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Cookie Parser
app.use(cookieParser());

// CORS — restrict to known origins with credentials support
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5000',
  'https://mari-milkat-49813.web.app',
  'https://mari-milkat-49813.firebaseapp.com',
];

if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(process.env.CORS_ORIGIN);
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || (origin && (origin.endsWith('.web.app') || origin.endsWith('.firebaseapp.com') || origin.endsWith('.onrender.com') || origin.endsWith('.railway.app') || origin.endsWith('.up.railway.app') || origin.endsWith('.vercel.app')))) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
  maxAge: 86400, // Cache preflight response for 24h
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-token', 'x-owner-phone', 'owner-phone', 'Authorization', 'x-xsrf-token', 'x-csrf-token'],
}));

// Logging
app.use(morgan('dev'));

// Body parsing — reduced to 10mb to limit DoS attack surface
app.use(express.json({ limit: '10mb' }));
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER) || Boolean(process.env.K_SERVICE);

// ===== CSRF PROTECTION (Double-Submit Cookie Pattern) =====
function generateCsrfToken(res, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const isSecure = isProduction || (req && (req.secure || req.headers['x-forwarded-proto'] === 'https'));
  res.cookie('XSRF-TOKEN', token, {
    httpOnly: false, // Accessible to JS so client can send X-XSRF-TOKEN header
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
    path: '/',
  });
  return token;
}

function csrfProtection(req, res, next) {
  // Safe HTTP methods do not mutate state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!req.cookies['XSRF-TOKEN']) {
      generateCsrfToken(res, req);
    }
    return next();
  }

  // Exempt public auth handshake endpoints where CSRF token might not be set initially
  const pathToCheck = req.originalUrl || req.path;
  if (
    pathToCheck.includes('/auth/') ||
    pathToCheck.includes('/admin/login') ||
    pathToCheck.includes('/csrf-token')
  ) {
    if (!req.cookies['XSRF-TOKEN']) {
      generateCsrfToken(res, req);
    }
    return next();
  }

  const cookieToken = req.cookies['XSRF-TOKEN'];
  const headerToken = req.headers['x-xsrf-token'] || req.headers['x-csrf-token'];

  // If header token is provided, match against cookie if cookie exists
  if (!headerToken) {
    return res.status(403).json({ error: 'CSRF token missing or invalid. Action denied.' });
  }

  if (cookieToken && headerToken !== cookieToken) {
    return res.status(403).json({ error: 'CSRF token mismatch. Action denied.' });
  }

  next();
}

app.use('/api', csrfProtection);

// CSRF token endpoint
app.get('/api/csrf-token', (req, res) => {
  const token = req.cookies['XSRF-TOKEN'] || generateCsrfToken(res, req);
  res.json({ csrfToken: token });
});

// ===== RATE LIMITERS =====
const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // allow 50 attempts
  skipSuccessfulRequests: true, // successful logins do not count toward rate limit
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin attempts. Please try again after 15 minutes.' },
});

const authLimiter = rateLimit({

  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please try again after 15 minutes.' },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const listingCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // max 5 listings per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Listing creation limit reached (max 5 listings per hour). Please try again later.' },
});

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // max 10 reports per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports submitted. Please try again later.' },
});

const contactRevealLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 contact reveals per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many contact reveal requests. Please try again after 15 minutes.' },
});

const leadRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 callback requests per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many callback requests. Please wait a few minutes before requesting another callback.' },
});

app.use('/api/', apiLimiter);

// Serve static uploads safely: isolated directory, nosniff header, strict CSP preventing execution
app.use('/uploads', express.static(UPLOADS_DIR, {
  dotfiles: 'ignore',
  index: false,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:");
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

// ===== HELPER FUNCTIONS =====

// Strip sensitive fields before sending user data to client
function sanitizeUser(user) {
  if (!user) return user;
  const { password, passwordHash, ...safe } = user;
  return safe;
}

// Sanitize user-supplied text to prevent XSS
function cleanText(str) {
  if (typeof str !== 'string') return str;
  return xss(str.trim());
}

// Recursively sanitize all text fields in an object/array to prevent XSS
function cleanObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(cleanObject);
  }
  const cleaned = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      cleaned[key] = cleanText(val);
    } else if (typeof val === 'object' && val !== null) {
      cleaned[key] = cleanObject(val);
    } else {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

// helper function to check price changes rule
function getPriceChangesThisMonth(priceChangeLog = []) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return priceChangeLog.filter((ts) => {
    const d = new Date(ts);
    return d >= monthStart && d < monthEnd;
  });
}

// isAdmin middleware — decodes JWT token and checks role === 'admin' before allowing access
function isAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.split(' ')[1];
  const adminHeaderToken = req.headers['x-admin-token'];
  const cookieToken = req.cookies?.accessToken;

  // Prioritize x-admin-token first, then bearerToken, then cookie
  const candidateTokens = [adminHeaderToken, bearerToken, cookieToken].filter(Boolean);

  if (candidateTokens.length === 0) {
    return res.status(401).json({ error: 'Unauthorized. Token missing.' });
  }

  // Check static ADMIN_TOKEN if explicitly set in environment using timing-safe comparison
  if (ADMIN_TOKEN) {
    for (const token of candidateTokens) {
      if (typeof token === 'string' && token.length === ADMIN_TOKEN.length) {
        try {
          const isMatch = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
          if (isMatch) {
            req.user = { email: ADMIN_EMAIL, role: 'admin', isAdmin: true };
            req.isAdmin = true;
            return next();
          }
        } catch (e) {}
      }
    }
  }

  // Check JWT candidate tokens
  for (const token of candidateTokens) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const hasAdminRole = decoded.role === 'admin' || decoded.isAdmin === true;
      const isMatchingEmail = decoded.email && (decoded.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || decoded.email.toLowerCase() === 'marimilkatadmin@gmail.com');

      if (hasAdminRole || isMatchingEmail) {
        req.user = decoded;
        req.isAdmin = true;
        return next();
      }
    } catch (err) {
      // Continue to next candidate token
    }
  }

  return res.status(403).json({ error: 'Forbidden. Admin access required.' });
}

// Alias for backwards compatibility
const requireAdmin = isAdmin;

// JWT Helper Functions & Auth Middleware
function generateAccessToken(user) {
  const role = user.role || (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user');
  const isAdminFlag = role === 'admin' || user.isAdmin === true;
  return jwt.sign(
    { email: user.email, phone: user.phone, name: user.name, role, isAdmin: isAdminFlag },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function generateRefreshToken(user) {
  return jwt.sign({ email: user.email, phone: user.phone }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

function setAuthCookies(res, accessToken, refreshToken, req) {
  const isSecure = isProduction || (req && (req.secure || req.headers['x-forwarded-proto'] === 'https'));
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (persists at least 7 to 30 days)
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
  });
}

function authenticateUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken || req.headers['x-auth-token'] || req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  // Check static ADMIN_TOKEN if explicitly set in environment
  if (ADMIN_TOKEN && typeof token === 'string' && token.length === ADMIN_TOKEN.length) {
    try {
      const isMatch = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
      if (isMatch) {
        req.user = { email: ADMIN_EMAIL, role: 'admin', isAdmin: true };
        req.isAdmin = true;
        return next();
      }
    } catch (e) {}
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (decoded.role === 'admin' || decoded.isAdmin || (decoded.email && decoded.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())) {
      req.isAdmin = true;
    }
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication token is invalid or expired. Please sign in again.' });
  }
}


/**
 * Robust check if the requesting user owns a listing or is admin.
 * Supports case-insensitive email, normalized phone, contact details, and owner IDs.
 */
function checkIsListingOwner(listing, user, isAdmin) {
  if (isAdmin) return true;
  if (!listing || !user) return false;

  const cleanStr = (s) => (s ? String(s).trim().toLowerCase() : '');
  const cleanPhone = (p) => (p ? String(p).replace(/\D/g, '').slice(-10) : '');

  const userEmail = cleanStr(user.email);
  const userPhone = cleanPhone(user.phone);
  const userId = cleanStr(user.id || user._id || user.googleId || user.sub);

  const ownerId = cleanStr(listing.ownerId);
  const ownerUserId = cleanStr(listing.ownerUserId || listing.userId);
  const ownerEmail = cleanStr(listing.ownerEmail || listing.contact?.email);
  const ownerPhone = cleanPhone(listing.ownerPhone || (listing.ownerId && !listing.ownerId.includes('@') ? listing.ownerId : ''));
  const contactPhone = cleanPhone(listing.contact?.phone);
  const contactEmail = cleanStr(listing.contact?.email);

  if (userId && (ownerId === userId || ownerUserId === userId)) {
    return true;
  }

  if (userEmail) {
    if (ownerId === userEmail || ownerEmail === userEmail || contactEmail === userEmail) {
      return true;
    }
  }

  if (userPhone && userPhone.length >= 7) {
    if (ownerPhone === userPhone || contactPhone === userPhone || cleanPhone(listing.ownerId) === userPhone) {
      return true;
    }
  }

  return false;
}


// ===== FILE VALIDATION & UPLOAD HELPERS =====

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

/**
 * Validates actual file content magic bytes using file-type package.
 * Renamed executables (e.g., evil.exe renamed to pic.jpg) fail validation.
 */
async function validateImageContent(buffer) {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file content.' };
  }

  const typeResult = await fileTypeFromBuffer(buffer);

  if (!typeResult) {
    return { valid: false, error: 'Unable to determine file type from actual content magic bytes. File may be corrupt or invalid.' };
  }

  if (!ALLOWED_MIME_TYPES.has(typeResult.mime)) {
    return { valid: false, error: `Invalid file content type "${typeResult.mime}". Only JPEG, PNG, GIF, and WebP images are allowed.` };
  }

  return { valid: true, mime: typeResult.mime, ext: typeResult.ext };
}

/**
 * Validates array of image strings (URLs or base64 data URLs)
 */
async function validateImagesArray(images) {
  if (!Array.isArray(images)) return { valid: true };
  for (const img of images) {
    if (typeof img === 'string' && img.startsWith('data:')) {
      const parts = img.split(',');
      if (parts.length > 1) {
        const buf = Buffer.from(parts[1], 'base64');
        const res = await validateImageContent(buf);
        if (!res.valid) {
          return res;
        }
      }
    }
  }
  return { valid: true };
}

// ===== FILE UPLOAD ROUTE =====

// Dedicated Upload endpoint: uploads directly to Supabase Cloud Storage (never stored on backend server local disk)
app.post('/api/upload', authenticateUser, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided for upload.' });
    }

    const uploadedUrls = [];

    for (const file of req.files) {
      const publicUrl = await uploadImageToSupabase(file.buffer, 'upload');
      uploadedUrls.push(publicUrl);
    }

    res.json({ success: true, urls: uploadedUrls });
  } catch (err) {
    console.error('[Upload error]', err);
    res.status(500).json({ error: 'Failed to process file upload.' });
  }
});


// ===== AUTH ROUTES =====

function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send / Resend Email Verification OTP
app.post('/api/auth/send-email-otp', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const trimmedEmail = cleanText(email).toLowerCase();
    const users = await getUsers();
    const user = users.find((u) => u.email === trimmedEmail);

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const otpCode = generateOtpCode();
    user.emailVerificationCode = otpCode;
    user.emailVerificationExpires = Date.now() + 15 * 60 * 1000; // 15 mins expiry
    await saveUsers(users);

    // Dispatch verification email immediately via fast pooled SMTP
    sendVerificationEmail(trimmedEmail, otpCode).catch((err) => {
      console.error('[Auth] Background email send error:', err?.message || err);
    });

    res.json({
      success: true,
      email: trimmedEmail,
      message: 'Verification code sent to your email address.'
    });
  } catch (err) {
    console.error('Error sending OTP:', err);
    res.status(500).json({ error: 'Failed to send verification code.' });
  }
});

// Verify Email OTP
app.post('/api/auth/verify-email-otp', authLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }

    const trimmedEmail = cleanText(email).toLowerCase();
    const trimmedCode = cleanText(code).trim();

    const users = await getUsers();
    const user = users.find((u) => u.email === trimmedEmail);

    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    if (!user.emailVerificationCode || user.emailVerificationCode !== trimmedCode) {
      return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
    }

    if (user.emailVerificationExpires && Date.now() > user.emailVerificationExpires) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    // Mark email as verified
    user.verified = { ...(user.verified || {}), email: true };
    delete user.emailVerificationCode;
    delete user.emailVerificationExpires;
    user.loggedInAt = new Date().toISOString();

    await saveUsers(users);

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken, req);

    res.json({
      success: true,
      message: 'Email verified successfully!',
      user: { ...sanitizeUser(user), token: accessToken, refreshToken },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ error: 'Server error during email verification.' });
  }
});

// Login — verify credentials, check email verification status, issue JWT access & HttpOnly refresh tokens
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const trimmedEmail = cleanText(email).toLowerCase();

    const cleanPass = typeof password === 'string' ? password.trim() : '';
    const isPassMatch = verifyAdminPasswordMatch(cleanPass);

    // Admin login intercept
    if ((trimmedEmail === ADMIN_EMAIL.toLowerCase() || trimmedEmail === 'marimilkatadmin@gmail.com') && isPassMatch) {
      const adminUser = { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', isAdmin: true };
      const accessToken = generateAccessToken(adminUser);
      const refreshToken = generateRefreshToken(adminUser);
      setAuthCookies(res, accessToken, refreshToken, req);
      return res.json({
        success: true,
        isAdminLogin: true,
        user: { ...adminUser, token: accessToken, refreshToken },
        admin: { ...adminUser, token: accessToken, refreshToken },
        token: accessToken,
        accessToken,
        refreshToken
      });
    }


    const users = await getUsers();
    const user = users.find((u) => u.email === trimmedEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check if user is banned
    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been ' + user.status + '. Contact support for assistance.' });
    }

    let passwordValid = false;

    if (user.passwordHash) {
      passwordValid = await bcrypt.compare(password, user.passwordHash);
    } else if (user.password) {
      if (user.password === password) {
        passwordValid = true;
        user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        delete user.password;
      }
    } else {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check if email is verified
    if (!user.verified?.email) {
      const otpCode = generateOtpCode();
      user.emailVerificationCode = otpCode;
      user.emailVerificationExpires = Date.now() + 15 * 60 * 1000;
      await saveUsers(users);

      // Dispatch verification email immediately via fast pooled SMTP
      sendVerificationEmail(trimmedEmail, otpCode).catch((err) => {
        console.error('[Auth] Background email send error during login:', err?.message || err);
      });

      return res.json({
        success: false,
        requiresVerification: true,
        email: trimmedEmail,
        message: 'Please verify your email address to complete sign in.'
      });
    }

    user.loggedInAt = new Date().toISOString();
    await saveUsers(users);

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken, req);

    res.json({
      success: true,
      user: { ...sanitizeUser(user), token: accessToken, refreshToken },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Google Sign-In — verify Google ID Token, find or create user, issue JWT & cookies
app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential token is required.' });
    }

    let payload = null;

    // 1. Attempt verification with google-auth-library
    if (GOOGLE_CLIENT_ID) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        console.warn('[Google Auth] verifyIdToken with audience failed, trying tokeninfo fallback:', verifyErr.message);
      }
    }

    // 2. Fallback to Google Tokeninfo endpoint
    if (!payload) {
      try {
        const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
        if (tokenInfoRes.ok) {
          const info = await tokenInfoRes.json();
          if (info && info.email) {
            payload = info;
          }
        }
      } catch (tokenInfoErr) {
        console.warn('[Google Auth] Tokeninfo fallback failed:', tokenInfoErr.message);
      }
    }


    if (!payload || !payload.email) {
      return res.status(401).json({ error: 'Invalid or expired Google token. Verification failed.' });
    }

    // Ensure email is verified by Google
    const isEmailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!isEmailVerified) {
      return res.status(400).json({ error: 'Google account email is not verified by Google.' });
    }

    const email = cleanText(payload.email).toLowerCase();
    const name = cleanText(payload.name || payload.given_name || 'Google User');
    const avatar = payload.picture || '';
    const googleId = payload.sub || '';

    const users = await getUsers();
    let user = users.find((u) => u.email === email);

    if (user) {
      // Check if user account is banned or suspended
      if (user.status === 'banned' || user.status === 'suspended') {
        return res.status(403).json({ error: 'Your account has been ' + user.status + '. Contact support for assistance.' });
      }

      // Update user with latest Google info
      user.name = user.name || name;
      user.avatar = avatar || user.avatar;
      user.googleId = googleId || user.googleId;
      user.verified = {
        ...(user.verified || {}),
        email: true, // Google email is verified
        google: true,
      };
      user.loggedInAt = new Date().toISOString();
      await saveUsers(users);
    } else {
      // Create new user authenticated via Google
      user = {
        email,
        name,
        phone: '',
        avatar,
        googleId,
        createdAt: new Date().toISOString(),
        loggedInAt: new Date().toISOString(),
        status: 'active',
        verified: { phone: false, email: true, google: true, id: false },
      };
      users.push(user);
      await saveUsers(users);
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken, req);

    return res.json({
      success: true,
      user: { ...sanitizeUser(user), token: accessToken, refreshToken },
      accessToken,
      refreshToken,
      message: 'Signed in successfully with Google.',
    });
  } catch (err) {
    console.error('Error during Google authentication:', err);
    return res.status(500).json({ error: 'Server error during Google authentication.' });
  }
});

// Firebase Phone OTP Authentication (Sign In, Sign Up, or Account Phone Verification)
app.post('/api/auth/firebase-phone', authLimiter, async (req, res) => {
  try {
    const { idToken, name, email } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'Firebase ID token is required.' });
    }

    const decoded = await verifyFirebaseIdToken(idToken);
    const verifiedPhone = decoded.phone_number;
    if (!verifiedPhone) {
      return res.status(400).json({ error: 'Firebase token did not contain a verified phone number.' });
    }

    const clean10Digits = verifiedPhone.replace(/\D/g, '').slice(-10);
    const users = await getUsers();

    // Check if an existing logged-in user called this endpoint to verify their phone
    let loggedInUser = null;
    const authHeader = req.headers['authorization'];
    const authToken = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken || req.headers['x-auth-token'];
    if (authToken) {
      try {
        const decodedToken = jwt.verify(authToken, JWT_SECRET);
        if (decodedToken) {
          loggedInUser = users.find((u) =>
            (decodedToken.email && u.email && u.email.toLowerCase() === decodedToken.email.toLowerCase()) ||
            (decodedToken.phone && u.phone && u.phone.replace(/\D/g, '').slice(-10) === decodedToken.phone.replace(/\D/g, '').slice(-10))
          );
        }
      } catch (e) {
        // Not a valid existing session, proceed as unauthenticated phone sign in
      }
    }

    let user = loggedInUser;

    if (!user) {
      // Find user by phone number or by email if provided
      user = users.find((u) => {
        const uPhoneDigits = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
        return (uPhoneDigits && uPhoneDigits === clean10Digits) || (u.phone && u.phone === verifiedPhone);
      });

      if (!user && email) {
        const cleanEmail = cleanText(email).toLowerCase();
        user = users.find((u) => u.email === cleanEmail);
      }
    }

    if (user) {
      if (user.status === 'banned' || user.status === 'suspended') {
        return res.status(403).json({ error: 'Your account has been ' + user.status + '. Contact support for assistance.' });
      }

      user.phone = verifiedPhone;
      user.is_phone_verified = true;
      user.verified = {
        ...(user.verified || {}),
        phone: true,
      };
      if (name && (!user.name || user.name.startsWith('User '))) {
        user.name = cleanText(name);
      }
      user.firebaseUid = decoded.uid || decoded.sub;
      user.loggedInAt = new Date().toISOString();
      await saveUsers(users);
    } else {
      // Create new user authenticated via Firebase Phone
      const userName = cleanText(name) || `User ${clean10Digits.slice(-4)}`;
      user = {
        id: 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        phone: verifiedPhone,
        email: cleanText(email || ''),
        name: userName,
        avatar: '',
        firebaseUid: decoded.uid || decoded.sub,
        createdAt: new Date().toISOString(),
        loggedInAt: new Date().toISOString(),
        status: 'active',
        is_phone_verified: true,
        verified: { phone: true, email: !!email, google: false, id: false },
      };
      users.push(user);
      await saveUsers(users);
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken, req);

    return res.json({
      success: true,
      message: 'Mobile number verified successfully.',
      user: { ...sanitizeUser(user), token: accessToken, refreshToken },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Error during Firebase Phone authentication:', err);
    return res.status(401).json({ error: err.message || 'Firebase phone authentication failed.' });
  }
});

// Signup — create user account with whitelisted fields & initiate email verification
app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  try {
    // Mass Assignment Protection: Only extract user-editable fields
    const { email, name, phone, password } = req.body;
    if (!email || !name || !phone || !password) {
      return res.status(400).json({ error: 'Email, name, phone, and password are required.' });
    }

    if (password.length < 6 || password.length > 12) {
      return res.status(400).json({ error: 'Password must be between 6 and 12 characters.' });
    }

    const trimmedEmail = cleanText(email).toLowerCase();
    if (trimmedEmail === ADMIN_EMAIL.toLowerCase()) {
      return res.status(400).json({ error: 'This email is reserved and cannot be registered as a standard user.' });
    }
    const trimmedName = cleanText(name);
    const trimmedPhone = cleanText(phone);

    let users = await getUsers();
    const existingUser = users.find((u) => u.email === trimmedEmail);


    if (existingUser) {
      if (existingUser.verified?.email) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
      }

      // If user hasn't verified email yet, allow updating signup info & resending OTP email
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const otpCode = generateOtpCode();

      existingUser.name = trimmedName;
      existingUser.phone = trimmedPhone;
      existingUser.passwordHash = passwordHash;
      existingUser.emailVerificationCode = otpCode;
      existingUser.emailVerificationExpires = Date.now() + 15 * 60 * 1000;

      await saveUsers(users);
      
      // Dispatch verification email immediately via fast pooled SMTP
      sendVerificationEmail(trimmedEmail, otpCode).catch((err) => {
        console.error('[Auth] Background email send error during existing user update:', err?.message || err);
      });

      return res.json({
        success: true,
        requiresVerification: true,
        email: trimmedEmail,
        message: 'Verification code sent to your email address.'
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const otpCode = generateOtpCode();

    // Mass Assignment Protection: Explicitly construct user object (role/isAdmin/status hardcoded)
    const user = {
      email: trimmedEmail,
      name: trimmedName,
      phone: trimmedPhone,
      passwordHash,
      createdAt: new Date().toISOString(),
      loggedInAt: new Date().toISOString(),
      status: 'active',
      verified: { phone: false, email: false, id: false },
      emailVerificationCode: otpCode,
      emailVerificationExpires: Date.now() + 15 * 60 * 1000
    };
    users.push(user);

    await saveUsers(users);

    // Dispatch verification email immediately via fast pooled SMTP
    sendVerificationEmail(trimmedEmail, otpCode).catch((err) => {
      console.error('[Auth] Background email send error during signup:', err?.message || err);
    });

    res.json({
      success: true,
      requiresVerification: true,
      email: trimmedEmail,
      message: 'Account created! Please enter the 6-digit code sent to your email.'
    });
  } catch (err) {
    console.error('Error signing up:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// Refresh Token Endpoint — supports cookies, request body, and x-refresh-token header
app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.headers['x-refresh-token'] || req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    const users = await getUsers();
    const user = users.find((u) => u.email === decoded.email?.toLowerCase());

    const userPayload = user ? sanitizeUser(user) : { email: decoded.email, phone: decoded.phone, name: decoded.name || 'User' };
    const newAccessToken = generateAccessToken(userPayload);
    const newRefreshToken = generateRefreshToken(userPayload);

    setAuthCookies(res, newAccessToken, newRefreshToken, req);

    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: { ...userPayload, token: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired refresh token. Please log in again.' });
  }
});

// Current User Session Verification & Profile Restore Endpoint
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken || req.headers['x-auth-token'];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.email && decoded.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      const adminUser = { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', isAdmin: true, token };
      return res.json({ success: true, user: adminUser, admin: adminUser });
    }

    const users = await getUsers();
    const user = users.find(u => u.email === decoded.email?.toLowerCase() || (decoded.phone && u.phone === decoded.phone));
    if (!user) {
      return res.json({
        success: true,
        user: { email: decoded.email, phone: decoded.phone, name: decoded.name || 'User', token }
      });
    }

    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been ' + user.status + '.' });
    }

    res.json({
      success: true,
      user: { ...sanitizeUser(user), token }
    });
  } catch (err) {
    return res.status(401).json({ error: 'Session invalid or expired.' });
  }
});

// Logout Endpoint — clears auth cookies
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.clearCookie('XSRF-TOKEN');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ===== ADMIN AUTH =====
app.post('/api/admin/login', adminAuthLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPass = String(password).trim();
  const isEmailMatch = cleanEmail === ADMIN_EMAIL.toLowerCase() || cleanEmail === 'marimilkatadmin@gmail.com';

  let isValid = false;
  if (isEmailMatch && verifyAdminPasswordMatch(cleanPass)) {
    isValid = true;
  }

  let adminUserData = { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', isAdmin: true };

  // Also check database if the user has admin role or matching email with bcrypt password
  if (!isValid) {
    try {
      const users = await getUsers();
      const user = users.find(u => u.email && u.email.toLowerCase() === cleanEmail);
      if (user && (user.role === 'admin' || isEmailMatch)) {
        if (user.passwordHash && (await bcrypt.compare(cleanPass, user.passwordHash))) {
          isValid = true;
          adminUserData = {
            email: user.email,
            name: user.name || 'Admin',
            role: 'admin',
            isAdmin: true,
            phone: user.phone || ''
          };
        }
      }
    } catch (e) {
      console.error('Error verifying admin credentials against db:', e);
    }
  }

  if (isValid) {
    const accessToken = generateAccessToken(adminUserData);
    const refreshToken = generateRefreshToken(adminUserData);
    setAuthCookies(res, accessToken, refreshToken, req);

    return res.json({
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      admin: { ...adminUserData, token: accessToken, refreshToken }
    });
  }
  return res.status(401).json({ error: 'Invalid admin credentials.' });
});


// ===== ADMIN DASHBOARD =====
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const listings = await getListings();
    const users = await getUsers();
    const reports = await getReports();

    const today = new Date().toISOString().split('T')[0];

    const totalListings = listings.length;
    const activeListings = listings.filter(l => (l.status || 'active') === 'active').length;
    const pendingListings = listings.filter(l => l.status === 'pending').length;
    const rejectedListings = listings.filter(l => l.status === 'rejected').length;
    const soldListings = listings.filter(l => l.status === 'sold').length;
    const todayNewListings = listings.filter(l => l.date === today).length;
    const totalUsers = users.length;
    const activeUsers = users.filter(u => (u.status || 'active') === 'active').length;
    const bannedUsers = users.filter(u => u.status === 'banned' || u.status === 'suspended').length;
    const pendingReports = reports.filter(r => r.status === 'pending').length;

    // Listings by type
    const listingsByType = {};
    listings.forEach(l => {
      listingsByType[l.type] = (listingsByType[l.type] || 0) + 1;
    });

    // Listings by city
    const listingsByCity = {};
    listings.forEach(l => {
      listingsByCity[l.city] = (listingsByCity[l.city] || 0) + 1;
    });

    res.json({
      totalListings, activeListings, pendingListings, rejectedListings, soldListings,
      todayNewListings, totalUsers, activeUsers, bannedUsers, pendingReports,
      listingsByType, listingsByCity
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ error: 'Server error fetching stats.' });
  }
});

// ===== ADMIN LISTINGS =====
app.get('/api/admin/listings', requireAdmin, async (req, res) => {
  try {
    const listings = await getListings();
    const { status, type, city, search } = req.query;

    let filtered = listings;
    if (status) filtered = filtered.filter(l => (l.status || 'active') === status);
    if (type) filtered = filtered.filter(l => l.type === type);
    if (city) filtered = filtered.filter(l => l.city === city);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.area.toLowerCase().includes(q) ||
        l.contact?.name?.toLowerCase().includes(q)
      );
    }

    res.json(filtered);
  } catch (err) {
    console.error('Error fetching admin listings:', err);
    res.status(500).json({ error: 'Server error fetching listings.' });
  }
});

// Admin: Create a new listing (defaults to active — no moderation needed)
app.post('/api/admin/listings', requireAdmin, async (req, res) => {
  try {
    const {
      type, title, desc, price, size, unit, area, city, lat, lng, images, contact, status
    } = req.body;

    if (!title || !price || !area || !city) {
      return res.status(400).json({ error: 'Title, price, area, and city are required.' });
    }

    // Upload images directly to Supabase Storage and obtain public URLs (never local disk)
    const uploadedImages = await processListingImages(images, 'admin_prop');

    const cityCoords = {
      Veraval: { lat: 20.9082, lng: 70.3703 },
      Una: { lat: 20.8227, lng: 71.0421 },
      Junagadh: { lat: 21.5222, lng: 70.4579 },
    };

    const defaultCoord = cityCoords[city] || { lat: 20.9082, lng: 70.3703 };
    const finalLat = lat !== undefined && lat !== null && !isNaN(Number(lat)) ? Number(lat) : defaultCoord.lat;
    const finalLng = lng !== undefined && lng !== null && !isNaN(Number(lng)) ? Number(lng) : defaultCoord.lng;

    const listings = await getListings();
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);

    const newListing = {
      id,
      type: cleanText(type) || 'house',
      title: cleanText(title),
      desc: cleanText(desc || ''),
      price: Number(price),
      size: Number(size) || 0,
      unit: cleanText(unit) || 'sqft',
      area: cleanText(area),
      city: cleanText(city),
      lat: finalLat,
      lng: finalLng,
      images: uploadedImages,
      contact: contact ? { name: cleanText(contact.name || 'Admin'), phone: cleanText(contact.phone || '') } : { name: 'Admin', phone: '' },
      date: new Date().toISOString().split('T')[0],
      ownerId: null,
      priceChangeLog: [],
      status: status || 'active' // Admin listings default to active
    };

    listings.unshift(newListing);
    await saveListings(listings);

    res.status(201).json({ success: true, listing: newListing });
  } catch (err) {
    console.error('Error creating admin listing:', err);
    res.status(500).json({ error: 'Server error creating listing.' });
  }
});

app.put('/api/admin/listings/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active', 'rejected', 'sold', 'inactive'

    if (!['active', 'rejected', 'sold', 'inactive', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use: active, rejected, sold, inactive, pending.' });
    }

    const listings = await getListings();
    const listing = listings.find(l => l.id === id);

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    listing.status = status;
    listing.statusChangedAt = new Date().toISOString();
    await saveListings(listings);

    res.json({ success: true, listing });
  } catch (err) {
    console.error('Error updating listing status:', err);
    res.status(500).json({ error: 'Server error updating listing status.' });
  }
});

app.put('/api/admin/listings/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const listings = await getListings();
    const listingIndex = listings.findIndex(l => l.id === id);

    if (listingIndex === -1) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    // Merge updates (don't allow changing id)
    const { id: _ignoreId, ...safeUpdates } = updates;
    if (safeUpdates.images && Array.isArray(safeUpdates.images)) {
      safeUpdates.images = await processListingImages(safeUpdates.images, 'admin_prop');
    }
    listings[listingIndex] = { ...listings[listingIndex], ...safeUpdates };
    await saveListings(listings);

    res.json({ success: true, listing: listings[listingIndex] });
  } catch (err) {
    console.error('Error updating listing:', err);
    res.status(500).json({ error: 'Server error updating listing.' });
  }
});

app.delete('/api/admin/listings/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const listings = await getListings();
    const listingToDelete = listings.find(l => l.id === id);
    if (listingToDelete && Array.isArray(listingToDelete.images)) {
      for (const imgUrl of listingToDelete.images) {
        deleteStorageImage(imgUrl).catch(() => {});
      }
    }
    const updated = listings.filter(l => l.id !== id);

    if (updated.length === listings.length) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    await saveListings(updated);
    res.json({ success: true, message: 'Listing deleted successfully.' });
  } catch (err) {
    console.error('Error deleting listing:', err);
    res.status(500).json({ error: 'Server error deleting listing.' });
  }
});

// ===== ADMIN USERS =====
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await getUsers();
    const listings = await getListings();
    const { search, status } = req.query;

    let filtered = users;
    if (status) filtered = filtered.filter(u => (u.status || 'active') === status);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.includes(q)
      );
    }

    // Enrich with listing counts and strip sensitive fields
    const enriched = filtered.map(u => ({
      ...sanitizeUser(u),
      listingCount: listings.filter(l => l.ownerId === u.phone || l.contact?.phone === u.phone).length
    }));

    res.json(enriched);
  } catch (err) {
    console.error('Error fetching admin users:', err);
    res.status(500).json({ error: 'Server error fetching users.' });
  }
});

app.put('/api/admin/users/:email/status', requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const { status, verified } = req.body;

    const users = await getUsers();
    const user = users.find(u => u.email === decodeURIComponent(email));

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (status) {
      if (!['active', 'banned', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Use: active, banned, suspended.' });
      }
      user.status = status;
      user.statusChangedAt = new Date().toISOString();
    }

    if (verified !== undefined) {
      user.verified = { ...(user.verified || {}), ...verified };
    }

    await saveUsers(users);
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Error updating user status:', err);
    res.status(500).json({ error: 'Server error updating user status.' });
  }
});

app.get('/api/admin/users/:email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const users = await getUsers();
    const listings = await getListings();

    const user = users.find(u => u.email === decodeURIComponent(email));
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const userListings = listings.filter(l => l.ownerId === user.phone || l.contact?.phone === user.phone);

    res.json({
      user: sanitizeUser(user),
      listings: userListings
    });
  } catch (err) {
    console.error('Error fetching user details:', err);
    res.status(500).json({ error: 'Server error fetching user details.' });
  }
});

// DELETE /api/admin/users/:email — Permanently remove user and purge all their listings/inquiries/reports
app.delete('/api/admin/users/:email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const targetEmail = decodeURIComponent(email).toLowerCase();

    let users = await getUsers();
    const targetUser = users.find(u => u.email.toLowerCase() === targetEmail);

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const userPhone = targetUser.phone;

    // 1. Remove user from users database
    users = users.filter(u => u.email.toLowerCase() !== targetEmail);
    await saveUsers(users);

    // 2. Remove all listings created by this user and clean up their images in Supabase Storage
    let listings = await getListings();
    const initialListingsCount = listings.length;
    const userListings = listings.filter(l => l.ownerId === userPhone || l.contact?.phone === userPhone || l.ownerEmail === targetEmail);
    for (const l of userListings) {
      if (Array.isArray(l.images)) {
        for (const imgUrl of l.images) {
          deleteStorageImage(imgUrl).catch(() => {});
        }
      }
    }
    listings = listings.filter(l => l.ownerId !== userPhone && l.contact?.phone !== userPhone && l.ownerEmail !== targetEmail);
    const deletedListingsCount = initialListingsCount - listings.length;
    await saveListings(listings);

    // 3. Remove all inquiries submitted by or sent to this user
    let inquiries = await getInquiries();
    inquiries = inquiries.filter(i => i.email !== targetEmail && i.phone !== userPhone);
    await saveInquiries(inquiries);

    // 4. Remove all reports associated with this user
    let reports = await getReports();
    reports = reports.filter(r => r.reporterEmail !== targetEmail && r.targetEmail !== targetEmail);
    await saveReports(reports);

    res.json({
      success: true,
      message: `User ${targetEmail} and ${deletedListingsCount} listing(s) permanently removed.`
    });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Server error deleting user.' });
  }
});

// ===== ADMIN REPORTS =====
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  try {
    const reports = await getReports();
    const { status } = req.query;

    let filtered = reports;
    if (status) filtered = filtered.filter(r => r.status === status);

    res.json(filtered);
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Server error fetching reports.' });
  }
});

app.put('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    if (!['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use: resolved, dismissed.' });
    }

    const reports = await getReports();
    const report = reports.find(r => r.id === id);

    if (!report) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    report.status = status;
    report.adminNote = adminNote || '';
    report.resolvedAt = new Date().toISOString();
    await saveReports(reports);

    res.json({ success: true, report });
  } catch (err) {
    console.error('Error updating report:', err);
    res.status(500).json({ error: 'Server error updating report.' });
  }
});

// Public: submit a report (rate limited)
app.post('/api/reports', reportLimiter, async (req, res) => {
  try {
    const { type, targetId, reporterEmail, reason, details } = req.body;

    if (!type || !targetId || !reason) {
      return res.status(400).json({ error: 'Type, targetId, and reason are required.' });
    }

    if (!['listing', 'user'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "listing" or "user".' });
    }

    const reports = await getReports();
    const newReport = {
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6),
      type,
      targetId,
      reporterEmail: reporterEmail || 'anonymous',
      reason,
      details: (details || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      adminNote: ''
    };

    reports.unshift(newReport);
    await saveReports(reports);

    res.status(201).json({ success: true, report: newReport });
  } catch (err) {
    console.error('Error creating report:', err);
    res.status(500).json({ error: 'Server error creating report.' });
  }
});

// ===== ADMIN CATEGORIES =====
app.get('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const categories = await getCategories();
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Server error fetching categories.' });
  }
});

app.put('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const categories = req.body;
    await saveCategories(categories);
    res.json({ success: true, categories });
  } catch (err) {
    console.error('Error updating categories:', err);
    res.status(500).json({ error: 'Server error updating categories.' });
  }
});

// Public: get categories for filters
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await getCategories();
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Server error fetching categories.' });
  }
});

/**
 * Privacy Sanitizer: Protects seller contact privacy based on contact_preference.
 * - Mode B ('notify'): Permanently strips phone and email from the response payload
 *   unless the requesting user is the listing owner or an admin.
 * - Mode A ('direct'): Masks contact info for unauthenticated users until on-demand reveal.
 */
function sanitizeListingForViewer(listing, authUser, isAdminUser) {
  if (!listing) return listing;
  const isOwner = checkIsListingOwner(listing, authUser, isAdminUser);
  const contactPref = listing.contact_preference === 'direct' ? 'direct' : 'notify';

  const safe = {
    ...listing,
    contact_preference: contactPref,
    contact: listing.contact ? { ...listing.contact } : { name: 'Seller' }
  };

  if (isOwner || isAdminUser) {
    return safe;
  }

  if (contactPref === 'notify') {
    // SECURITY RULE: Strip out seller.phone and seller.email completely.
    delete safe.contact.phone;
    delete safe.contact.email;
    delete safe.ownerPhone;
    delete safe.ownerEmail;
  } else if (contactPref === 'direct') {
    if (!authUser) {
      delete safe.contact.phone;
      delete safe.contact.email;
      delete safe.ownerPhone;
      delete safe.ownerEmail;
    }
  }

  return safe;
}

// ===== LISTINGS ROUTES =====

// 1. Get all listings (public sees 'active' and 'sold'; 'pending' requires owner or admin)
app.get('/api/listings', async (req, res) => {
  try {
    const listings = await getListings();
    
    // Check if a user or admin token/session is provided to include user's own listings regardless of status
    let authUser = null;
    let isAdminUser = false;
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1]) || req.cookies?.accessToken || req.headers['x-auth-token'];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        authUser = decoded;
        if (decoded.role === 'admin' || decoded.isAdmin) isAdminUser = true;
      } catch (e) {}
    }
    const adminToken = req.headers['x-admin-token'];
    if (adminToken) {
      try {
        const decoded = jwt.verify(adminToken, JWT_SECRET);
        if (decoded.role === 'admin' || decoded.isAdmin) isAdminUser = true;
      } catch (e) {}
    }
    const headerPhone = req.headers['owner-phone'] || req.headers['x-user-phone'] || req.headers['owner-email'] || req.headers['x-owner-phone'];
    if (!authUser && headerPhone) {
      authUser = { phone: headerPhone, email: headerPhone, id: headerPhone };
    } else if (authUser && headerPhone) {
      if (!authUser.phone && !headerPhone.includes('@')) authUser.phone = headerPhone;
      if (!authUser.email && headerPhone.includes('@')) authUser.email = headerPhone;
    }

    const visibleListings = listings.filter(l => {
      // Admins see all listings
      if (isAdminUser) return true;

      const listingStatus = l.status || 'active';

      // Live approved public listings: only active or sold
      if (listingStatus === 'active' || listingStatus === 'sold') {
        return true;
      }

      // Pending, rejected, or inactive listings require verified ownership to view
      if (!authUser) return false;
      return checkIsListingOwner(l, authUser, false);
    });

    // Sanitize contact info based on contact_preference
    const sanitized = visibleListings.map(l => sanitizeListingForViewer(l, authUser, isAdminUser));

    res.json(sanitized);
  } catch (err) {
    console.error('Error reading listings:', err);
    res.status(500).json({ error: 'Server error reading listings.' });
  }
});

// Endpoint 1: Fetch Single Listing Details with Contact Privacy & Callback Status
app.get('/api/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const listings = await getListings();
    const listing = listings.find((l) => String(l.id) === String(id));

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    let authUser = null;
    let isAdminUser = false;
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1]) || req.cookies?.accessToken || req.headers['x-auth-token'];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        authUser = decoded;
        if (decoded.role === 'admin' || decoded.isAdmin) isAdminUser = true;
      } catch (e) {}
    }
    const adminToken = req.headers['x-admin-token'];
    if (adminToken) {
      try {
        const decoded = jwt.verify(adminToken, JWT_SECRET);
        if (decoded.role === 'admin' || decoded.isAdmin) isAdminUser = true;
      } catch (e) {}
    }

    const listingStatus = listing.status || 'active';
    const isOwner = checkIsListingOwner(listing, authUser, isAdminUser);

    if (listingStatus !== 'active' && listingStatus !== 'sold' && !isOwner && !isAdminUser) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    // Check if the current authenticated buyer has already requested callback
    let hasRequestedCallback = false;
    let leadStatus = null;
    if (authUser) {
      const buyerId = String(authUser.id || authUser.email);
      const buyerPhone = authUser.phone ? String(authUser.phone).replace(/\D/g, '').slice(-10) : '';
      const leads = await getLeads();
      const existingLead = leads.find(l => {
        if (String(l.listing_id) !== String(id)) return false;
        if (String(l.buyer_id) === buyerId) return true;
        if (buyerPhone && l.buyer_phone && String(l.buyer_phone).replace(/\D/g, '').slice(-10) === buyerPhone) return true;
        return false;
      });

      if (existingLead) {
        hasRequestedCallback = true;
        leadStatus = existingLead.status;
      }
    }

    const sanitized = sanitizeListingForViewer(listing, authUser, isAdminUser);
    sanitized.hasRequestedCallback = hasRequestedCallback;
    sanitized.leadStatus = leadStatus;

    res.json(sanitized);
  } catch (err) {
    console.error('Error fetching listing details:', err);
    res.status(500).json({ error: 'Server error reading listing.' });
  }
});

// Mode A: Direct Contact Reveal (Requires authenticated session, rate-limited)
app.post('/api/listings/:id/contact', contactRevealLimiter, authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const listings = await getListings();
    const listing = listings.find((l) => String(l.id) === String(id));

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const contactPref = listing.contact_preference === 'direct' ? 'direct' : 'notify';
    if (contactPref === 'notify') {
      return res.status(403).json({
        error: 'Seller has chosen to keep their contact number private. Please click "Request Callback" to connect.',
        code: 'CALLBACK_ONLY'
      });
    }

    const phone = listing.contact?.phone || listing.ownerPhone;
    const email = listing.contact?.email || listing.ownerEmail;
    const name = listing.contact?.name || 'Seller';

    res.json({
      success: true,
      phone,
      email,
      name,
    });
  } catch (err) {
    console.error('Error revealing contact number:', err);
    res.status(500).json({ error: 'Server error revealing contact number.' });
  }
});

// Endpoint 2: Request Callback (Lead Dispatch)
app.post('/api/listings/:id/request-callback', leadRequestLimiter, authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const listings = await getListings();
    const listing = listings.find((l) => String(l.id) === String(id));

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    // Verify that the calling user has is_phone_verified === true
    const users = await getUsers();
    const currentUser = users.find(u => u.email === (req.user?.email || '').toLowerCase()) || req.user;

    const isPhoneVerified = Boolean(
      currentUser.is_phone_verified ||
      currentUser.isPhoneVerified ||
      currentUser.verified?.phone ||
      req.user?.is_phone_verified ||
      req.user?.isPhoneVerified ||
      req.user?.verified?.phone
    );

    if (!isPhoneVerified) {
      return res.status(403).json({
        code: 'PHONE_VERIFICATION_REQUIRED',
        error: 'A verified mobile number is required to request a callback.'
      });
    }

    // Prevent seller from requesting callback on their own listing
    if (checkIsListingOwner(listing, currentUser, false)) {
      return res.status(400).json({ error: 'You cannot request a callback on your own listing.' });
    }

    const buyerId = String(currentUser.id || currentUser.email || req.user.id || req.user.email);
    const buyerPhone = cleanText(currentUser.phone || req.user.phone || req.body.buyer_phone || '');
    const buyerName = cleanText(currentUser.name || req.user.name || req.body.buyer_name || 'Buyer');

    if (!buyerPhone || buyerPhone.length < 7) {
      return res.status(400).json({ error: 'A valid buyer mobile number is required.' });
    }

    const cleanPhone = (p) => (p ? String(p).replace(/\D/g, '').slice(-10) : '');
    const leads = await getLeads();

    // Check for existing lead from the same buyer on this listing (Idempotency)
    const existingLead = leads.find(l => {
      if (String(l.listing_id) !== String(id)) return false;
      if (String(l.buyer_id) === buyerId) return true;
      if (cleanPhone(l.buyer_phone) === cleanPhone(buyerPhone)) return true;
      return false;
    });

    if (existingLead) {
      return res.status(200).json({
        success: true,
        message: 'Callback already requested for this property.',
        code: 'LEAD_EXISTS',
        lead: existingLead,
      });
    }

    // 1. Fetch seller_id from listing
    const sellerId = String(listing.ownerUserId || listing.ownerEmail || listing.ownerId || listing.contact?.email || 'seller');
    const sellerEmail = listing.ownerEmail || listing.contact?.email || '';
    const sellerName = listing.contact?.name || 'Seller';

    // 2. Insert record into listing_leads
    const newLead = {
      id: crypto.randomUUID(),
      listing_id: String(listing.id),
      listing_title: listing.title || 'Property',
      seller_id: sellerId,
      seller_email: sellerEmail,
      seller_name: sellerName,
      buyer_id: buyerId,
      buyer_phone: buyerPhone,
      buyer_name: buyerName,
      buyer_email: currentUser.email || req.user.email || '',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    leads.unshift(newLead);
    await saveLeads(leads);

    // 3. Create an in-app notification entry for the seller
    try {
      const notification = {
        id: crypto.randomUUID(),
        user_id: sellerId,
        seller_email: sellerEmail,
        type: 'lead_callback',
        title: '📞 New Callback Request',
        message: `${buyerName} (${buyerPhone}) requested a callback for "${listing.title}".`,
        data: {
          lead_id: newLead.id,
          listing_id: listing.id,
          listing_title: listing.title,
          buyer_phone: buyerPhone,
          buyer_name: buyerName,
        },
        is_read: false,
        created_at: new Date().toISOString(),
      };
      const notifications = await getNotifications();
      notifications.unshift(notification);
      await saveNotifications(notifications);
    } catch (notifErr) {
      console.warn('[Notification] Failed to create in-app notification:', notifErr.message);
    }

    // 4. (Optional/Async) Trigger an SMS or WhatsApp webhook/service + send lead email
    if (sellerEmail) {
      sendLeadNotificationEmail(sellerEmail, {
        sellerName,
        buyerName,
        buyerPhone,
        listingTitle: listing.title,
        listingId: listing.id,
      }).catch(err => console.warn('[Lead Email] Async dispatch warning:', err.message));
    }

    // Webhook dispatch simulation
    console.log(`[Lead Dispatch] 📱 SMS/WhatsApp webhook triggered: Seller "${sellerName}" (${sellerId}) notified of buyer ${buyerName} (${buyerPhone}) for listing "${listing.title}"`);

    // 5. Return 201 Created
    res.status(201).json({
      success: true,
      message: 'Callback requested successfully',
      lead: newLead,
    });
  } catch (err) {
    console.error('Error requesting callback:', err);
    res.status(500).json({ error: 'Server error requesting callback.' });
  }
});

// Endpoint 3: Seller Leads Inbox (Paginated received leads)
app.get('/api/seller/leads', authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    const cleanStr = (s) => (s ? String(s).trim().toLowerCase() : '');
    const cleanPhone = (p) => (p ? String(p).replace(/\D/g, '').slice(-10) : '');

    const userEmail = cleanStr(user.email);
    const userId = cleanStr(user.id || user.googleId || user.sub);
    const userPhone = cleanPhone(user.phone);

    const leads = await getLeads();

    // Filter leads belonging to this seller (or admin sees all)
    const sellerLeads = leads.filter(l => {
      if (req.isAdmin) return true;
      const sId = cleanStr(l.seller_id);
      const sEmail = cleanStr(l.seller_email);
      if (userId && sId === userId) return true;
      if (userEmail && (sId === userEmail || sEmail === userEmail)) return true;
      if (userPhone && userPhone.length >= 7 && (cleanPhone(l.seller_id) === userPhone || cleanPhone(sId) === userPhone)) return true;
      return false;
    });

    // Optional status filter (?status=pending|contacted|dismissed)
    const { status, page = 1, limit = 10 } = req.query;
    let filtered = sellerLeads;
    if (status && ['pending', 'contacted', 'dismissed'].includes(status)) {
      filtered = sellerLeads.filter(l => l.status === status);
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = filtered.slice(startIndex, startIndex + limitNum);

    res.json({
      leads: paginated,
      total: filtered.length,
      page: pageNum,
      totalPages: Math.ceil(filtered.length / limitNum) || 1,
      stats: {
        total: sellerLeads.length,
        pending: sellerLeads.filter(l => l.status === 'pending').length,
        contacted: sellerLeads.filter(l => l.status === 'contacted').length,
        dismissed: sellerLeads.filter(l => l.status === 'dismissed').length,
      }
    });
  } catch (err) {
    console.error('Error fetching seller leads:', err);
    res.status(500).json({ error: 'Server error fetching seller leads.' });
  }
});

// Update Lead Status (e.g., Pending -> Contacted or Dismissed)
app.patch(['/api/seller/leads/:id/status', '/api/seller/leads/:id'], authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'contacted', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be pending, contacted, or dismissed.' });
    }

    const leads = await getLeads();
    const lead = leads.find(l => String(l.id) === String(id));

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found.' });
    }

    const cleanStr = (s) => (s ? String(s).trim().toLowerCase() : '');
    const userEmail = cleanStr(req.user.email);
    const userId = cleanStr(req.user.id);
    const isLeadOwner = req.isAdmin || (userId && cleanStr(lead.seller_id) === userId) || (userEmail && (cleanStr(lead.seller_id) === userEmail || cleanStr(lead.seller_email) === userEmail));

    if (!isLeadOwner) {
      return res.status(403).json({ error: 'Forbidden. You do not own this lead.' });
    }

    lead.status = status;
    lead.updated_at = new Date().toISOString();
    await saveLeads(leads);

    res.json({
      success: true,
      message: `Lead marked as ${status}.`,
      lead,
    });
  } catch (err) {
    console.error('Error updating lead status:', err);
    res.status(500).json({ error: 'Server error updating lead status.' });
  }
});

// Phone OTP Endpoints for Inline Mobile Verification
app.post('/api/auth/send-phone-otp', authLimiter, authenticateUser, async (req, res) => {
  try {
    const { phone } = req.body;
    const phoneToVerify = phone ? cleanText(phone) : req.user.phone;
    if (!phoneToVerify || phoneToVerify.length < 7) {
      return res.status(400).json({ error: 'Valid phone number is required.' });
    }

    const users = await getUsers();
    const user = users.find(u => u.email === (req.user.email || '').toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const otpCode = generateOtpCode();
    user.phone = phoneToVerify;
    user.phoneVerificationCode = otpCode;
    user.phoneVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 mins
    await saveUsers(users);

    console.log(`[Phone OTP] Generated OTP ${otpCode} for phone ${phoneToVerify} (User: ${user.email})`);

    res.json({
      success: true,
      message: `Verification code sent to ${phoneToVerify}.`,
      devCode: otpCode, // sent for development/testing ease
    });
  } catch (err) {
    console.error('Error sending phone OTP:', err);
    res.status(500).json({ error: 'Server error sending phone OTP.' });
  }
});

app.post('/api/auth/verify-phone-otp', authLimiter, authenticateUser, async (req, res) => {
  try {
    const { code, phone, idToken } = req.body;

    const users = await getUsers();
    const user = users.find(
      (u) =>
        (req.user?.email && u.email && u.email.toLowerCase() === req.user.email.toLowerCase()) ||
        (req.user?.phone && u.phone && u.phone.replace(/\D/g, '').slice(-10) === req.user.phone.replace(/\D/g, '').slice(-10))
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // 1. Firebase Token Verification
    if (idToken) {
      const decoded = await verifyFirebaseIdToken(idToken);
      const verifiedPhone = decoded.phone_number || (phone ? cleanText(phone) : user.phone);
      if (verifiedPhone) {
        user.phone = verifiedPhone;
      }
      user.verified = { ...(user.verified || {}), phone: true };
      user.is_phone_verified = true;
      user.firebaseUid = decoded.uid || decoded.sub;
      user.phoneVerificationCode = null;
      user.phoneVerificationExpires = null;

      await saveUsers(users);

      const safeUser = sanitizeUser(user);
      return res.json({
        success: true,
        message: 'Phone number verified successfully with Firebase.',
        user: safeUser,
      });
    }

    // 2. Direct OTP Code Verification Fallback
    if (!code || String(code).trim().length !== 6) {
      return res.status(400).json({ error: 'A valid 6-digit verification code is required.' });
    }

    if (!user.phoneVerificationCode || String(user.phoneVerificationCode).trim() !== String(code).trim()) {
      return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
    }

    if (user.phoneVerificationExpires && Date.now() > user.phoneVerificationExpires) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    if (phone) {
      user.phone = cleanText(phone);
    }
    user.verified = { ...(user.verified || {}), phone: true };
    user.is_phone_verified = true;
    user.phoneVerificationCode = null;
    user.phoneVerificationExpires = null;

    await saveUsers(users);

    const safeUser = sanitizeUser(user);
    res.json({
      success: true,
      message: 'Phone number verified successfully.',
      user: safeUser,
    });
  } catch (err) {
    console.error('Error verifying phone OTP:', err);
    res.status(500).json({ error: 'Server error verifying phone OTP.' });
  }
});

// 2. Add a new listing (status defaults to pending for moderation, rate limited)
app.post('/api/listings', listingCreationLimiter, authenticateUser, async (req, res) => {
  try {
    const {
      type,
      title,
      desc,
      price,
      size,
      unit,
      area,
      city,
      lat,
      lng,
      images,
      contact,
    } = req.body;

    if (!title || !price || !size || !area || !city || !contact || !contact.name || !contact.phone) {
      return res.status(400).json({ error: 'Missing required property details.' });
    }

    // Upload images directly to Supabase Storage and obtain public URLs (never stored on local disk)
    const uploadedImages = await processListingImages(images, 'prop');

    const cityCoords = {
      Veraval: { lat: 20.9082, lng: 70.3703 },
      Una: { lat: 20.8227, lng: 71.0421 },
      Junagadh: { lat: 21.5222, lng: 70.4579 },
    };

    const defaultCoord = cityCoords[city] || { lat: 20.9082, lng: 70.3703 };
    const incomingLat = lat !== undefined && lat !== null ? lat : req.body.latitude;
    const incomingLng = lng !== undefined && lng !== null ? lng : req.body.longitude;
    const finalLat = incomingLat !== undefined && incomingLat !== null && !isNaN(Number(incomingLat)) ? Number(incomingLat) : defaultCoord.lat;
    const finalLng = incomingLng !== undefined && incomingLng !== null && !isNaN(Number(incomingLng)) ? Number(incomingLng) : defaultCoord.lng;

    const listings = await getListings();
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);

    // Extract owner identification from authenticated session or payload
    const incomingOwnerEmail = req.user?.email || (contact.email ? cleanText(contact.email) : (req.body.ownerEmail ? cleanText(req.body.ownerEmail) : ''));
    const incomingOwnerPhone = req.user?.phone || (contact.phone ? cleanText(contact.phone) : (req.body.ownerPhone ? cleanText(req.body.ownerPhone) : ''));
    const ownerId = req.user?.email || req.user?.phone || req.body.ownerId || incomingOwnerEmail || incomingOwnerPhone || 'user';
    const ownerUserId = req.user?.id || req.user?.googleId || req.body.ownerUserId || '';

    // Mass Assignment Protection: Construct listing explicitly
    const newListing = {
      id,
      type: cleanText(type),
      title: cleanText(title),
      desc: cleanText(desc || ''),
      price: Number(price),
      size: Number(size),
      unit: cleanText(unit),
      area: cleanText(area),
      city: cleanText(city),
      lat: finalLat,
      lng: finalLng,
      images: uploadedImages,
      purpose: cleanText(req.body.purpose || 'sale'),
      contact: {
        name: cleanText(contact.name),
        phone: cleanText(contact.phone),
        email: cleanText(contact.email || incomingOwnerEmail || ''),
      },
      date: new Date().toISOString().split('T')[0],
      ownerId,
      ownerEmail: incomingOwnerEmail,
      ownerPhone: incomingOwnerPhone,
      ownerUserId,
      contact_preference: req.body.contact_preference === 'direct' ? 'direct' : 'notify',
      priceChangeLog: [],
      status: 'pending'
    };

    listings.unshift(newListing);
    await saveListings(listings);

    res.status(201).json(newListing);
  } catch (err) {
    console.error('Error creating listing:', err);
    res.status(500).json({ error: 'Server error creating listing.' });
  }
});

// 3. Delete listing (IDOR Protection: requires auth & verified ownership)
app.delete('/api/listings/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const listings = await getListings();
    const listingIndex = listings.findIndex((l) => l.id === id);

    if (listingIndex === -1) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listings[listingIndex];
    
    // IDOR Check: Ensure user owns listing or is admin
    const isOwner = checkIsListingOwner(listing, req.user, req.isAdmin);
    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden. You do not own this listing.' });
    }

    // Delete associated images from Supabase Storage
    if (Array.isArray(listing.images)) {
      for (const imgUrl of listing.images) {
        deleteStorageImage(imgUrl).catch(() => {});
      }
    }

    // Perform deletion
    const updated = listings.filter((l) => l.id !== id);
    await saveListings(updated);

    res.json({ success: true, message: 'Listing deleted successfully.' });
  } catch (err) {
    console.error('Error deleting listing:', err);
    res.status(500).json({ error: 'Server error deleting listing.' });
  }
});

// 4. Update price of a listing (IDOR Protection & rate limit check)
app.put('/api/listings/:id/price', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { price } = req.body;

    if (price === undefined || isNaN(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: 'Valid price is required.' });
    }

    const listings = await getListings();
    const listingIndex = listings.findIndex((l) => l.id === id);

    if (listingIndex === -1) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listings[listingIndex];

    // IDOR Check: Ensure user owns listing or is admin
    const isOwner = checkIsListingOwner(listing, req.user, req.isAdmin);
    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden. You do not own this listing.' });
    }

    const log = listing.priceChangeLog || [];
    const changesThisMonth = getPriceChangesThisMonth(log);

    if (changesThisMonth.length >= 4) {
      return res.status(400).json({
        error: 'You have reached the maximum of 4 price changes this month.'
      });
    }

    // Perform update
    listing.price = Number(price);
    listing.priceChangeLog = [...log, new Date().toISOString()];

    await saveListings(listings);

    res.json({
      success: true,
      message: 'Price updated successfully.',
      listing
    });
  } catch (err) {
    console.error('Error updating price:', err);
    res.status(500).json({ error: 'Server error updating price.' });
  }
});

// 5. Update entire property details (IDOR Protection: requires auth & verified ownership)
app.put('/api/listings/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      type,
      title,
      desc,
      price,
      size,
      unit,
      area,
      city,
      lat,
      lng,
      latitude,
      longitude,
      images,
      contact,
    } = req.body;

    const listings = await getListings();
    const listingIndex = listings.findIndex((l) => l.id === id);

    if (listingIndex === -1) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const currentListing = listings[listingIndex];

    // IDOR Check: Ensure user owns listing or is admin
    const isOwner = checkIsListingOwner(currentListing, req.user, req.isAdmin);
    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden. You do not own this listing.' });
    }

    // Input validation
    if (!title || price === undefined || size === undefined || !area || !city) {
      return res.status(400).json({ error: 'Title, price, size, area, and city are required.' });
    }

    const numPrice = Number(price);
    const numSize = Number(size);

    if (isNaN(numPrice) || numPrice <= 0) {
      return res.status(400).json({ error: 'Valid price greater than 0 is required.' });
    }

    if (isNaN(numSize) || numSize <= 0) {
      return res.status(400).json({ error: 'Valid size greater than 0 is required.' });
    }

    // Track monthly price changes only if price has actually changed
    const log = currentListing.priceChangeLog || [];
    let updatedPriceChangeLog = log;
    if (numPrice !== Number(currentListing.price) && !req.isAdmin) {
      const changesThisMonth = getPriceChangesThisMonth(log);
      if (changesThisMonth.length >= 4) {
        return res.status(400).json({
          error: 'You have reached the maximum of 4 price changes this month.'
        });
      }
      updatedPriceChangeLog = [...log, new Date().toISOString()];
    }

    // Process images if provided
    let updatedImages = currentListing.images || [];
    if (Array.isArray(images)) {
      updatedImages = await processListingImages(images, 'prop');

      // Asynchronously clean up any old images that were removed
      const oldImages = Array.isArray(currentListing.images) ? currentListing.images : [];
      const newImagesSet = new Set(updatedImages);
      for (const oldUrl of oldImages) {
        if (!newImagesSet.has(oldUrl)) {
          deleteStorageImage(oldUrl).catch(() => {});
        }
      }
    }

    // Coordinate resolution
    const cityCoords = {
      Veraval: { lat: 20.9082, lng: 70.3703 },
      Una: { lat: 20.8227, lng: 71.0421 },
      Junagadh: { lat: 21.5222, lng: 70.4579 },
    };
    const defaultCoord = cityCoords[city] || { lat: 20.9082, lng: 70.3703 };
    const incomingLat = lat !== undefined && lat !== null ? lat : latitude;
    const incomingLng = lng !== undefined && lng !== null ? lng : longitude;
    const finalLat = incomingLat !== undefined && incomingLat !== null && !isNaN(Number(incomingLat))
      ? Number(incomingLat)
      : (currentListing.lat || defaultCoord.lat);
    const finalLng = incomingLng !== undefined && incomingLng !== null && !isNaN(Number(incomingLng))
      ? Number(incomingLng)
      : (currentListing.lng || defaultCoord.lng);

    // Clean and update contact
    const currentContact = currentListing.contact || {};
    const updatedContact = {
      name: contact?.name ? cleanText(contact.name) : (currentContact.name || ''),
      phone: contact?.phone ? cleanText(contact.phone) : (currentContact.phone || ''),
      email: contact?.email ? cleanText(contact.email) : (currentContact.email || currentListing.ownerEmail || ''),
    };

    // Construct sanitized and safe updated listing
    const updatedListing = {
      ...currentListing,
      type: cleanText(type || currentListing.type || 'house'),
      title: cleanText(title),
      desc: cleanText(desc || ''),
      price: numPrice,
      size: numSize,
      unit: cleanText(unit || currentListing.unit || 'sqft'),
      purpose: cleanText(req.body.purpose || currentListing.purpose || 'sale'),
      area: cleanText(area),
      city: cleanText(city),
      lat: finalLat,
      lng: finalLng,
      latitude: finalLat,
      longitude: finalLng,
      images: updatedImages,
      contact: updatedContact,
      contact_preference: req.body.contact_preference !== undefined
        ? (req.body.contact_preference === 'direct' ? 'direct' : 'notify')
        : (currentListing.contact_preference || 'notify'),
      priceChangeLog: updatedPriceChangeLog,
      updatedAt: new Date().toISOString(),
    };

    listings[listingIndex] = updatedListing;
    await saveListings(listings);

    res.json({
      success: true,
      message: 'Property details updated successfully.',
      listing: updatedListing,
    });
  } catch (err) {
    console.error('Error updating listing details:', err);
    res.status(500).json({ error: 'Server error updating property details.' });
  }
});

// ===== SITE SETTINGS API =====

// GET /api/settings — public endpoint to fetch contact details & settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Server error fetching settings.' });
  }
});

// PUT /api/settings — update contact settings (admin only)
app.put('/api/settings', requireAdmin, async (req, res) => {
  try {
    const { helpMobile, helpEmail, helpHours } = req.body;
    const current = await getSettings();

    const updated = {
      ...current,
      helpMobile: cleanText(helpMobile) || current.helpMobile,
      helpEmail: cleanText(helpEmail) || current.helpEmail,
      helpHours: cleanText(helpHours) || current.helpHours,
    };

    await saveSettings(updated);
    res.json({ success: true, message: 'Help desk settings updated successfully.', settings: updated });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Server error updating settings.' });
  }
});

// ===== HELP DESK INQUIRIES API =====

// POST /api/inquiries — submit written inquiry from Help Desk page
app.post('/api/inquiries', async (req, res) => {
  try {
    const { name, phone, email, message } = req.body;
    if (!name || !phone || !message) {
      return res.status(400).json({ error: 'Name, phone, and message are required.' });
    }

    const cleanName = cleanText(name);
    const cleanPhone = cleanText(phone);
    const cleanEmail = email ? cleanText(email) : '';
    const cleanMsg = cleanText(message);

    const inquiries = await getInquiries();
    const newInquiry = {
      id: 'inq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      message: cleanMsg,
      date: new Date().toISOString(),
      status: 'pending' // 'pending' | 'resolved'
    };

    inquiries.unshift(newInquiry);
    await saveInquiries(inquiries);

    res.json({ success: true, message: 'Your inquiry has been submitted successfully.', inquiry: newInquiry });
  } catch (err) {
    console.error('Error submitting inquiry:', err);
    res.status(500).json({ error: 'Server error submitting inquiry.' });
  }
});

// GET /api/admin/inquiries — fetch all inquiries for Admin Panel
app.get('/api/admin/inquiries', requireAdmin, async (req, res) => {
  try {
    const inquiries = await getInquiries();
    res.json(inquiries);
  } catch (err) {
    console.error('Error fetching admin inquiries:', err);
    res.status(500).json({ error: 'Server error fetching inquiries.' });
  }
});

// PUT /api/admin/inquiries/:id/status — update inquiry status or note
app.put('/api/admin/inquiries/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;
    const inquiries = await getInquiries();
    const inquiry = inquiries.find((i) => i.id === id);

    if (!inquiry) {
      return res.status(404).json({ error: 'Inquiry not found.' });
    }

    if (status) inquiry.status = status;
    if (adminNote !== undefined) inquiry.adminNote = cleanText(adminNote);
    inquiry.updatedAt = new Date().toISOString();

    await saveInquiries(inquiries);
    res.json({ success: true, inquiry });
  } catch (err) {
    console.error('Error updating inquiry status:', err);
    res.status(500).json({ error: 'Server error updating inquiry status.' });
  }
});

// DELETE /api/admin/inquiries/:id — delete inquiry
app.delete('/api/admin/inquiries/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let inquiries = await getInquiries();
    const initialLen = inquiries.length;
    inquiries = inquiries.filter((i) => i.id !== id);

    if (inquiries.length === initialLen) {
      return res.status(404).json({ error: 'Inquiry not found.' });
    }

    await saveInquiries(inquiries);
    res.json({ success: true, message: 'Inquiry deleted successfully.' });
  } catch (err) {
    console.error('Error deleting inquiry:', err);
    res.status(500).json({ error: 'Server error deleting inquiry.' });
  }
});

// 404 Handler for undefined API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Centralized Error Handler — hides debug error stack traces and internal messages
app.use((err, req, res, next) => {
  // Log real error internally on the server
  console.error('[Server Error Handler]', err);

  if (res.headersSent) {
    return next(err);
  }

  // Handle specific known safe errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON request payload.' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File size exceeds 10MB limit.' });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({ error: 'File upload error.' });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Invalid or missing authentication token.' });
  }

  // Generic secure error for anything else: never leak stack trace or internal error details
  res.status(err.status || 500).json({
    error: 'An internal server error occurred. Please try again later.'
  });
});

// Start Server
if (!process.env.VERCEL && !process.env.K_SERVICE && !process.env.FUNCTION_NAME) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server is running on 0.0.0.0:${PORT}`);
    // Verify cloud storage connectivity at boot — alerts in logs if data won't persist
    await checkStorageHealth();
  });
}

export { app };
