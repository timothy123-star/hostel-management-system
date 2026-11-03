import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { BookingGroup, BookingGroupStatus, RoomCapacity, HostelCode } from '@hostel/shared';

export class BookingGroupService {
  /**
   * Generates a short, memorable invitation code (e.g. GRP-M7K2)
   */
  static generateGroupCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'GRP-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Creates a new booking group for a leader student
   */
  static createGroup(params: {
    studentId: string;
    hostelCode: HostelCode;
    targetCapacity: RoomCapacity;
    autoCompleteTripleConsent?: boolean;
  }): BookingGroup {
    const db = getDb();

    // Check if student already in an active group
    const existingMembership = db.prepare(`
      SELECT bgm.group_id, bg.status 
      FROM booking_group_members bgm
      JOIN booking_groups bg ON bgm.group_id = bg.id
      WHERE bgm.student_id = ? AND bg.status IN ('FORMING', 'READY_FOR_ALLOCATION', 'ALLOCATED')
    `).get(params.studentId) as any;

    if (existingMembership) {
      throw new Error('Student already belongs to an active booking group.');
    }

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(params.studentId) as any;
    if (!student) {
      throw new Error('Student not found');
    }
    if (student.gender !== params.hostelCode) {
      throw new Error(`Hostel facility (${params.hostelCode}) does not match student gender (${student.gender})`);
    }

    const hostel = db.prepare('SELECT * FROM hostels WHERE code = ?').get(params.hostelCode) as any;
    if (!hostel) {
      throw new Error('Hostel facility not found');
    }

    // Generate unique code
    let groupCode = this.generateGroupCode();
    let collision = db.prepare('SELECT id FROM booking_groups WHERE group_code = ?').get(groupCode);
    while (collision) {
      groupCode = this.generateGroupCode();
      collision = db.prepare('SELECT id FROM booking_groups WHERE group_code = ?').get(groupCode);
    }

    const groupId = `grp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    // If single occupancy, it is immediately complete!
    const isComplete = params.targetCapacity === 1;
    const initialStatus: BookingGroupStatus = isComplete ? 'READY_FOR_ALLOCATION' : 'FORMING';
    const eligibleAt = isComplete ? now : null;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, auto_complete_triple_consent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(groupId, groupCode, hostel.id, params.targetCapacity, initialStatus, params.studentId, eligibleAt, params.autoCompleteTripleConsent ? 1 : 0, now, now);

      const memberId = `bgm-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, auto_complete_triple_consent, joined_at)
        VALUES (?, ?, ?, 'LEADER', 0, ?, ?)
      `).run(memberId, groupId, params.studentId, params.autoCompleteTripleConsent ? 1 : 0, now);

      // Create initial payment record
      const roomPrice = db.prepare('SELECT price_per_student FROM rooms WHERE hostel_id = ? AND capacity = ? LIMIT 1')
        .get(hostel.id, params.targetCapacity) as any;
      const amount = roomPrice ? roomPrice.price_per_student : (params.targetCapacity === 1 ? 1200 : params.targetCapacity === 2 ? 800 : 600);

      const paymentId = `pay-${crypto.randomUUID()}`;
      const refCode = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      db.prepare(`
        INSERT INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'USD', 'PENDING', ?, ?, ?)
      `).run(paymentId, params.studentId, groupId, amount, refCode, now, now);

    })();

    if (isComplete) this.assignProvisionalHolds(hostel.id, params.targetCapacity);

    return this.getGroupById(groupId)!;
  }

  /**
   * Roommate joins an existing booking group with an invite code.
   */
  static joinGroup(studentId: string, groupCode: string, autoCompleteTripleConsent = false): BookingGroup {
    const db = getDb();
    const cleanCode = groupCode.trim().toUpperCase();

    const group = db.prepare(`
      SELECT bg.*, h.code as hostel_code 
      FROM booking_groups bg
      JOIN hostels h ON bg.hostel_id = h.id
      WHERE bg.group_code = ?
    `).get(cleanCode) as any;

    if (!group) {
      throw new Error(`Invitation code "${cleanCode}" was not found.`);
    }

    if (group.status !== 'FORMING') {
      throw new Error(`This booking group is already ${group.status.toLowerCase().replace('_', ' ')} and no longer accepting new members.`);
    }

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as any;
    if (!student) {
      throw new Error('Student not found');
    }

    if (student.gender !== group.hostel_code) {
      throw new Error(`This group is registered in the ${group.hostel_code} hostel. You cannot join a group across different facilities.`);
    }

    // Check duplicate membership
    const existingMembership = db.prepare(`
      SELECT bgm.group_id, bg.status 
      FROM booking_group_members bgm
      JOIN booking_groups bg ON bgm.group_id = bg.id
      WHERE bgm.student_id = ? AND bg.status IN ('FORMING', 'READY_FOR_ALLOCATION', 'ALLOCATED')
    `).get(studentId) as any;

    if (existingMembership) {
      throw new Error('You already belong to an active booking group.');
    }

    // Check current count
    const members = db.prepare('SELECT * FROM booking_group_members WHERE group_id = ?').all(group.id) as any[];
    if (members.length >= group.target_capacity) {
      throw new Error('This booking group has already reached its maximum capacity.');
    }

    const now = new Date().toISOString();
    const newCount = members.length + 1;
    const isNowComplete = newCount === group.target_capacity;

    db.transaction(() => {
      const memberId = `bgm-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, auto_complete_triple_consent, joined_at)
        VALUES (?, ?, ?, 'MEMBER', 0, ?, ?)
      `).run(memberId, group.id, studentId, autoCompleteTripleConsent ? 1 : 0, now);

      // Create individual payment record for joining member
      const roomPrice = db.prepare('SELECT price_per_student FROM rooms WHERE hostel_id = ? AND capacity = ? LIMIT 1')
        .get(group.hostel_id, group.target_capacity) as any;
      const amount = roomPrice ? roomPrice.price_per_student : (group.target_capacity === 2 ? 800 : 600);

      const paymentId = `pay-${crypto.randomUUID()}`;
      const refCode = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      db.prepare(`
        INSERT INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'USD', 'PENDING', ?, ?, ?)
      `).run(paymentId, studentId, group.id, amount, refCode, now, now);

      if (isNowComplete) {
        // Group is complete! Set eligible_at to NOW for queue priority
        db.prepare(`
          UPDATE booking_groups 
          SET status = 'READY_FOR_ALLOCATION', eligible_at = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, group.id);

      }
    })();

    if (isNowComplete) this.assignProvisionalHolds(group.hostel_id, group.target_capacity);

    return this.getGroupById(group.id)!;
  }

  /** Assign FIFO provisional holds only after a group is complete and eligible. */
  static assignProvisionalHolds(hostelId?: string, capacity?: RoomCapacity) {
    const db = getDb();
    let sql = `SELECT * FROM booking_groups WHERE status = 'READY_FOR_ALLOCATION' AND held_room_id IS NULL`;
    const args: any[] = [];
    if (hostelId) { sql += ' AND hostel_id = ?'; args.push(hostelId); }
    if (capacity) { sql += ' AND target_capacity = ?'; args.push(capacity); }
    sql += ' ORDER BY eligible_at ASC, created_at ASC';
    const groups = db.prepare(sql).all(...args) as any[];
    const assigned: string[] = [];
    db.transaction(() => {
      for (const group of groups) {
        const room = db.prepare(`SELECT r.id FROM rooms r WHERE r.hostel_id = ? AND r.capacity = ? AND r.status = 'AVAILABLE'
          AND NOT EXISTS (SELECT 1 FROM booking_groups bg WHERE bg.held_room_id = r.id AND bg.status IN ('READY_FOR_ALLOCATION', 'FORMING'))
          AND (SELECT COUNT(*) FROM room_allocations ra WHERE ra.room_id = r.id AND ra.status IN ('HOLD', 'FINALIZED')) = 0
          ORDER BY r.room_number ASC LIMIT 1`).get(group.hostel_id, group.target_capacity) as any;
        if (room) {
          db.prepare('UPDATE booking_groups SET held_room_id = ?, updated_at = ? WHERE id = ? AND held_room_id IS NULL').run(room.id, new Date().toISOString(), group.id);
          assigned.push(group.id);
        }
      }
    })();
    return assigned;
  }

  /**
   * Retrieves a single group by ID with full details
   */
  static getGroupById(groupId: string): BookingGroup | null {
    const db = getDb();
    const group = db.prepare(`
      SELECT bg.*, h.code as hostel_code, h.name as hostel_name
      FROM booking_groups bg
      JOIN hostels h ON bg.hostel_id = h.id
      WHERE bg.id = ?
    `).get(groupId) as any;

    if (!group) return null;

    const members = db.prepare(`
      SELECT bgm.*, 
             s.full_name, s.phone_number, s.gender, s.department, s.academic_level, s.photo_url,
             p.id as payment_id, p.status as payment_status, p.amount as payment_amount, p.reference_code as payment_ref
      FROM booking_group_members bgm
      JOIN students s ON bgm.student_id = s.id
      LEFT JOIN payments p ON p.student_id = s.id AND p.booking_group_id = bgm.group_id
      WHERE bgm.group_id = ?
      ORDER BY bgm.joined_at ASC
    `).all(groupId) as any[];

    const member_count = members.length;
    const all_payments_verified = member_count === group.target_capacity &&
      members.every(m => m.payment_status === 'VERIFIED');
    const heldRoom = group.held_room_id ? db.prepare('SELECT room_number, capacity, price_per_student FROM rooms WHERE id = ?').get(group.held_room_id) as any : null;

    return {
      ...group,
      members: members.map(m => ({
        id: m.id,
        group_id: m.group_id,
        student_id: m.student_id,
        role: m.role,
        is_matched_from_queue: m.is_matched_from_queue,
        auto_complete_triple_consent: m.auto_complete_triple_consent,
        joined_at: m.joined_at,
        student: {
          id: m.student_id,
          full_name: m.full_name,
          phone_number: m.phone_number,
          gender: m.gender,
          department: m.department,
          academic_level: m.academic_level,
          preferred_occupancy: group.target_capacity,
          roommate_mode: 'KNOWN',
          consent_random_matching: 0,
          photo_url: m.photo_url,
          created_at: m.joined_at,
          updated_at: m.joined_at
        },
        payment: m.payment_id ? {
          id: m.payment_id,
          student_id: m.student_id,
          booking_group_id: m.group_id,
          amount: m.payment_amount,
          currency: 'USD',
          status: m.payment_status,
          reference_code: m.payment_ref,
          created_at: m.joined_at,
          updated_at: m.joined_at
        } : undefined
      })),
      member_count,
      all_payments_verified,
      provisional_room: heldRoom
    };
  }

  /**
   * Retrieves all booking groups with filters
   */
  static getGroups(hostelCode?: HostelCode, status?: BookingGroupStatus): BookingGroup[] {
    const db = getDb();
    let query = `
      SELECT bg.id 
      FROM booking_groups bg
      JOIN hostels h ON bg.hostel_id = h.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (hostelCode) {
      query += ' AND h.code = ? ';
      params.push(hostelCode);
    }
    if (status) {
      query += ' AND bg.status = ? ';
      params.push(status);
    }
    query += ' ORDER BY bg.created_at DESC ';

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(r => this.getGroupById(r.id)!);
  }
}
