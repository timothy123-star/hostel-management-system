import crypto from 'crypto';
import { getDb } from '../db/connection.js';

export class AuditService {
  static log(params: {
    adminId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValues?: any;
    newValues?: any;
    notes?: string;
  }) {
    const db = getDb();
    const id = `audit-${crypto.randomUUID()}`;
    const oldStr = params.oldValues ? JSON.stringify(params.oldValues) : null;
    const newStr = params.newValues ? JSON.stringify(params.newValues) : null;

    db.prepare(`
      INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_values, new_values, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      params.adminId || null,
      params.action,
      params.entityType,
      params.entityId,
      oldStr,
      newStr,
      params.notes || null
    );
  }

  static getLogs(limit = 100) {
    const db = getDb();
    return db.prepare(`
      SELECT al.*, au.full_name as admin_name, au.username as admin_username
      FROM audit_logs al
      LEFT JOIN admin_users au ON al.admin_id = au.id
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(limit);
  }
}
