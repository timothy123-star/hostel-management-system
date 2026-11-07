import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { RoomAllocation, HostelCode, Room } from '@hostel/shared';
import { AuditService } from './auditService.js';
import { BookingGroupService } from './bookingGroupService.js';

export class AllocationService {
  /**
   * Calculates expiry date exactly 12 months after accommodation start date.
   */
  static calculateExpiryDate(startDateStr: string): string {
    const [year, month, day] = startDateStr.split('-').map(Number);
    // 12 months later on same day (or leap year adjustment)
    const nextYear = year + 1;
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return `${nextYear}-${mStr}-${dStr}`;
  }

  /**
   * Finds the best compatible room for a group:
   * 1. Same hostel facility
   * 2. Room capacity matches target group capacity
   * 3. Has sufficient available spots
   */
  static findCompatibleRoom(hostelId: string, capacity: number): Room | null {
    const db = getDb();
    const candidate = db.prepare(`
      SELECT r.*,
             (SELECT COUNT(*) FROM room_allocations ra WHERE ra.room_id = r.id AND ra.status IN ('HOLD', 'FINALIZED')) as current_occupants
      FROM rooms r
      WHERE r.hostel_id = ? AND r.capacity = ? AND r.status != 'MAINTENANCE'
        AND r.id NOT IN (SELECT held_room_id FROM booking_groups WHERE held_room_id IS NOT NULL AND status IN ('FORMING', 'READY_FOR_ALLOCATION'))
        AND (r.capacity - (SELECT COUNT(*) FROM room_allocations ra WHERE ra.room_id = r.id AND ra.status IN ('HOLD', 'FINALIZED'))) >= ?
      ORDER BY r.room_number ASC
      LIMIT 1
    `).get(hostelId, capacity, capacity) as any;

    return candidate || null;
  }

  /**
   * Finalizes allocation for a complete booking group:
   * - Checks that all group members have verified payments!
   * - Selects automatically or uses manager override room.
   * - Validates room facility and capacity.
   * - Records 12-month accommodation period starting on chosen start date.
   * - Does not issue credentials; issuance is an explicit manager action after
   *   the resident photograph has been approved.
   * - Updates room status and group status to 'ALLOCATED'.
   * - Logs audit trail if override occurred.
   */
  static async finalizeGroupAllocation(params: {
    groupId: string;
    adminId?: string;
    overrideRoomId?: string;
    overrideReason?: string;
    accommodationStartDate: string; // YYYY-MM-DD
  }): Promise<{ allocations: RoomAllocation[] }> {
    const db = getDb();
    const group = BookingGroupService.getGroupById(params.groupId);

    if (!group) {
      throw new Error(`Booking group ${params.groupId} not found`);
    }

    if (!group.members || group.members.length !== group.target_capacity) {
      throw new Error(`Group is incomplete (${group.member_count || 0}/${group.target_capacity} members). All spots must be filled before allocation.`);
    }

    // CRITICAL: Check every required group member's payment is verified!
    const unverifiedMembers = group.members.filter(m => !m.payment || m.payment.status !== 'VERIFIED');
    if (unverifiedMembers.length > 0) {
      const names = unverifiedMembers.map(m => m.student.full_name).join(', ');
      throw new Error(`Cannot finalize allocation. Payments for the following group members are not yet verified: ${names}`);
    }

    // Determine target room
    let targetRoomId = params.overrideRoomId || group.held_room_id;
    let isOverride = !!params.overrideRoomId;

    if (!targetRoomId) {
      const autoRoom = this.findCompatibleRoom(group.hostel_id, group.target_capacity);
      if (!autoRoom) {
        throw new Error(`No available compatible room found in ${group.hostel_code} hostel for capacity ${group.target_capacity}.`);
      }
      targetRoomId = autoRoom.id;
    }

    // Validate the target room
    const targetRoom = db.prepare(`
      SELECT r.*, h.code as hostel_code 
      FROM rooms r 
      JOIN hostels h ON r.hostel_id = h.id 
      WHERE r.id = ?
    `).get(targetRoomId) as any;

    if (!targetRoom) {
      throw new Error('Target room not found');
    }
    if (targetRoom.status === 'MAINTENANCE') {
      throw new Error(`Room ${targetRoom.room_number} is under maintenance and cannot be allocated.`);
    }
    const heldByAnotherGroup = db.prepare(`SELECT id FROM booking_groups WHERE held_room_id = ? AND id != ? AND status IN ('FORMING', 'READY_FOR_ALLOCATION')`).get(targetRoomId, group.id);
    if (heldByAnotherGroup) {
      throw new Error(`Room ${targetRoom.room_number} is already held for another booking group.`);
    }

    // CRITICAL: Facility Separation Rule
    if (targetRoom.hostel_id !== group.hostel_id) {
      throw new Error(`Security Violation: Cannot allocate across facilities. Group is registered in ${group.hostel_code} hostel, but selected room is in ${targetRoom.hostel_code} hostel.`);
    }

    // CRITICAL: Room Capacity Rule
    const currentOccupants = db.prepare(`
      SELECT COUNT(*) as count FROM room_allocations 
      WHERE room_id = ? AND status IN ('HOLD', 'FINALIZED') AND booking_group_id != ?
    `).get(targetRoomId, group.id) as any;

    const availableSpots = targetRoom.capacity - (currentOccupants ? currentOccupants.count : 0);
    if (availableSpots < group.target_capacity) {
      throw new Error(`Cannot allocate: Room ${targetRoom.room_number} only has ${availableSpots} available spot(s), but group requires ${group.target_capacity}.`);
    }

    const expiryDate = this.calculateExpiryDate(params.accommodationStartDate);
    const now = new Date().toISOString();
    const createdAllocations: RoomAllocation[] = [];

    // Finalize within synchronous SQLite transaction
    db.transaction(() => {
      // Cancel any previous hold allocations for this group
      db.prepare(`UPDATE room_allocations SET status = 'CANCELLED', updated_at = ? WHERE booking_group_id = ? AND status = 'HOLD'`).run(now, group.id);

      for (const member of group.members!) {
        const allocId = `alloc-${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO room_allocations (
            id, room_id, student_id, booking_group_id, status, allocated_by_admin_id,
            accommodation_start_date, accommodation_end_date, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'FINALIZED', ?, ?, ?, ?, ?)
        `).run(
          allocId,
          targetRoomId,
          member.student_id,
          group.id,
          params.adminId || null,
          params.accommodationStartDate,
          expiryDate,
          now,
          now
        );

        createdAllocations.push({
          id: allocId,
          room_id: targetRoomId,
          student_id: member.student_id,
          booking_group_id: group.id,
          status: 'FINALIZED',
          allocated_by_admin_id: params.adminId || '',
          accommodation_start_date: params.accommodationStartDate,
          accommodation_end_date: expiryDate,
          created_at: now,
          updated_at: now
        });
      }

      // Update group status
      db.prepare(`
        UPDATE booking_groups 
        SET status = 'ALLOCATED', held_room_id = ?, updated_at = ?
        WHERE id = ?
      `).run(targetRoomId, now, group.id);

      // Check if room is fully occupied now
      const totalOccupants = db.prepare(`
        SELECT COUNT(*) as count FROM room_allocations WHERE room_id = ? AND status = 'FINALIZED'
      `).get(targetRoomId) as any;

      if (totalOccupants && totalOccupants.count >= targetRoom.capacity) {
        db.prepare('UPDATE rooms SET status = \'OCCUPIED\', updated_at = ? WHERE id = ?').run(now, targetRoomId);
      }
    })();

    // Audit log
    AuditService.log({
      adminId: params.adminId,
      action: isOverride ? 'ALLOCATE_GROUP_OVERRIDE' : 'ALLOCATE_GROUP_AUTO',
      entityType: 'BOOKING_GROUP',
      entityId: group.id,
      oldValues: { held_room_id: group.held_room_id },
      newValues: {
        room_id: targetRoomId,
        room_number: targetRoom.room_number,
        start_date: params.accommodationStartDate,
        end_date: expiryDate,
        override_reason: params.overrideReason
      },
      notes: isOverride
        ? `Manager manually overrode room to ${targetRoom.room_number}: ${params.overrideReason || 'Administrative decision'}`
        : `Allocated group ${group.group_code} to compatible room ${targetRoom.room_number}`
    });

    return { allocations: createdAllocations };
  }

  /**
   * Manager manually moves/reallocates an individual student to another compatible room.
   * Strictly logs in audit logs!
   */
  static reallocateStudent(params: {
    studentId: string;
    newRoomId: string;
    reason: string;
    adminId?: string;
  }): RoomAllocation {
    const db = getDb();

    // Fetch student active allocation
    const currentAlloc = db.prepare(`
      SELECT ra.*, r.room_number as current_room_number, r.hostel_id as current_hostel_id,
             s.full_name, s.gender
      FROM room_allocations ra
      JOIN rooms r ON ra.room_id = r.id
      JOIN students s ON ra.student_id = s.id
      WHERE ra.student_id = ? AND ra.status = 'FINALIZED'
    `).get(params.studentId) as any;

    if (!currentAlloc) {
      throw new Error('Student does not have an active finalized room allocation to move.');
    }
    const activeGroupMembers = db.prepare(`SELECT COUNT(*) as count FROM booking_group_members WHERE group_id = ?`).get(currentAlloc.booking_group_id) as any;
    if (activeGroupMembers.count > 1) {
      throw new Error('Students in a shared group must be relocated together. Use group reallocation to preserve membership and occupancy integrity.');
    }

    // Fetch target room
    const newRoom = db.prepare(`
      SELECT r.*, h.code as hostel_code
      FROM rooms r
      JOIN hostels h ON r.hostel_id = h.id
      WHERE r.id = ?
    `).get(params.newRoomId) as any;

    if (!newRoom) {
      throw new Error('Target room not found');
    }
    if (newRoom.status === 'MAINTENANCE') {
      throw new Error(`Target room ${newRoom.room_number} is under maintenance.`);
    }

    // A move must preserve the accommodation type the student paid for.
    const group = db.prepare('SELECT target_capacity FROM booking_groups WHERE id = ?').get(currentAlloc.booking_group_id) as any;
    if (!group || newRoom.capacity !== group.target_capacity) {
      throw new Error('Target room capacity must match the student\'s booking group occupancy.');
    }

    // Facility check
    if (newRoom.hostel_id !== currentAlloc.current_hostel_id) {
      throw new Error(`Facility Separation Error: Cannot move student across ${currentAlloc.gender} hostel facility.`);
    }

    // Capacity check
    const currentOccupants = db.prepare(`
      SELECT COUNT(*) as count FROM room_allocations WHERE room_id = ? AND status = 'FINALIZED'
    `).get(params.newRoomId) as any;

    if (currentOccupants && currentOccupants.count >= newRoom.capacity) {
      throw new Error(`Target room ${newRoom.room_number} is already at full capacity (${newRoom.capacity}/${newRoom.capacity}).`);
    }

    const now = new Date().toISOString();

    db.transaction(() => {
      // Mark old allocation MOVED
      db.prepare(`
        UPDATE room_allocations 
        SET status = 'MOVED', updated_at = ?
        WHERE id = ?
      `).run(now, currentAlloc.id);

      // Create new allocation preserving the original accommodation start and expiry dates!
      const newAllocId = `alloc-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO room_allocations (
          id, room_id, student_id, booking_group_id, status, allocated_by_admin_id,
          accommodation_start_date, accommodation_end_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'FINALIZED', ?, ?, ?, ?, ?)
      `).run(
        newAllocId,
        params.newRoomId,
        params.studentId,
        currentAlloc.booking_group_id,
        params.adminId || null,
        currentAlloc.accommodation_start_date,
        currentAlloc.accommodation_end_date,
        now,
        now
      );

      const oldOccupants = db.prepare("SELECT COUNT(*) as count FROM room_allocations WHERE room_id = ? AND status = 'FINALIZED'").get(currentAlloc.room_id) as any;
      if (oldOccupants.count === 0) {
        db.prepare("UPDATE rooms SET status = 'AVAILABLE', updated_at = ? WHERE id = ? AND status != 'MAINTENANCE'").run(now, currentAlloc.room_id);
      }
      const newOccupants = db.prepare("SELECT COUNT(*) as count FROM room_allocations WHERE room_id = ? AND status = 'FINALIZED'").get(params.newRoomId) as any;
      db.prepare("UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?")
        .run(newOccupants.count >= newRoom.capacity ? 'OCCUPIED' : 'AVAILABLE', now, params.newRoomId);
    })();

    // Audit log
    AuditService.log({
      adminId: params.adminId,
      action: 'REALLOCATE_STUDENT_OVERRIDE',
      entityType: 'STUDENT',
      entityId: params.studentId,
      oldValues: {
        room_id: currentAlloc.room_id,
        room_number: currentAlloc.current_room_number
      },
      newValues: {
        room_id: params.newRoomId,
        room_number: newRoom.room_number,
        reason: params.reason
      },
      notes: `Manager moved student ${currentAlloc.full_name} from ${currentAlloc.current_room_number} to ${newRoom.room_number}. Reason: ${params.reason}`
    });

    return db.prepare('SELECT * FROM room_allocations WHERE student_id = ? AND status = \'FINALIZED\'').get(params.studentId) as RoomAllocation;
  }

  static reallocateGroup(params: { groupId: string; newRoomId: string; reason: string; adminId?: string }): RoomAllocation[] {
    const db = getDb();
    const group = BookingGroupService.getGroupById(params.groupId);
    if (!group || group.status !== 'ALLOCATED' || !group.members?.length) throw new Error('Only finalized groups can be relocated.');
    const newRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(params.newRoomId) as any;
    if (!newRoom || newRoom.status === 'MAINTENANCE') throw new Error('Target room is unavailable or under maintenance.');
    const heldByOther = db.prepare("SELECT id FROM booking_groups WHERE held_room_id = ? AND id != ? AND status IN ('FORMING', 'READY_FOR_ALLOCATION')").get(params.newRoomId, params.groupId);
    if (heldByOther) throw new Error('Target room is temporarily held for another eligible group.');
    if (newRoom.hostel_id !== group.hostel_id || newRoom.capacity !== group.target_capacity) throw new Error('Target room must be in the same facility and match the group occupancy.');
    const occupants = db.prepare("SELECT COUNT(*) as count FROM room_allocations WHERE room_id = ? AND status = 'FINALIZED'").get(params.newRoomId) as any;
    if (occupants.count + group.members.length > newRoom.capacity) throw new Error('Target room does not have enough physical capacity for the full group.');
    const allocations = db.prepare("SELECT * FROM room_allocations WHERE booking_group_id = ? AND status = 'FINALIZED'").all(params.groupId) as any[];
    const now = new Date().toISOString();
    const created: RoomAllocation[] = [];
    db.transaction(() => {
      for (const old of allocations) {
        db.prepare("UPDATE room_allocations SET status = 'MOVED', updated_at = ? WHERE id = ?").run(now, old.id);
        const id = `alloc-${crypto.randomUUID()}`;
        db.prepare(`INSERT INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'FINALIZED', ?, ?, ?, ?, ?)`)
          .run(id, params.newRoomId, old.student_id, params.groupId, params.adminId || null, old.accommodation_start_date, old.accommodation_end_date, now, now);
        created.push({ ...old, id, room_id: params.newRoomId, status: 'FINALIZED', updated_at: now });
      }
      for (const oldRoomId of [...new Set(allocations.map(a => a.room_id))]) {
        const remaining = db.prepare("SELECT COUNT(*) as count FROM room_allocations WHERE room_id = ? AND status = 'FINALIZED'").get(oldRoomId) as any;
        if (remaining.count === 0) db.prepare("UPDATE rooms SET status = 'AVAILABLE', updated_at = ? WHERE id = ? AND status != 'MAINTENANCE'").run(now, oldRoomId);
      }
      db.prepare("UPDATE rooms SET status = 'OCCUPIED', updated_at = ? WHERE id = ?").run(now, params.newRoomId);
      db.prepare("UPDATE booking_groups SET held_room_id = ?, updated_at = ? WHERE id = ?").run(params.newRoomId, now, params.groupId);
    })();
    AuditService.log({ adminId: params.adminId, action: 'REALLOCATE_GROUP_OVERRIDE', entityType: 'BOOKING_GROUP', entityId: params.groupId, newValues: { new_room_id: params.newRoomId, reason: params.reason }, notes: `Manager relocated group ${group.group_code}: ${params.reason}` });
    return created;
  }
}
