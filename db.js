import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isCloudFunctions = process.env.VERCEL || process.env.NETLIFY || process.env.K_SERVICE || process.env.FUNCTIONS_EMULATOR || process.env.FIREBASE_CONFIG;
const DATA_DIR = isCloudFunctions ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');

// Lazy-initialize Supabase Client
let supabaseClient = null;
let supabaseAvailable = null; // null = untried, true = working, false = disabled

export function getSupabaseInstance() {
  if (supabaseAvailable === false) return null;
  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://osowusrcwpqqxhcjzaom.supabase.co';
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseKey) {
    supabaseAvailable = false;
    return null;
  }

  try {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
    supabaseAvailable = true;
    console.log(`[Supabase] Successfully connected to ${supabaseUrl}`);
    return supabaseClient;
  } catch (err) {
    console.warn('[Supabase] Initialization error (falling back):', err.message);
    supabaseAvailable = false;
    supabaseClient = null;
    return null;
  }
}

// Lazy-initialize Firebase Admin Firestore
let firestoreDb = null;
let firestoreAvailable = null; // null = untried, true = working, false = disabled

function getFirestoreInstance() {
  if (firestoreAvailable === false) return null;
  if (firestoreDb) return firestoreDb;
  
  // Only attempt Firestore if explicit credentials exist in environment
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    firestoreAvailable = false;
    return null;
  }

  try {
    if (!admin.apps.length) {
      const sa = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      admin.initializeApp({
        credential: admin.credential.cert(sa),
        projectId: sa.project_id || 'mari-milkat-49813',
      });
    }
    firestoreDb = admin.firestore();
    firestoreAvailable = true;
  } catch (err) {
    console.warn('[Firestore] Initialization warning (falling back to JSON store):', err.message);
    firestoreAvailable = false;
    firestoreDb = null;
  }
  return firestoreDb;
}

const SEED = [
  { id: 's1', type: 'house', title: '1,125 Sq. Ft. Double Storey House', desc: 'Beautiful double storey house with 3 bedrooms, 2 bathrooms, drawing room, TV lounge, kitchen, car porch. Marble flooring, good ventilation. Near park and mosque.', price: 12500000, size: 1125, unit: 'sqft', area: 'Somnath Road', city: 'Veraval', lat: 20.9082, lng: 70.3703, images: ['/assets/sample_house.png'], contact: { name: 'Ahmed Khan', phone: '0300-1234567' }, date: '2026-05-19', status: 'active' },
  { id: 's2', type: 'plot', title: '2,250 Sq. Ft. Residential Plot', desc: 'Prime location 2,250 Sq. Ft. plot in a developed sector. All utilities available — gas, electricity, water. Wide road access. Ideal for building a dream home.', price: 8500000, size: 2250, unit: 'sqft', area: 'College Road', city: 'Una', lat: 20.8227, lng: 71.0421, images: ['/assets/sample_plot.png'], contact: { name: 'Sara Ali', phone: '0321-9876543' }, date: '2026-05-18', status: 'active' },
  { id: 's3', type: 'house', title: '2,250 Sq. Ft. Luxury Bungalow', desc: 'Spacious 2,250 Sq. Ft. bungalow with 5 bedrooms, servant quarter, modern kitchen, lawn area. Fully furnished with imported fittings. Prime corner location.', price: 32000000, size: 2250, unit: 'sqft', area: 'Girnar Road', city: 'Junagadh', lat: 21.5222, lng: 70.4579, images: ['/assets/sample_house.png'], contact: { name: 'Usman Tariq', phone: '0333-4567890' }, date: '2026-05-17', status: 'active' },
  { id: 's4', type: 'plot', title: '500 Sq. Yards Plot — Corner', desc: 'Corner plot with 80 ft front. All amenities nearby including school, hospital, market. Gated community with 24/7 security. Ready for immediate construction.', price: 25000000, size: 500, unit: 'sqyd', area: 'ST Bus Stand Area', city: 'Veraval', lat: 20.9021, lng: 70.3642, images: ['/assets/sample_plot.png'], contact: { name: 'Bilal Hussain', phone: '0345-6789012' }, date: '2026-05-16', status: 'active' },
  { id: 's5', type: 'house', title: '675 Sq. Ft. Brand New House', desc: 'Newly constructed 675 Sq. Ft. house with 2 bedrooms, 1 bathroom, kitchen, small lawn. Perfect for small families. Near main road.', price: 5500000, size: 675, unit: 'sqft', area: 'Delwada Road', city: 'Una', lat: 20.8175, lng: 71.0315, images: ['/assets/sample_house.png'], contact: { name: 'Fatima Noor', phone: '0312-3456789' }, date: '2026-05-15', status: 'active' },
  { id: 's6', type: 'plot', title: '1,125 Sq. Ft. Plot — Prime Location', desc: '1,125 Sq. Ft. residential plot with all utilities. Surrounded by constructed houses. Walking distance from commercial market.', price: 4200000, size: 1125, unit: 'sqft', area: 'Kalwa Chowk', city: 'Junagadh', lat: 21.5210, lng: 70.4601, images: ['/assets/sample_plot.png'], contact: { name: 'Kamran Sheikh', phone: '0300-5678901' }, date: '2026-05-14', status: 'active' },
  { id: 's7', type: 'house', title: '1,575 Sq. Ft. House with Basement', desc: 'Modern 1,575 Sq. Ft. house with basement, ground and first floor. 4 bedrooms, 3 bathrooms, American kitchen, car parking for 2 cars.', price: 18000000, size: 1575, unit: 'sqft', area: 'Zanzarda Road', city: 'Junagadh', lat: 21.5150, lng: 70.4480, images: ['/assets/sample_house.png'], contact: { name: 'Hasan Raza', phone: '0334-7890123' }, date: '2026-05-13', status: 'active' },
  { id: 's8', type: 'plot', title: '1,000 Sq. Yards Farm House Plot', desc: 'Beautiful 1,000 Sq. Yards plot in farm house scheme. Lush green surroundings, ideal for weekend retreat or farm house construction.', price: 15000000, size: 1000, unit: 'sqyd', area: 'Rajpara', city: 'Veraval', lat: 20.9150, lng: 70.3810, images: ['/assets/sample_plot.png'], contact: { name: 'Ayesha Malik', phone: '0315-8901234' }, date: '2026-05-12', status: 'active' }
];

const CATEGORIES_SEED = {
  propertyTypes: [
    { id: 'house', label: 'House', icon: '🏠' },
    { id: 'plot', label: 'Plot', icon: '📐' },
    { id: 'apartment', label: 'Apartment', icon: '🏢' },
    { id: 'commercial', label: 'Commercial', icon: '🏪' },
    { id: 'farmhouse', label: 'Farm House', icon: '🌾' }
  ],
  cities: [
    { id: 'veraval', label: 'Veraval', lat: 20.9082, lng: 70.3703 },
    { id: 'una', label: 'Una', lat: 20.8227, lng: 71.0421 },
    { id: 'junagadh', label: 'Junagadh', lat: 21.5222, lng: 70.4579 }
  ],
  amenities: [
    { id: 'parking', label: 'Car Parking', icon: '🅿️' },
    { id: 'garden', label: 'Garden/Lawn', icon: '🌿' },
    { id: 'security', label: '24/7 Security', icon: '🔒' },
    { id: 'water', label: 'Water Supply', icon: '💧' },
    { id: 'electricity', label: 'Electricity', icon: '⚡' },
    { id: 'gas', label: 'Gas', icon: '🔥' }
  ],
  priceRanges: [
    { id: 'under5l', label: 'Under ₨ 5 Lac', min: 0, max: 500000 },
    { id: '5l-25l', label: '₨ 5 Lac – 25 Lac', min: 500000, max: 2500000 },
    { id: '25l-50l', label: '₨ 25 Lac – 50 Lac', min: 2500000, max: 5000000 },
    { id: '50l-1cr', label: '₨ 50 Lac – 1 Crore', min: 5000000, max: 10000000 },
    { id: '1cr-5cr', label: '₨ 1 Crore – 5 Crore', min: 10000000, max: 50000000 },
    { id: 'above5cr', label: 'Above ₨ 5 Crore', min: 50000000, max: null }
  ]
};

const SETTINGS_SEED = {
  helpMobile: '+91 98765 43210',
  helpEmail: 'support@marimilkat.com',
  helpHours: 'Mon - Sat: 9:00 AM - 8:00 PM',
};

class AtomicJSONStore {
  constructor(filePath, defaultData = []) {
    this.filePath = filePath;
    this.defaultData = defaultData;
    this.queue = Promise.resolve();
  }

  async read() {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          await fs.mkdir(path.dirname(this.filePath), { recursive: true });
          const content = await fs.readFile(this.filePath, 'utf8');
          resolve(JSON.parse(content));
        } catch (err) {
          if (err.code === 'ENOENT') {
            try {
              await fs.writeFile(this.filePath, JSON.stringify(this.defaultData, null, 2), 'utf8');
              resolve(this.defaultData);
            } catch (wErr) {
              reject(wErr);
            }
          } else {
            reject(err);
          }
        }
      });
    });
  }

  async write(data) {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          await fs.mkdir(path.dirname(this.filePath), { recursive: true });
          const tempPath = this.filePath + '.tmp';
          await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
          await fs.rename(tempPath, this.filePath);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}

const listingsStore = new AtomicJSONStore(LISTINGS_FILE, SEED);
const usersStore = new AtomicJSONStore(USERS_FILE, []);
const reportsStore = new AtomicJSONStore(REPORTS_FILE, []);
const categoriesStore = new AtomicJSONStore(CATEGORIES_FILE, CATEGORIES_SEED);
const settingsStore = new AtomicJSONStore(SETTINGS_FILE, SETTINGS_SEED);
const inquiriesStore = new AtomicJSONStore(INQUIRIES_FILE, []);

// In-Memory Data Cache
const cache = {
  listings: null,
  users: null,
  reports: null,
  categories: null,
  settings: null,
  inquiries: null,
};

// Supabase Helper Functions
async function getSupabaseCollection(tableName, seedData = []) {
  const sb = getSupabaseInstance();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(tableName).select('*');
    if (error) {
      console.warn(`[Supabase] Query error for '${tableName}':`, error.message);
      return null;
    }

    if (!data || data.length === 0) {
      if (seedData && (Array.isArray(seedData) ? seedData.length > 0 : Object.keys(seedData).length > 0)) {
        saveSupabaseCollection(tableName, seedData).catch(() => {});
        return seedData;
      }
      return Array.isArray(seedData) ? [] : seedData;
    }

    if (Array.isArray(seedData)) {
      return data.map(row => (row.data ? { ...row.data, id: row.id || row.data.id || row.email, email: row.email || (row.data && row.data.email) } : row));
    } else {
      const doc = data.find(r => r.id === 'main') || data[0];
      return doc ? (doc.data || doc) : seedData;
    }
  } catch (err) {
    console.warn(`[Supabase] Read error for '${tableName}':`, err.message);
    return null;
  }
}

async function saveSupabaseCollection(tableName, data) {
  const sb = getSupabaseInstance();
  if (!sb) return false;
  try {
    if (Array.isArray(data)) {
      const rows = data.map(item => {
        const row = {
          data: item,
          updated_at: new Date().toISOString()
        };
        if (tableName === 'users') {
          row.email = String(item.email || item.id);
        } else {
          row.id = String(item.id || item.email || item.phone || crypto.randomUUID());
        }
        return row;
      });

      if (rows.length > 0) {
        const { error } = await sb.from(tableName).upsert(rows);
        if (error) {
          console.warn(`[Supabase] Upsert error for '${tableName}':`, error.message);
          return false;
        }
      }
      return true;
    } else {
      const { error } = await sb.from(tableName).upsert({
        id: 'main',
        data: data,
        updated_at: new Date().toISOString()
      });
      if (error) {
        console.warn(`[Supabase] Upsert single error for '${tableName}':`, error.message);
        return false;
      }
      return true;
    }
  } catch (err) {
    console.warn(`[Supabase] Write error for '${tableName}':`, err.message);
    return false;
  }
}

// Firestore Helper Functions
async function getFirestoreCollection(colName, seedData = []) {
  const db = getFirestoreInstance();
  if (!db) return null;
  try {
    const snapshot = await db.collection(colName).get();
    if (snapshot.empty) {
      if (seedData && (Array.isArray(seedData) ? seedData.length > 0 : Object.keys(seedData).length > 0)) {
        saveFirestoreCollection(colName, seedData).catch(() => {});
        return seedData;
      }
      return Array.isArray(seedData) ? [] : seedData;
    }

    if (Array.isArray(seedData)) {
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      const doc = snapshot.docs[0];
      return doc ? doc.data() : seedData;
    }
  } catch (err) {
    console.warn(`[Firestore] Read error for '${colName}':`, err.message);
    firestoreAvailable = false;
    return null;
  }
}

async function saveFirestoreCollection(colName, data) {
  const db = getFirestoreInstance();
  if (!db) return false;
  try {
    if (Array.isArray(data)) {
      const batch = db.batch();
      const existingSnap = await db.collection(colName).get();
      existingSnap.docs.forEach(doc => batch.delete(doc.ref));

      data.forEach(item => {
        const id = item.id || item.email || item.phone || db.collection(colName).doc().id;
        const ref = db.collection(colName).doc(String(id));
        batch.set(ref, item);
      });
      await batch.commit();
    } else {
      await firestoreDb.collection(colName).doc('main').set(data);
    }
    return true;
  } catch (err) {
    console.warn(`[Firestore] Write error for '${colName}':`, err.message);
    firestoreAvailable = false;
    return false;
  }
}

export async function getListings() {
  if (cache.listings !== null) return cache.listings;
  const sbData = await getSupabaseCollection('listings', SEED);
  if (sbData !== null) {
    cache.listings = sbData;
    return sbData;
  }
  const fsData = await getFirestoreCollection('listings', SEED);
  const data = fsData !== null ? fsData : await listingsStore.read();
  cache.listings = data;
  return data;
}

export async function saveListings(listings) {
  cache.listings = listings;
  saveSupabaseCollection('listings', listings).catch(() => {});
  saveFirestoreCollection('listings', listings).catch(() => {});
  await listingsStore.write(listings);
}

export async function getUsers() {
  if (cache.users !== null) return cache.users;
  const sbData = await getSupabaseCollection('users', []);
  if (sbData !== null) {
    cache.users = sbData;
    return sbData;
  }
  const fsData = await getFirestoreCollection('users', []);
  const data = fsData !== null ? fsData : await usersStore.read();
  cache.users = data;
  return data;
}

export async function saveUsers(users) {
  cache.users = users;
  saveSupabaseCollection('users', users).catch(() => {});
  saveFirestoreCollection('users', users).catch(() => {});
  await usersStore.write(users);
}

export async function getReports() {
  if (cache.reports !== null) return cache.reports;
  const sbData = await getSupabaseCollection('reports', []);
  if (sbData !== null) {
    cache.reports = sbData;
    return sbData;
  }
  const fsData = await getFirestoreCollection('reports', []);
  const data = fsData !== null ? fsData : await reportsStore.read();
  cache.reports = data;
  return data;
}

export async function saveReports(reports) {
  cache.reports = reports;
  saveSupabaseCollection('reports', reports).catch(() => {});
  saveFirestoreCollection('reports', reports).catch(() => {});
  await reportsStore.write(reports);
}

export async function getCategories() {
  if (cache.categories !== null) return cache.categories;
  const sbData = await getSupabaseCollection('categories', CATEGORIES_SEED);
  if (sbData !== null) {
    cache.categories = sbData;
    return sbData;
  }
  const fsData = await getFirestoreCollection('categories', CATEGORIES_SEED);
  const data = fsData !== null ? fsData : await categoriesStore.read();
  cache.categories = data;
  return data;
}

export async function saveCategories(categories) {
  cache.categories = categories;
  saveSupabaseCollection('categories', categories).catch(() => {});
  saveFirestoreCollection('categories', categories).catch(() => {});
  await categoriesStore.write(categories);
}

export async function getSettings() {
  if (cache.settings !== null) return cache.settings;
  const sbData = await getSupabaseCollection('settings', SETTINGS_SEED);
  if (sbData !== null) {
    cache.settings = sbData;
    return sbData;
  }
  const fsData = await getFirestoreCollection('settings', SETTINGS_SEED);
  const data = fsData !== null ? fsData : await settingsStore.read();
  cache.settings = data;
  return data;
}

export async function saveSettings(settings) {
  cache.settings = settings;
  saveSupabaseCollection('settings', settings).catch(() => {});
  saveFirestoreCollection('settings', settings).catch(() => {});
  await settingsStore.write(settings);
}

export async function getInquiries() {
  if (cache.inquiries !== null) return cache.inquiries;
  const sbData = await getSupabaseCollection('inquiries', []);
  if (sbData !== null) {
    cache.inquiries = sbData;
    return sbData;
  }
  const fsData = await getFirestoreCollection('inquiries', []);
  const data = fsData !== null ? fsData : await inquiriesStore.read();
  cache.inquiries = data;
  return data;
}

export async function saveInquiries(inquiries) {
  cache.inquiries = inquiries;
  saveSupabaseCollection('inquiries', inquiries).catch(() => {});
  saveFirestoreCollection('inquiries', inquiries).catch(() => {});
  await inquiriesStore.write(inquiries);
}


