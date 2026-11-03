import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { Room, Hostel, HostelCode, RoomCapacity } from '@hostel/shared';
import { AuditService } from './auditService.js';

export class HostelService {
  static getHostels(): Hostel[] {
    const db = getDb();
    return db.prepare('SELECT * FROM hostels ORDER BY code ASC').all() as Hostel[];
  }

  static getRooms(hostelCode?: HostelCode): Room[] {
    const db = getDb();
    let query = `
      SELECT r.*, h.code as hostel_code, h.name as hostel_name,
             (SELECT bg.id FROM booking_groups bg WHERE bg.held_room_id = r.id AND bg.status IN ('FORMING', 'READY_FOR_ALLOCATION') LIMIT 1) as held_by_group_id
      FROM rooms r
      JOIN hostels h ON r.hostel_id = h.id
    `;
    const params: any[] = [];
    if (hostelCode) {
      query += ' WHERE h.code = ? ';
      params.push(hostelCode);
    }
    query += ' ORDER BY h.code ASC, r.room_number ASC';

    const rawRooms = db.prepare(query).all(...params) as any[];

    // Compute live occupancy from active allocations (HOLD and FINALIZED)
    const activeAllocations = db.prepare(`
      SELECT ra.room_id, ra.id as allocation_id, ra.status, ra.student_id,
             s.full_name, s.phone_number
      FROM room_allocations ra
      JOIN students s ON ra.student_id = s.id
      WHERE ra.status IN ('HOLD', 'FINALIZED')
    `).all() as any[];

    const allocationsByRoom = new Map<string, any[]>();
    for (const alloc of activeAllocations) {
      if (!allocationsByRoom.has(alloc.room_id)) {
        allocationsByRoom.set(alloc.room_id, []);
      }
      allocationsByRoom.get(alloc.room_id)!.push(alloc);
    }

    return rawRooms.map(r => {
      const occupants = allocationsByRoom.get(r.id) || [];
      const current_occupants = occupants.length;
      const available_spots = Math.max(0, r.capacity - current_occupants);

      return {
        ...r,
        current_occupants,
        available_spots,
        occupant_students: occupants.map(o => ({
          id: o.student_id,
          full_name: o.full_name,
          phone_number: o.phone_number,
          allocation_id: o.allocation_id,
          status: o.status
        }))
      };
    });
  }

  static getRoomById(roomId: string): Room | null {
    const rooms = this.getRooms();
    return rooms.find(r => r.id === roomId) || null;
  }

  static updateRoomPrice(roomId: string, newPrice: number, adminId?: string): Room {
    const db = getDb();
    const oldRoom = this.getRoomById(roomId);
    if (!oldRoom) {
      throw new Error(`Room with ID ${roomId} not found`);
    }

    db.prepare(`
      UPDATE rooms 
      SET price_per_student = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newPrice, roomId);

    AuditService.log({
      adminId,
      action: 'UPDATE_ROOM_PRICE',
      entityType: 'ROOM',
      entityId: roomId,
      oldValues: { price_per_student: oldRoom.price_per_student },
      newValues: { price_per_student: newPrice },
      notes: `Updated room ${oldRoom.room_number} price to $${newPrice} (DEMO)`
    });

    return this.getRoomById(roomId)!;
  }

  static createRoom(params: {
    hostelId: string;
    roomNumber: string;
    capacity: RoomCapacity;
    pricePerStudent: number;
    adminId?: string;
  }): Room {
    const db = getDb();
    const id = `rm-${crypto.randomUUID()}`;

    // Verify hostel exists
    const hostel = db.prepare('SELECT * FROM hostels WHERE id = ?').get(params.hostelId);
    if (!hostel) {
      throw new Error('Hostel facility not found');
    }

    // Check unique room number within hostel
    const existing = db.prepare('SELECT id FROM rooms WHERE hostel_id = ? AND room_number = ?')
      .get(params.hostelId, params.roomNumber);
    if (existing) {
      throw new Error(`Room ${params.roomNumber} already exists in this hostel facility`);
    }

    db.prepare(`
      INSERT INTO rooms (id, hostel_id, room_number, capacity, price_per_student, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'AVAILABLE', datetime('now'), datetime('now'))
    `).run(id, params.hostelId, params.roomNumber, params.capacity, params.pricePerStudent);

    AuditService.log({
      adminId: params.adminId,
      action: 'CREATE_ROOM',
      entityType: 'ROOM',
      entityId: id,
      newValues: params,
      notes: `Created new room ${params.roomNumber} with capacity ${params.capacity} in ${(hostel as any).name}`
    });

    return this.getRoomById(id)!;
  }
}
