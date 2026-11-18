import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'fallback-demo-secret-key-min-32-chars-long!',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'AdminPassword123!',
  adminFullName: process.env.ADMIN_FULL_NAME?.trim() || 'Hostel Manager',
  adminEmail: process.env.ADMIN_EMAIL?.trim() || 'manager@hostelos.local',
  dbPath: process.env.DATABASE_FILE
    ? path.resolve(process.env.DATABASE_FILE)
    : path.resolve(__dirname, '../../hostel.sqlite'),
  // Deliberately not under a public/static web root. Files are only for a
  // future authenticated management review flow.
  photoStorageDir: process.env.PHOTO_STORAGE_DIR
    ? path.resolve(process.env.PHOTO_STORAGE_DIR)
    : path.resolve(__dirname, '../../private-uploads/student-photos'),
  publicAppUrl: (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  qrVerificationBaseUrl: (process.env.QR_VERIFICATION_PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  qrTokenEncryptionKeyB64: (process.env.QR_TOKEN_ENCRYPTION_KEY || '').trim(),
  whatsappTemplates: {
    paymentApproved: process.env.WA_TEMPLATE_PAYMENT_APPROVED || 'hostelos_payment_approved',
    paymentRejected: process.env.WA_TEMPLATE_PAYMENT_REJECTED || 'hostelos_payment_rejected',
    photoApproved: process.env.WA_TEMPLATE_PHOTO_APPROVED || 'hostelos_photo_approved',
    photoRejected: process.env.WA_TEMPLATE_PHOTO_REJECTED || 'hostelos_photo_rejected',
    qrIssued: process.env.WA_TEMPLATE_QR_ISSUED || 'hostelos_qr_issued',
    qrImageFailed: process.env.WA_TEMPLATE_QR_IMAGE_FAILED || 'hostelos_qr_image_failed',
  },

  meta: {
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    appSecret: process.env.META_WHATSAPP_APP_SECRET || '',
    verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN || 'hostel_meta_verify_token_demo_2026',
    graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v21.0',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000'
  }
};

const knownDemoJwtSecrets = new Set([
  'fallback-demo-secret-key-min-32-chars-long!',
  'demo-secret-key-for-development-change-in-production-min-32-chars'
]);

const knownDemoAdminPasswords = new Set([
  'AdminPassword123!'
]);

/**
 * Production uses the raw environment rather than configuration fallbacks so
 * missing values cannot silently become development credentials.
 */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) throw new Error('Production configuration requires JWT_SECRET.');
  if (jwtSecret.length < 32) throw new Error('Production JWT_SECRET must be at least 32 characters.');
  if (knownDemoJwtSecrets.has(jwtSecret)) throw new Error('Production JWT_SECRET must not use a known demo or example secret.');

  const adminUsername = env.ADMIN_USERNAME?.trim();
  if (!adminUsername || adminUsername.length < 3 || adminUsername === 'admin') {
    throw new Error('Production configuration requires a non-default ADMIN_USERNAME.');
  }

  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('Production configuration requires ADMIN_PASSWORD.');
  if (adminPassword.length < 16) throw new Error('Production ADMIN_PASSWORD must be at least 16 characters.');
  if (knownDemoAdminPasswords.has(adminPassword)) {
    throw new Error('Production ADMIN_PASSWORD must not use a known demo or example password.');
  }

  // Monnify is OFF by default. Live activation requires explicit live
  // credentials; sandbox credentials must never be enabled in production.
  const monnifyEnabled = (env.MONNIFY_ENABLED || '').trim().toLowerCase() === 'true';
  if (monnifyEnabled) {
    const mode = (env.MONNIFY_MODE || '').trim().toLowerCase();
    if (mode !== 'live') throw new Error('Production Monnify activation requires MONNIFY_MODE=live.');
    if ((env.MONNIFY_BASE_URL || '').trim() !== 'https://api.monnify.com') {
      throw new Error('Production Monnify activation requires the approved live base URL.');
    }
    if (!(env.MONNIFY_API_KEY || '').trim() || !(env.MONNIFY_SECRET_KEY || '').trim() || !(env.MONNIFY_CONTRACT_CODE || '').trim()) {
      throw new Error('Production Monnify activation requires live API credentials and contract code.');
    }
  }
}
