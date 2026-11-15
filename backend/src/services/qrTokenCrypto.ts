import crypto from 'crypto';
import { config } from '../config.js';

function getKey(): Buffer | null {
  const b64 = (config.qrTokenEncryptionKeyB64 || '').trim();
  if (!b64) return null;
  try {
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

export function isQrEncryptionConfigured(): boolean {
  return getKey() !== null;
}

export function validateQrEncryptionKeyOrThrow(): void {
  const raw = (config.qrTokenEncryptionKeyB64 || '').trim();
  if (!raw) return;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('QR_TOKEN_ENCRYPTION_KEY must be base64 of 32 random bytes (AES-256).');
  }
}

export function encryptQrToken(rawToken: string): string {
  const key = getKey();
  if (!key) throw new Error('QR token encryption is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptQrToken(payloadB64: string): string {
  const key = getKey();
  if (!key) throw new Error('QR token encryption is not configured.');
  const buf = Buffer.from(payloadB64, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Invalid encrypted QR payload.');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
