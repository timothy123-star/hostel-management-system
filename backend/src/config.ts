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
  dbPath: process.env.DATABASE_FILE
    ? path.resolve(process.env.DATABASE_FILE)
    : path.resolve(__dirname, '../../hostel.sqlite'),
  // Deliberately not under a public/static web root. Files are only for a
  // future authenticated management review flow.
  photoStorageDir: process.env.PHOTO_STORAGE_DIR
    ? path.resolve(process.env.PHOTO_STORAGE_DIR)
    : path.resolve(__dirname, '../../private-uploads/student-photos'),
  publicAppUrl: (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  
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
