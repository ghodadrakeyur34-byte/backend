import { onRequest } from 'firebase-functions/v2/https';
import { app } from './server.js';

// Export as Firebase Cloud Function
export const api = onRequest({ cors: true, timeoutSeconds: 60, memory: '512MiB' }, app);
