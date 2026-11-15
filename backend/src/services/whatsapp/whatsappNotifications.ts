import crypto from 'crypto';
import { getDb } from '../../db/connection.js';
import { WhatsAppService } from './whatsappService.js';
import { AuditService } from '../auditService.js';

export type NotificationKind = 'PAYMENT_APPROVED' | 'PAYMENT_REJECTED' | 'PHOTO_APPROVED' | 'PHOTO_REJECTED' | 'QR_ISSUED';

export function isWithin24hWindow(phone: string): boolean {
  try {
    const row = getDb().prepare('SELECT last_active_at FROM whatsapp_conversations WHERE phone_number = ?').get(phone.trim()) as any;
    if (!row?.last_active_at) return false;
    const last = new Date(row.last_active_at).getTime();
    if (Number.isNaN(last)) return false;
    return Date.now() - last < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function templateParamsJson(params: string[] | undefined): string | null {
  if (params === undefined) return null;
  return JSON.stringify(params.map((v) => String(v)));
}

function resolveTemplateParams(row: any): string[] | null {
  const raw = row?.template_params;
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch { /* fall through to legacy text */ }
    return null;
  }
  return null;
}

export class WhatsAppNotificationService {
  static queueAndSend(opts: {
    dedupeKey: string;
    studentId?: string | null;
    phone: string;
    kind: NotificationKind;
    bodyText: string;
    templateName?: string;
    templateParams?: string[];
  }): { status: string; notificationId: string } {
    const db = getDb();
    const now = new Date().toISOString();
    const id = `wano-${crypto.randomUUID()}`;
    try {
      db.prepare(`INSERT INTO whatsapp_notifications (id, dedupe_key, student_id, phone_number, kind, body_text, template_name, template_params, status, attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?)`).run(
        id, opts.dedupeKey, opts.studentId || null, opts.phone.trim(), opts.kind, opts.bodyText, opts.templateName || null, templateParamsJson(opts.templateParams), now, now
      );
    } catch {
      const existing = db.prepare('SELECT * FROM whatsapp_notifications WHERE dedupe_key = ?').get(opts.dedupeKey) as any;
      if (existing) return { status: existing.status, notificationId: existing.id };
      throw new Error('Notification queue insert failed.');
    }
    try {
      AuditService.log({
        action: 'WHATSAPP_NOTIFICATION_QUEUED',
        entityType: 'WHATSAPP_NOTIFICATION',
        entityId: id,
        newValues: { kind: opts.kind },
        notes: `Resident notification ${opts.kind} queued`,
      } as any);
    } catch { /* audit best-effort */ }
    // Best-effort async delivery; never blocks the triggering manager action.
    void this.tryDeliver(id).catch(() => undefined);
    return { status: 'QUEUED', notificationId: id };
  }

  static async tryDeliver(notificationId: string): Promise<{ status: string; messageId?: string }> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM whatsapp_notifications WHERE id = ?').get(notificationId) as any;
    if (!row) throw new Error('Notification not found.');
    if (row.status === 'SENT') return { status: 'SENT', messageId: row.meta_message_id || undefined };
    const provider = WhatsAppService.getProvider();
    const withinWindow = isWithin24hWindow(row.phone_number);
    const now = new Date().toISOString();
    db.prepare('UPDATE whatsapp_notifications SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(now, row.id);
    try {
      let res: any;
      if (!withinWindow) {
        if (!row.template_name) {
          db.prepare(`UPDATE whatsapp_notifications SET status = 'PENDING_TEMPLATE', error = ?, updated_at = ? WHERE id = ?`)
            .run('Outside 24h customer-service window; approved template required.', now, row.id);
          return { status: 'PENDING_TEMPLATE' };
        }
        if (typeof (provider as any).sendTemplateMessage === 'function') {
          res = await (provider as any).sendTemplateMessage(row.phone_number, row.template_name, 'en', resolveTemplateParams(row) ?? [row.body_text]);
        } else {
          res = await provider.sendTextMessage(row.phone_number, row.body_text);
        }
      } else {
        res = await provider.sendTextMessage(row.phone_number, row.body_text);
      }
      const messageId = res?.messages?.[0]?.id || res?.messageId || res?.id || null;
      const looksSimulated = !!(res?.simulated || res?.success);
      if (!messageId && !looksSimulated) {
        throw new Error('Meta rejected the notification (no message id returned).');
      }
      db.prepare(`UPDATE whatsapp_notifications SET status = 'SENT', meta_message_id = ?, sent_at = ?, error = NULL, updated_at = ? WHERE id = ?`)
        .run(messageId, now, now, row.id);
      return { status: 'SENT', messageId: messageId || undefined };
    } catch (err: any) {
      db.prepare(`UPDATE whatsapp_notifications SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?`)
        .run(String(err?.message || 'send failed').slice(0, 500), now, row.id);
      return { status: 'FAILED' };
    }
  }

  static markMetaStatus(metaMessageId: string, status: 'sent' | 'delivered' | 'failed', error?: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    if (status === 'failed') {
      db.prepare(`UPDATE whatsapp_notifications SET status = 'FAILED', error = COALESCE(?, error), updated_at = ? WHERE meta_message_id = ?`)
        .run(error ? String(error).slice(0, 500) : 'Meta reported failure', now, metaMessageId);
    }
  }

  static getForManager(status?: string): any[] {
    const db = getDb();
    if (status && status !== 'ALL') return db.prepare('SELECT * FROM whatsapp_notifications WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status);
    return db.prepare('SELECT * FROM whatsapp_notifications ORDER BY created_at DESC LIMIT 200').all();
  }
}
