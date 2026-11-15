import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import {
  Student,
  StudentRegistrationInput,
  HostelCode,
  StudentRegistrationSchema,
  phoneLookupCandidates,
} from '@hostel/shared';
import { BookingGroupService } from './bookingGroupService.js';
import { MatchingService } from './matchingService.js';
import { AuditService } from './auditService.js';

export class StudentService {
  /**
   * Registers a new student. Can be invoked via WhatsApp conversation or Manager UI.
   */
  static registerStudent(input: StudentRegistrationInput, adminId?: string): {
    student: Student;
    group?: any;
    queueItem?: any;
  } {
    // Single runtime contract for dashboard, WhatsApp and any future caller.
    // Zod applies normalization (NFC, trim, whitespace collapse, canonical
    // phone, uppercased invite code) and rejects invalid enums, lengths,
    // control characters and non-boolean consent values.
    const parsed = StudentRegistrationSchema.parse(input);
    const db = getDb();
    const cleanPhone = parsed.phone_number;

    // Duplicate detection covers both the canonical form used for new writes
    // and legacy representations already stored in the database.
    const phoneCandidates = Array.from(
      new Set([
        ...phoneLookupCandidates(cleanPhone),
        ...phoneLookupCandidates(String((input as any)?.phone_number ?? '')),
      ]),
    );
    const placeholders = phoneCandidates.map(() => '?').join(', ');
    const existing = db
      .prepare(`SELECT * FROM students WHERE phone_number IN (${placeholders})`)
      .get(...phoneCandidates) as any;
    if (existing) {
      throw new Error(`A student with phone number ${cleanPhone} is already registered.`);
    }

    const studentId = `stu-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const consent = parsed.consent_random_matching ? 1 : 0;
    const photoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(parsed.full_name)}`;

    let createdStudent: any = null;
    let group: any = null;
    let queueItem: any = null;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO students (
          id, full_name, phone_number, gender, department, academic_level,
          preferred_occupancy, roommate_mode, consent_random_matching, photo_url,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        studentId,
        parsed.full_name,
        cleanPhone,
        parsed.gender,
        parsed.department,
        parsed.academic_level,
        parsed.preferred_occupancy,
        parsed.roommate_mode,
        consent,
        photoUrl,
        now,
        now
      );

      // Notification preferences
      db.prepare(`
        INSERT INTO notification_preferences (id, student_id, whatsapp_enabled, renewal_reminders_enabled, announcements_enabled, updated_at)
        VALUES (?, ?, 1, 1, 1, ?)
      `).run(`np-${crypto.randomUUID()}`, studentId, now);

      createdStudent = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);

      // Handle Roommate Mode inside this same transaction so any
      // downstream failure rolls the student row back instead of
      // leaving an orphan record that blocks retry.
      if (parsed.roommate_mode === 'KNOWN') {
        if (parsed.group_invite_code) {
          // Joining existing group
          group = BookingGroupService.joinGroup(studentId, parsed.group_invite_code, parsed.auto_complete_triple_consent);
        } else {
          // Creating new booking group as leader
          group = BookingGroupService.createGroup({
            studentId,
            hostelCode: parsed.gender,
            targetCapacity: parsed.preferred_occupancy,
            autoCompleteTripleConsent: parsed.auto_complete_triple_consent
          });
        }
      } else if (parsed.roommate_mode === 'RANDOM' && parsed.consent_random_matching) {
        // Opt into random matching queue
        const queueId = MatchingService.addToQueue(studentId, parsed.gender, parsed.preferred_occupancy);
        queueItem = { id: queueId, student_id: studentId, status: 'WAITING' };
      }

      AuditService.log({
        adminId,
        action: 'REGISTER_STUDENT',
        entityType: 'STUDENT',
        entityId: studentId,
        newValues: {
          name: parsed.full_name,
          phone: cleanPhone,
          gender: parsed.gender,
          roommate_mode: parsed.roommate_mode
        },
        notes: `Student registered via ${adminId ? 'Dashboard' : 'WhatsApp channel'}`
      });
    })();

    const fullRecord = this.getStudentById(studentId)!;
    return { student: fullRecord, group, queueItem };
  }

  static getStudentById(studentId: string): Student | null {
    const db = getDb();
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as any;
    if (!student) return null;

    // Get group
    const membership = db.prepare(`
      SELECT bgm.group_id 
      FROM booking_group_members bgm
      JOIN booking_groups bg ON bgm.group_id = bg.id
      WHERE bgm.student_id = ? AND bg.status != 'CANCELLED'
      ORDER BY bg.created_at DESC
      LIMIT 1
    `).get(studentId) as any;

    let current_group: any = undefined;
    if (membership) {
      current_group = BookingGroupService.getGroupById(membership.group_id);
    }

    // Get allocation & room
    const alloc = db.prepare(`
      SELECT ra.*, r.room_number, r.capacity, r.price_per_student, r.status as room_status,
             h.name as hostel_name, h.code as hostel_code
      FROM room_allocations ra
      JOIN rooms r ON ra.room_id = r.id
      JOIN hostels h ON r.hostel_id = h.id
      WHERE ra.student_id = ? AND ra.status IN ('HOLD', 'FINALIZED')
      ORDER BY ra.created_at DESC
      LIMIT 1
    `).get(studentId) as any;

    let current_allocation: any = undefined;
    if (alloc) {
      current_allocation = {
        id: alloc.id,
        room_id: alloc.room_id,
        student_id: alloc.student_id,
        booking_group_id: alloc.booking_group_id,
        status: alloc.status,
        allocated_by_admin_id: alloc.allocated_by_admin_id,
        accommodation_start_date: alloc.accommodation_start_date,
        accommodation_end_date: alloc.accommodation_end_date,
        created_at: alloc.created_at,
        updated_at: alloc.updated_at,
        room_number: alloc.room_number,
        hostel_code: alloc.hostel_code,
        room: {
          id: alloc.room_id,
          hostel_id: alloc.hostel_id,
          room_number: alloc.room_number,
          capacity: alloc.capacity,
          price_per_student: alloc.price_per_student,
          status: alloc.room_status,
          hostel_code: alloc.hostel_code,
          created_at: alloc.created_at,
          updated_at: alloc.updated_at
        }
      };
    }

    // Get payment
    const payment = current_allocation
      ? db.prepare(`SELECT * FROM payments WHERE student_id = ? AND booking_group_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(studentId, current_allocation.booking_group_id) as any
      : db.prepare(`SELECT * FROM payments WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(studentId) as any;

    // New manager-authorized resident credential history (legacy credentials
    // remain preserved separately and are not used for access decisions).
    const qr = db.prepare(`
      SELECT * FROM resident_qr_credentials WHERE student_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(studentId) as any;

    const currentPhoto = db.prepare(`
      SELECT ps.status FROM students s JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ?
    `).get(studentId) as any;

    return {
      ...student,
      photo_status: currentPhoto?.status || student.photo_status,
      current_group,
      current_allocation,
      payment,
      qr_credential: qr
    };
  }

  static getStudentByPhone(phoneNumber: string): Student | null {
    const db = getDb();
    // Canonical-first lookup that remains compatible with legacy rows stored
    // before canonicalization (bare digits or separator variants).
    for (const candidate of phoneLookupCandidates(phoneNumber)) {
      const student = db.prepare('SELECT id FROM students WHERE phone_number = ?').get(candidate) as any;
      if (student) return this.getStudentById(student.id);
    }
    return null;
  }

  /** Escape LIKE wildcards so manager search cannot over-match. */
  private static escapeLikeSearch(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  static getStudents(params?: {
    search?: string;
    gender?: HostelCode;
    level?: string;
    limit?: number;
  }): Student[] {
    const db = getDb();
    let query = 'SELECT id FROM students WHERE 1=1';
    const sqlParams: any[] = [];

    if (params?.gender) {
      query += ' AND gender = ?';
      sqlParams.push(params.gender);
    }
    if (params?.level) {
      query += ' AND academic_level = ?';
      sqlParams.push(params.level);
    }
    if (params?.search) {
      query += ' AND (full_name LIKE ? ESCAPE \'\\\' OR phone_number LIKE ? ESCAPE \'\\\' OR department LIKE ? ESCAPE \'\\\')';
      const s = `%${this.escapeLikeSearch(params.search)}%`;
      sqlParams.push(s, s, s);
    }

    query += ' ORDER BY created_at DESC';
    if (params?.limit) {
      query += ' LIMIT ?';
      sqlParams.push(params.limit);
    }

    const rows = db.prepare(query).all(...sqlParams) as any[];
    return rows.map(r => this.getStudentById(r.id)!);
  }
}
