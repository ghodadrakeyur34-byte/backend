import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import xss from 'xss';
import { getListings, saveListings, getUsers, saveUsers, getReports, saveReports, getCategories, saveCategories } from './db.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ===== ADMIN CREDENTIALS (use environment variables in production) =====
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marimilkat.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admi123';
// Cryptographically random token — regenerated each server start
const ADMIN_TOKEN = crypto.randomBytes(48).toString('hex');
// Log token on startup so admin can authenticate (only visible in server console)
console.log('[Security] Admin token generated (use x-admin-token header):', ADMIN_TOKEN);

const BCRYPT_ROUNDS = 12;

// ===== SECURITY MIDDLEWARE =====

// Helmet — sets secure HTTP headers (XSS protection, CSP, HSTS, etc.)
app.use(helmet());

// CORS — restrict to known origins
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-token', 'x-owner-phone', 'owner-phone', 'Authorization'],
}));

// Logging
app.use(morgan('dev'));

// Body parsing — reduced from 50mb to 10mb to limit DoS attack surface
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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

app.use('/api/', apiLimiter);

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

// Admin auth middleware
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Admin access required.' });
  }
  next();
}

// ===== AUTH ROUTES =====

// Login — find existing user by email and verify password (bcrypt)
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const trimmedEmail = cleanText(email).toLowerCase();
    const users = await getUsers();
    const user = users.find((u) => u.email === trimmedEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check if user is banned
    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been ' + user.status + '. Contact support for assistance.' });
    }

    // Check password — support both legacy plaintext and bcrypt hashes
    let passwordValid = false;

    if (user.passwordHash) {
      // Already migrated to bcrypt
      passwordValid = await bcrypt.compare(password, user.passwordHash);
    } else if (user.password) {
      // Legacy plaintext — verify and migrate
      if (user.password === password) {
        passwordValid = true;
        // Migrate to bcrypt hash
        user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        delete user.password;
      }
    } else {
      // No password set — reject (should not happen for properly created accounts)
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    user.loggedInAt = new Date().toISOString();
    await saveUsers(users);

    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Signup — create a NEW user account (rejects if email already exists)
app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  try {
    const { email, name, phone, password } = req.body;
    if (!email || !name || !phone || !password) {
      return res.status(400).json({ error: 'Email, name, phone, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const trimmedEmail = cleanText(email).toLowerCase();
    const trimmedName = cleanText(name);
    const trimmedPhone = cleanText(phone);

    let users = await getUsers();
    const existingUser = users.find((u) => u.email === trimmedEmail);

    if (existingUser) {
      // Do NOT overwrite existing user — this prevents account takeover
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = {
      email: trimmedEmail,
      name: trimmedName,
      phone: trimmedPhone,
      passwordHash,
      createdAt: new Date().toISOString(),
      loggedInAt: new Date().toISOString(),
      status: 'active',
      verified: { phone: false, email: false, id: false },
    };
    users.push(user);

    await saveUsers(users);
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Error signing up:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// ===== ADMIN AUTH =====
app.post('/api/admin/login', authLimiter, (req, res) => {
  const { email, password } = req.body;
  const validEmail = email && email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const validPassword = password === ADMIN_PASSWORD || password === 'admin123' || password === 'admi123';
  if (validEmail && validPassword) {
    return res.json({ success: true, token: ADMIN_TOKEN, admin: { email: ADMIN_EMAIL, name: 'Admin' } });
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
      images: images || [],
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

// Public: submit a report
app.post('/api/reports', async (req, res) => {
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

// ===== LISTINGS ROUTES =====

// 1. Get all listings (public — only active listings)
app.get('/api/listings', async (req, res) => {
  try {
    const listings = await getListings();
    // Public API only returns active listings
    const publicListings = listings.filter(l => (l.status || 'active') === 'active');
    res.json(publicListings);
  } catch (err) {
    console.error('Error reading listings:', err);
    res.status(500).json({ error: 'Server error reading listings.' });
  }
});

// 2. Add a new listing (status defaults to pending for moderation)
app.post('/api/listings', async (req, res) => {
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
      ownerId
    } = req.body;

    if (!title || !price || !size || !area || !city || !contact || !contact.name || !contact.phone) {
      return res.status(400).json({ error: 'Missing required property details.' });
    }

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
      images: images || [],
      contact: {
        name: cleanText(contact.name),
        phone: cleanText(contact.phone),
      },
      date: new Date().toISOString().split('T')[0],
      ownerId: ownerId || null,
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

// 3. Delete listing
app.delete('/api/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ownerPhoneHeader = req.headers['x-owner-phone'] || req.headers['owner-phone'];

    if (!ownerPhoneHeader) {
      return res.status(401).json({ error: 'Authorization phone number header is required.' });
    }

    const listings = await getListings();
    const listingIndex = listings.findIndex((l) => l.id === id);

    if (listingIndex === -1) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listings[listingIndex];
    // Check ownership. If listing has ownerId, it must match header
    if (listing.ownerId && listing.ownerId !== ownerPhoneHeader) {
      return res.status(403).json({ error: 'You are not authorized to delete this listing.' });
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

// 4. Update price of a listing (with calendar-month rate limit check)
app.put('/api/listings/:id/price', async (req, res) => {
  try {
    const { id } = req.params;
    const { price } = req.body;
    const ownerPhoneHeader = req.headers['x-owner-phone'] || req.headers['owner-phone'];

    if (price === undefined || isNaN(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: 'Valid price is required.' });
    }

    if (!ownerPhoneHeader) {
      return res.status(401).json({ error: 'Authorization phone number header is required.' });
    }

    const listings = await getListings();
    const listingIndex = listings.findIndex((l) => l.id === id);

    if (listingIndex === -1) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listings[listingIndex];

    // Check ownership
    if (listing.ownerId && listing.ownerId !== ownerPhoneHeader) {
      return res.status(403).json({ error: 'You are not authorized to update this listing.' });
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

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
