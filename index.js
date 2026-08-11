import { onRequest } from 'firebase-functions/v2/https';
import { app } from './server.js';

const PORT = process.env.PORT || 5000;

if (!process.env.K_SERVICE && !process.env.FIREBASE_CONFIG) {
  app.listen(PORT, () => {
    console.log(`[Backend API] Express server running on port ${PORT}`);
  });
}

export const api = onRequest({ cors: true }, app);
