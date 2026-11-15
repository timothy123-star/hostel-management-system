import { config } from '../../config.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface WhatsAppMediaDescriptor {
  url: string;
  mimeType?: string;
  fileSize?: number;
}

function mediaBase(): string {
  return `https://graph.facebook.com/${config.meta.graphApiVersion}`;
}

function authHeaders(): Record<string, string> {
  return { Authorization: 'Bearer ' + config.meta.accessToken };
}

export class WhatsAppMediaService {
  static async getMediaDownload(descriptor: { id: string }): Promise<{ bytes: Buffer; mimeType: string }> {
    if (!config.meta.accessToken) throw new Error('WhatsApp media download is not configured.');
    if (!descriptor.id || typeof descriptor.id !== 'string') throw new Error('Invalid WhatsApp media reference.');

    const infoRes = await fetch(`${mediaBase()}/${encodeURIComponent(descriptor.id)}`, { headers: authHeaders() });
    if (!infoRes.ok) throw new Error('Unable to retrieve the WhatsApp image. Please resend it.');
    const info = (await infoRes.json()) as WhatsAppMediaDescriptor;
    if (!info || typeof info.url !== 'string' || !info.url.startsWith('https://')) {
      throw new Error('Unable to retrieve the WhatsApp image. Please resend it.');
    }
    if (typeof info.fileSize === 'number' && info.fileSize > MAX_IMAGE_BYTES) {
      throw new Error('The photograph must be 5 MB or smaller.');
    }
    if (info.mimeType && !ALLOWED_MIME.has(info.mimeType)) {
      throw new Error('Please send a JPEG, PNG, or WebP photograph.');
    }

    const fileRes = await fetch(info.url, { headers: authHeaders() });
    if (!fileRes.ok) throw new Error('Unable to download the WhatsApp image. Please resend it.');
    const contentType = (fileRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !ALLOWED_MIME.has(contentType)) {
      throw new Error('Please send a JPEG, PNG, or WebP photograph.');
    }
    const lengthHeader = fileRes.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_IMAGE_BYTES) {
      throw new Error('The photograph must be 5 MB or smaller.');
    }
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    if (bytes.length === 0) throw new Error('The received photograph was empty. Please resend it.');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('The photograph must be 5 MB or smaller.');
    return { bytes, mimeType: contentType || info.mimeType || 'application/octet-stream' };
  }
}
