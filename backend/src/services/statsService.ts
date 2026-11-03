import { getDb } from '../db/connection.js';
import { DashboardStats } from '@hostel/shared';
import { RenewalService } from './renewalService.js';

export class StatsService {
  static getDashboardStats(): DashboardStats {
    const db = getDb();

    const studentCounts = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN gender = 'MALE' THEN 1 ELSE 0 END) as male,
        SUM(CASE WHEN gender = 'FEMALE' THEN 1 ELSE 0 END) as female
      FROM students
    `).get() as any;

    const roomCounts = db.prepare(`
      SELECT 
        COUNT(*) as total_rooms,
        SUM(capacity) as total_capacity
      FROM rooms
      WHERE status != 'MAINTENANCE'
    `).get() as any;

    // Active allocations
    const activeAllocations = db.prepare(`
      SELECT ra.room_id, r.capacity, h.code as hostel_code
      FROM room_allocations ra
      JOIN rooms r ON ra.room_id = r.id
      JOIN hostels h ON r.hostel_id = h.id
      WHERE ra.status IN ('HOLD', 'FINALIZED')
    `).all() as any[];

    const current_occupancy = activeAllocations.length;
    const maleOccupancy = activeAllocations.filter(a => a.hostel_code === 'MALE').length;
    const femaleOccupancy = activeAllocations.filter(a => a.hostel_code === 'FEMALE').length;

    // Capacity by hostel
    const maleCapacityRow = db.prepare(`
      SELECT SUM(r.capacity) as cap FROM rooms r JOIN hostels h ON r.hostel_id = h.id WHERE h.code = 'MALE' AND r.status != 'MAINTENANCE'
    `).get() as any;
    const femaleCapacityRow = db.prepare(`
      SELECT SUM(r.capacity) as cap FROM rooms r JOIN hostels h ON r.hostel_id = h.id WHERE h.code = 'FEMALE' AND r.status != 'MAINTENANCE'
    `).get() as any;

    const total_capacity = roomCounts?.total_capacity || 0;
    const maleCapacity = maleCapacityRow?.cap || 0;
    const femaleCapacity = femaleCapacityRow?.cap || 0;

    const occupancy_rate = total_capacity > 0 ? Math.round((current_occupancy / total_capacity) * 100) : 0;
    const male_occupancy_rate = maleCapacity > 0 ? Math.round((maleOccupancy / maleCapacity) * 100) : 0;
    const female_occupancy_rate = femaleCapacity > 0 ? Math.round((femaleOccupancy / femaleCapacity) * 100) : 0;

    // Room occupancies
    const occupiedRoomsRow = db.prepare(`
      SELECT COUNT(DISTINCT room_id) as occupied_count FROM room_allocations WHERE status = 'FINALIZED'
    `).get() as any;
    const occupied_rooms = occupiedRoomsRow?.occupied_count || 0;
    const available_rooms = Math.max(0, (roomCounts?.total_rooms || 0) - occupied_rooms);

    // Payments
    const payCounts = db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) as verified
      FROM payments
    `).get() as any;

    // Active QRs
    const qrRow = db.prepare('SELECT COUNT(*) as count FROM qr_credentials WHERE status = \'ACTIVE\'').get() as any;

    // Matching queue
    const queueRow = db.prepare('SELECT COUNT(*) as count FROM matching_queue WHERE status = \'WAITING\'').get() as any;

    // Approaching renewals (<= 30 days)
    const renewals = RenewalService.getUpcomingRenewals();
    const approaching_renewals_count = renewals.filter(r => r.days_remaining <= 30 && r.days_remaining >= 0).length;

    return {
      total_students: studentCounts?.total || 0,
      total_male_students: studentCounts?.male || 0,
      total_female_students: studentCounts?.female || 0,
      total_rooms: roomCounts?.total_rooms || 0,
      occupied_rooms,
      available_rooms,
      total_capacity,
      current_occupancy,
      occupancy_rate,
      male_occupancy_rate,
      female_occupancy_rate,
      pending_payments_count: payCounts?.pending || 0,
      verified_payments_count: payCounts?.verified || 0,
      active_qr_count: qrRow?.count || 0,
      matching_queue_count: queueRow?.count || 0,
      approaching_renewals_count
    };
  }

  /**
   * Generates CSV for various report tables
   */
  static generateCSV(type: 'students' | 'rooms' | 'payments' | 'allocations' | 'access_logs'): string {
    const db = getDb();

    switch (type) {
      case 'students': {
        const rows = db.prepare(`
          SELECT s.id, s.full_name, s.phone_number, s.gender, s.department, s.academic_level,
                 s.preferred_occupancy, s.roommate_mode, s.consent_random_matching, s.created_at
          FROM students s ORDER BY s.created_at DESC
        `).all() as any[];
        const headers = ['ID', 'Full Name', 'Phone Number', 'Gender', 'Department', 'Academic Level', 'Occupancy Pref', 'Roommate Mode', 'Random Consent', 'Registered At'];
        const lines = [headers.join(',')];
        for (const r of rows) {
          lines.push([
            r.id, `"${r.full_name}"`, r.phone_number, r.gender, `"${r.department}"`, `"${r.academic_level}"`,
            r.preferred_occupancy, r.roommate_mode, r.consent_random_matching ? 'Yes' : 'No', r.created_at
          ].join(','));
        }
        return lines.join('\n');
      }

      case 'rooms': {
        const rows = db.prepare(`
          SELECT r.id, h.name as hostel_name, h.code as hostel_code, r.room_number, r.capacity, r.price_per_student, r.status
          FROM rooms r JOIN hostels h ON r.hostel_id = h.id ORDER BY h.code, r.room_number
        `).all() as any[];
        const headers = ['ID', 'Hostel Facility', 'Facility Code', 'Room Number', 'Capacity', 'Price Per Student ($)', 'Status'];
        const lines = [headers.join(',')];
        for (const r of rows) {
          lines.push([r.id, `"${r.hostel_name}"`, r.hostel_code, r.room_number, r.capacity, r.price_per_student, r.status].join(','));
        }
        return lines.join('\n');
      }

      case 'payments': {
        const rows = db.prepare(`
          SELECT p.id, s.full_name, s.phone_number, bg.group_code, p.amount, p.currency, p.status, p.reference_code, p.verified_at, p.created_at
          FROM payments p
          JOIN students s ON p.student_id = s.id
          JOIN booking_groups bg ON p.booking_group_id = bg.id
          ORDER BY p.created_at DESC
        `).all() as any[];
        const headers = ['Payment ID', 'Student Name', 'Phone', 'Booking Group Code', 'Amount', 'Currency', 'Status', 'Reference Code', 'Verified At', 'Created At'];
        const lines = [headers.join(',')];
        for (const r of rows) {
          lines.push([r.id, `"${r.full_name}"`, r.phone_number, r.group_code, r.amount, r.currency, r.status, r.reference_code, r.verified_at || '', r.created_at].join(','));
        }
        return lines.join('\n');
      }

      case 'allocations': {
        const rows = db.prepare(`
          SELECT ra.id, s.full_name, s.phone_number, h.name as hostel_name, r.room_number, ra.status, ra.accommodation_start_date, ra.accommodation_end_date
          FROM room_allocations ra
          JOIN students s ON ra.student_id = s.id
          JOIN rooms r ON ra.room_id = r.id
          JOIN hostels h ON r.hostel_id = h.id
          ORDER BY ra.created_at DESC
        `).all() as any[];
        const headers = ['Allocation ID', 'Student Name', 'Phone', 'Hostel', 'Room Number', 'Status', 'Start Date', 'Expiry Date'];
        const lines = [headers.join(',')];
        for (const r of rows) {
          lines.push([r.id, `"${r.full_name}"`, r.phone_number, `"${r.hostel_name}"`, r.room_number, r.status, r.accommodation_start_date, r.accommodation_end_date].join(','));
        }
        return lines.join('\n');
      }

      case 'access_logs': {
        const rows = db.prepare(`
          SELECT al.id, s.full_name, al.verification_method, al.outcome, al.reason, al.logged_at
          FROM access_logs al
          LEFT JOIN students s ON al.student_id = s.id
          ORDER BY al.logged_at DESC
        `).all() as any[];
        const headers = ['Log ID', 'Student Name', 'Verification Method', 'Outcome', 'Reason', 'Timestamp'];
        const lines = [headers.join(',')];
        for (const r of rows) {
          lines.push([r.id, `"${r.full_name || 'Unknown'}"`, r.verification_method, r.outcome, `"${r.reason || ''}"`, r.logged_at].join(','));
        }
        return lines.join('\n');
      }

      default:
        return '';
    }
  }
}
