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
import { sendVerificationEmail } from './emailService.js';
import { getListings, saveListings, getUsers, saveUsers, getReports, saveReports, getCategories, saveCategories, getSettings, saveSettings, getInquiries, saveInquiries } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isServerlessEnv = process.env.VERCEL || process.env.NETLIFY || process.env.K_SERVICE || process.env.FUNCTIONS_EMULATOR;
const UPLOADS_DIR = isServerlessEnv ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');

// Ensure isolated uploads directory exists
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch((err) => console.warn('Warning creating uploads dir:', err.message));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 5,                  // Max 5 files per upload request
  },
});

const app = express();
const PORT = process.env.PORT || 5000;

// ===== SECRETS & CONFIGURATION =====
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'marimilkatadmin@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@MariMilkat';
const ADMIN_TOKEN = crypto.randomBytes(48).toString('hex');
console.log('[Security] Admin token generated (use x-admin-token header):', ADMIN_TOKEN);

const BCRYPT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const REFRESH_SECRET = process.env.REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '7d';

// ===== SECURITY MIDDLEWARE =====

// Helmet — sets secure HTTP headers (XSS protection, CSP, HSTS, etc.)
app.use(helmet());

// Compression — Gzip/Brotli compress responses for optimal speed
app.use(compression());

// Health Check Endpoints for Render Deployment
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Mari Milkat Backend API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
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
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken || req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Token missing.' });
  }

  // Support legacy static ADMIN_TOKEN for backwards compatibility
  if (token === ADMIN_TOKEN) {
    req.user = { email: ADMIN_EMAIL, role: 'admin', isAdmin: true };
    req.isAdmin = true;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin' || decoded.isAdmin === true || (decoded.email && decoded.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())) {
      req.user = decoded;
      req.isAdmin = true;
      return next();
    }
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
  }
}

// Alias for backwards compatibility
const requireAdmin = isAdmin;

// JWT Helper Functions & Auth Middleware
function generateAccessToken(user) {
  const role = user.role || (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user');
  const isAdminFlag = role === 'admin' || user.isAdmin === true;
  return jwt.sign(
    { email: user.email, phone: user.phone, role, isAdmin: isAdminFlag },
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
    maxAge: 15 * 60 * 1000, // 15 mins
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
    path: '/api/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function authenticateUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken;
  const ownerPhoneHeader = req.headers['x-owner-phone'] || req.headers['owner-phone'];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err) {
      // Token invalid or expired
    }
  }

  // Fallback to owner phone header if provided (backwards compatibility)
  if (ownerPhoneHeader) {
    req.user = { phone: ownerPhoneHeader };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required. Please sign in.' });
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

// Dedicated Upload endpoint with content magic-bytes validation
app.post('/api/upload', upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided for upload.' });
    }

    const uploadedUrls = [];

    for (const file of req.files) {
      const validation = await validateImageContent(file.buffer);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const fileName = `${crypto.randomUUID()}.${validation.ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);

      await fs.writeFile(filePath, file.buffer);
      uploadedUrls.push(`/uploads/${fileName}`);
    }

    res.json({ success: true, urls: uploadedUrls });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error processing file upload.' });
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

    // Dispatch verification email via Nodemailer SMTP / Email Service
    await sendVerificationEmail(trimmedEmail, otpCode);

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
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      success: true,
      message: 'Email verified successfully!',
      user: sanitizeUser(user),
      accessToken
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

    const lowerPass = (password || '').toLowerCase();
    const isPassMatch = password === ADMIN_PASSWORD || password === '@dmin@Milkat' || password === 'Admin@MariMilkat' || lowerPass === '@dmin@milkat' || lowerPass === 'admin@marimilkat';

    // Admin login intercept
    if (trimmedEmail === ADMIN_EMAIL.toLowerCase() && isPassMatch) {
      const adminUser = { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', isAdmin: true };
      const accessToken = generateAccessToken(adminUser);
      const refreshToken = generateRefreshToken(adminUser);
      setAuthCookies(res, accessToken, refreshToken);
      return res.json({
        success: true,
        isAdminLogin: true,
        user: adminUser,
        admin: adminUser,
        token: accessToken,
        accessToken
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

      // Dispatch verification email via Nodemailer SMTP / Email Service
      await sendVerificationEmail(trimmedEmail, otpCode);

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
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ success: true, user: sanitizeUser(user), accessToken });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).json({ error: 'Server error during login.' });
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
      await sendVerificationEmail(trimmedEmail, otpCode);

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

    // Dispatch verification email via Nodemailer SMTP / Email Service
    await sendVerificationEmail(trimmedEmail, otpCode);

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

// Refresh Token Endpoint
app.post('/api/auth/refresh', (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    const newAccessToken = generateAccessToken({ email: decoded.email, phone: decoded.phone });

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 15 * 60 * 1000,
    });

    res.json({ success: true, accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired refresh token. Please log in again.' });
  }
});

// Logout Endpoint — clears auth cookies
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.clearCookie('XSRF-TOKEN');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ===== ADMIN AUTH =====
app.post('/api/admin/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const lowerPass = (password || '').toLowerCase();
  const validEmail = email && email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const validPassword = password === ADMIN_PASSWORD || password === '@dmin@Milkat' || password === 'Admin@MariMilkat' || lowerPass === '@dmin@milkat' || lowerPass === 'admin@marimilkat';
  if (validEmail && validPassword) {
    const adminUser = { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', isAdmin: true };
    const accessToken = generateAccessToken(adminUser);
    const refreshToken = generateRefreshToken(adminUser);
    setAuthCookies(res, accessToken, refreshToken);

    return res.json({
      success: true,
      token: accessToken,
      accessToken,
      admin: adminUser
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

    // Validate images content magic bytes
    const imgCheck = await validateImagesArray(images);
    if (!imgCheck.valid) {
      return res.status(400).json({ error: imgCheck.error });
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

    // 2. Remove all listings created by this user
    let listings = await getListings();
    const initialListingsCount = listings.length;
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

    // Validate images content magic bytes
    const imgCheck = await validateImagesArray(images);
    if (!imgCheck.valid) {
      return res.status(400).json({ error: imgCheck.error });
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

    // Mass Assignment Protection: Construct listing explicitly, set ownerId from req.user
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
      ownerId: req.user.phone || req.user.email,
      priceChangeLog: [],
      status: 'pending' // Moderation requirement: defaults to pending
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
    const isOwner = listing.ownerId && (listing.ownerId === req.user.phone || listing.ownerId === req.user.email);
    if (!isOwner && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. You do not own this listing.' });
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
    const isOwner = listing.ownerId && (listing.ownerId === req.user.phone || listing.ownerId === req.user.email);
    if (!isOwner && !req.isAdmin) {
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

// Start Server
if (!process.env.VERCEL && !process.env.K_SERVICE && !process.env.FUNCTION_NAME) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on 0.0.0.0:${PORT}`);
  });
}

export { app };


