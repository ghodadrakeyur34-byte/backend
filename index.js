import { onRequest } from 'firebase-functions/v2/https';
import { app } from './server.js';

const PORT = process.env.PORT || 5000;

if (!process.env.K_SERVICE && !process.env.FIREBASE_CONFIG) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend API] Express server running on 0.0.0.0:${PORT}`);
  });
}

export const api = onRequest({ cors: true }, app);
