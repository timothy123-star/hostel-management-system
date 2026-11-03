import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { HostelCode, RoomCapacity } from '@hostel/shared';

export class MatchingService {
  /**
   * Adds an opted-in student to the random matching queue.
   */
  static addToQueue(studentId: string, hostelCode: HostelCode, targetCapacity: RoomCapacity): string {
    const db = getDb();

    // Verify student consented
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as any;
    if (!student) {
      throw new Error('Student not found');
    }
    if (student.consent_random_matching !== 1) {
      throw new Error('Student has not consented to random matching');
    }

    // Verify facility matches student gender
    if (student.gender !== hostelCode) {
      throw new Error('Hostel facility does not match student gender');
    }

    // Check if already in queue with status WAITING
    const existing = db.prepare(`
      SELECT id FROM matching_queue 
      WHERE student_id = ? AND status = 'WAITING'
    `).get(studentId) as any;

    if (existing) {
      return existing.id;
    }

    const hostel = db.prepare('SELECT id FROM hostels WHERE code = ?').get(hostelCode) as any;
    if (!hostel) {
      throw new Error(`Hostel facility for ${hostelCode} not found`);
    }

    const queueId = `mq-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO matching_queue (id, student_id, hostel_id, target_capacity, status, queued_at)
      VALUES (?, ?, ?, ?, 'WAITING', datetime('now'))
    `).run(queueId, studentId, hostel.id, targetCapacity);

    // Attempt matching immediately
    this.attemptMatching(hostel.id, targetCapacity);

    return queueId;
  }

  /**
   * Evaluates the random matching queue and partial groups to form complete groups.
   */
  static attemptMatching(hostelId: string, capacity: RoomCapacity) {
    const db = getDb();

    // 1. Check if there are known pairs requesting a triple room who consented to receiving a 3rd member
    if (capacity === 3) {
      const incompleteGroups = db.prepare(`
        SELECT bg.id, bg.created_by_student_id, COUNT(bgm.id) as current_count
        FROM booking_groups bg
        JOIN booking_group_members bgm ON bg.id = bgm.group_id
        WHERE bg.hostel_id = ? AND bg.target_capacity = 3 AND bg.status = 'FORMING'
        GROUP BY bg.id
        HAVING current_count = 2
        ORDER BY bg.created_at ASC
      `).all(hostelId) as any[];

      for (const group of incompleteGroups) {
        // Find next waiting student in queue who consented
        const nextInQueue = db.prepare(`
          SELECT mq.id, mq.student_id 
          FROM matching_queue mq
          JOIN students s ON mq.student_id = s.id
          WHERE mq.hostel_id = ? AND mq.target_capacity = 3 AND mq.status = 'WAITING' AND s.consent_random_matching = 1
          ORDER BY mq.queued_at ASC
          LIMIT 1
        `).get(hostelId) as any;

        if (nextInQueue) {
          // Add student to the group
          const memberId = `bgm-${crypto.randomUUID()}`;
          const now = new Date().toISOString();

          db.transaction(() => {
            db.prepare(`
              INSERT INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
              VALUES (?, ?, ?, 'MEMBER', 1, ?)
            `).run(memberId, group.id, nextInQueue.student_id, now);

            db.prepare(`
              UPDATE matching_queue 
              SET status = 'MATCHED', matched_at = ?, matched_group_id = ?
              WHERE id = ?
            `).run(now, group.id, nextInQueue.id);

            // Group is now complete (2 + 1 = 3)!
            // Queue priority timestamp is set to NOW (when group became complete)
            db.prepare(`
              UPDATE booking_groups 
              SET status = 'READY_FOR_ALLOCATION', eligible_at = ?, updated_at = ?
              WHERE id = ?
            `).run(now, now, group.id);

            // Ensure payment record exists for the new member
            const paymentId = `pay-${crypto.randomUUID()}`;
            const refCode = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            // Determine price
            const roomPrice = db.prepare('SELECT price_per_student FROM rooms WHERE hostel_id = ? AND capacity = 3 LIMIT 1').get(hostelId) as any;
            const amount = roomPrice ? roomPrice.price_per_student : 600;

            db.prepare(`
              INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'USD', 'PENDING', ?, ?, ?)
            `).run(paymentId, nextInQueue.student_id, group.id, amount, refCode, now, now);
          })();
        }
      }
    }

    // 2. Match waiting students amongst themselves in the queue
    // For Double rooms: need 2 students
    // For Triple rooms: need 3 students
    const waiting = db.prepare(`
      SELECT mq.id, mq.student_id
      FROM matching_queue mq
      JOIN students s ON mq.student_id = s.id
      WHERE mq.hostel_id = ? AND mq.target_capacity = ? AND mq.status = 'WAITING' AND s.consent_random_matching = 1
      ORDER BY mq.queued_at ASC
    `).all(hostelId, capacity) as any[];

    while (waiting.length >= capacity) {
      const matchedBatch = waiting.splice(0, capacity);
      const groupId = `grp-${crypto.randomUUID()}`;
      const groupCode = `MATCH-${capacity}P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const now = new Date().toISOString();
      const leaderStudentId = matchedBatch[0].student_id;

      db.transaction(() => {
        // Create complete group
        db.prepare(`
          INSERT INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'READY_FOR_ALLOCATION', ?, ?, ?, ?)
        `).run(groupId, groupCode, hostelId, capacity, leaderStudentId, now, now, now);

        // Fetch price
        const roomPrice = db.prepare('SELECT price_per_student FROM rooms WHERE hostel_id = ? AND capacity = ? LIMIT 1').get(hostelId, capacity) as any;
        const amount = roomPrice ? roomPrice.price_per_student : (capacity === 2 ? 800 : 600);

        for (let i = 0; i < matchedBatch.length; i++) {
          const item = matchedBatch[i];
          const memberId = `bgm-${crypto.randomUUID()}`;
          const role = i === 0 ? 'LEADER' : 'MEMBER';

          db.prepare(`
            INSERT INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
            VALUES (?, ?, ?, ?, 1, ?)
          `).run(memberId, groupId, item.student_id, role, now);

          db.prepare(`
            UPDATE matching_queue 
            SET status = 'MATCHED', matched_at = ?, matched_group_id = ?
            WHERE id = ?
          `).run(now, groupId, item.id);

          const paymentId = `pay-${crypto.randomUUID()}`;
          const refCode = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          db.prepare(`
            INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'USD', 'PENDING', ?, ?, ?)
          `).run(paymentId, item.student_id, groupId, amount, refCode, now, now);
        }
      })();
    }
  }

  /**
   * Retrieves active matching queue items
   */
  static getQueueItems(hostelCode?: HostelCode) {
    const db = getDb();
    let query = `
      SELECT mq.*, 
             s.full_name, s.phone_number, s.department, s.academic_level, s.gender,
             h.name as hostel_name, h.code as hostel_code
      FROM matching_queue mq
      JOIN students s ON mq.student_id = s.id
      JOIN hostels h ON mq.hostel_id = h.id
      WHERE mq.status = 'WAITING'
    `;
    const params: any[] = [];
    if (hostelCode) {
      query += ' AND h.code = ? ';
      params.push(hostelCode);
    }
    query += ' ORDER BY mq.queued_at ASC ';

    return db.prepare(query).all(...params);
  }
}
