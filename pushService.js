import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid_keys.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 1. Initialize or load VAPID keys
let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  if (fs.existsSync(VAPID_FILE)) {
    try {
      vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    } catch (e) {
      console.warn('[Push] Error reading existing VAPID keys:', e.message);
    }
  }

  if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    try {
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
      console.log('[Push] Generated new VAPID keys and saved to vapid_keys.json');
    } catch (err) {
      console.error('[Push] Failed to persist VAPID keys:', err.message);
    }
  }
}

// Configure web-push with VAPID details
const contactEmail = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@marimilkat.com';
try {
  webpush.setVapidDetails(contactEmail, vapidKeys.publicKey, vapidKeys.privateKey);
  console.log('[Push] VAPID details configured successfully.');
} catch (err) {
  console.error('[Push] Failed to set VAPID details:', err.message);
}

// 2. Helper functions to manage push subscriptions
export function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

export function getAllSubscriptions() {
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8')) || [];
  } catch (err) {
    console.error('[Push] Error reading subscriptions:', err.message);
    return [];
  }
}

function saveAllSubscriptions(subs) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2), 'utf8');
  } catch (err) {
    console.error('[Push] Error saving subscriptions:', err.message);
  }
}

export function addSubscription(subscription, user = null) {
  if (!subscription || !subscription.endpoint) return false;

  const subs = getAllSubscriptions();
  const existingIndex = subs.findIndex((s) => s.endpoint === subscription.endpoint);

  const subRecord = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userId: user?.id || user?.email || null,
    userEmail: user?.email ? String(user.email).toLowerCase() : null,
    userPhone: user?.phone ? String(user.phone).replace(/\D/g, '').slice(-10) : null,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    subs[existingIndex] = { ...subs[existingIndex], ...subRecord };
  } else {
    subRecord.createdAt = new Date().toISOString();
    subs.push(subRecord);
  }

  saveAllSubscriptions(subs);
  return true;
}

export function removeSubscription(endpoint) {
  if (!endpoint) return false;
  const subs = getAllSubscriptions();
  const filtered = subs.filter((s) => s.endpoint !== endpoint);
  saveAllSubscriptions(filtered);
  return true;
}

// 3. Send Web Push Notification to a single subscription
export async function sendPushNotification(subscription, payload) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return { success: false, error: 'Invalid subscription object' };
  }

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      payloadString
    );
    return { success: true };
  } catch (err) {
    // 404 or 410 means subscription has expired or unsubscribed
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.log('[Push] Subscription expired or unsubscribed. Removing:', subscription.endpoint);
      removeSubscription(subscription.endpoint);
    } else {
      console.error('[Push] Error sending push notification:', err.statusCode || err.message);
    }
    return { success: false, error: err.message, statusCode: err.statusCode };
  }
}

// 4. Send Web Push to specific user by email or phone
export async function sendPushToUser(identifier, payload) {
  if (!identifier) return { sent: 0 };
  const cleanId = String(identifier).trim().toLowerCase();
  const cleanPhone = cleanId.replace(/\D/g, '').slice(-10);

  const subs = getAllSubscriptions();
  const matching = subs.filter((s) => {
    if (s.userEmail && s.userEmail === cleanId) return true;
    if (cleanPhone && s.userPhone && s.userPhone === cleanPhone) return true;
    if (s.userId && String(s.userId).toLowerCase() === cleanId) return true;
    return false;
  });

  let sent = 0;
  for (const sub of matching) {
    const result = await sendPushNotification(sub, payload);
    if (result.success) sent++;
  }
  return { sent, totalMatched: matching.length };
}

// 5. Broadcast to all active subscribers
export async function broadcastPushNotification(payload) {
  const subs = getAllSubscriptions();
  let sent = 0;
  for (const sub of subs) {
    const res = await sendPushNotification(sub, payload);
    if (res.success) sent++;
  }
  return { sent, total: subs.length };
}

