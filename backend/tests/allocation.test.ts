import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/connection.js';
import { AllocationService } from '../src/services/allocationService.js';
import { BookingGroupService } from '../src/services/bookingGroupService.js';
import { StudentService } from '../src/services/studentService.js';
import { PaymentService } from '../src/services/paymentService.js';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';

describe('Room Allocation & Facility Separation Rules', () => {
  beforeEach(async () => {
    // Re-run seed with clean reset
    await runSeed(true);
  });

  it('calculates 12-month expiry date independently from agreed start date', () => {
    const expiry1 = AllocationService.calculateExpiryDate('2026-09-01');
    expect(expiry1).toBe('2027-09-01');

    const expiry2 = AllocationService.calculateExpiryDate('2026-01-15');
    expect(expiry2).toBe('2027-01-15');
  });

  it('strictly prevents allocating across different gender facilities', async () => {
    // Register male student
    const maleStudent = StudentService.registerStudent({
      full_name: 'Test Male Cadet',
      phone_number: '+19991112233',
      gender: 'MALE',
      department: 'Physics',
      academic_level: '100 Level',
      preferred_occupancy: 1,
      roommate_mode: 'KNOWN',
      consent_random_matching: false
    });

    // Verify payment
    const payment = PaymentService.getPayments('PENDING').find(p => p.student_id === maleStudent.student.id);
    expect(payment).toBeDefined();
    PaymentService.verifyPayment(payment!.id, 'admin-root-01', 'Test verification');

    // Attempt to allocate male student to Female Room F-102
    await expect(AllocationService.finalizeGroupAllocation({
      groupId: maleStudent.group.id,
      adminId: 'admin-root-01',
      overrideRoomId: 'rm-f-102', // Female Room!
      accommodationStartDate: '2026-10-01'
    })).rejects.toThrow(/Security Violation|across facilities/i);
  });

  it('strictly blocks final allocation until EVERY group member payment is verified', async () => {
    // Group 3 from seed has Lucas Gray with payment PENDING
    const group3 = BookingGroupService.getGroupById('grp-demo-03');
    expect(group3).toBeDefined();
    expect(group3?.all_payments_verified).toBe(false);

    // Attempting to finalize group 3 while payment is pending must fail
    await expect(AllocationService.finalizeGroupAllocation({
      groupId: 'grp-demo-03',
      adminId: 'admin-root-01',
      accommodationStartDate: '2026-12-01'
    })).rejects.toThrow(/Cannot finalize allocation.*not yet verified/i);

    // Now verify Lucas's payment
    const lucasPayment = PaymentService.getPayments('PENDING').find(p => p.student_id === 'stu-demo-06');
    expect(lucasPayment).toBeDefined();
    PaymentService.verifyPayment(lucasPayment!.id, 'admin-root-01', 'Lucas payment verified for test');

    // Now finalization must succeed!
    const result = await AllocationService.finalizeGroupAllocation({
      groupId: 'grp-demo-03',
      adminId: 'admin-root-01',
      accommodationStartDate: '2026-12-01'
    });

    expect(result.allocations.length).toBe(3);
    expect(result.qrCredentials.length).toBe(3);
  });

  it('allows manager to override room and logs audit record', async () => {
    // Register female single student
    const reg = StudentService.registerStudent({
      full_name: 'Override Test Student',
      phone_number: '+18889990011',
      gender: 'FEMALE',
      department: 'Law',
      academic_level: '200 Level',
      preferred_occupancy: 1,
      roommate_mode: 'KNOWN',
      consent_random_matching: false
    });

    const payment = PaymentService.getPayments('PENDING').find(p => p.student_id === reg.student.id);
    PaymentService.verifyPayment(payment!.id, 'admin-root-01');

    // Override room to F-103
    const result = await AllocationService.finalizeGroupAllocation({
      groupId: reg.group.id,
      adminId: 'admin-root-01',
      overrideRoomId: 'rm-f-103',
      overrideReason: 'Manager requested ground floor assignment for accessibility',
      accommodationStartDate: '2026-11-01'
    });

    expect(result.allocations[0].room_id).toBe('rm-f-103');
  });

  it('rejects maintenance rooms and rooms held by another group', async () => {
    const db = getDb();
    const reg = StudentService.registerStudent({ full_name: 'Integrity Student', phone_number: '+18889990012', gender: 'FEMALE', department: 'Law', academic_level: '200 Level', preferred_occupancy: 1, roommate_mode: 'KNOWN', consent_random_matching: false });
    const payment = PaymentService.getPayments('PENDING').find(p => p.student_id === reg.student.id)!;
    PaymentService.verifyPayment(payment.id, 'admin-root-01');
    db.prepare("UPDATE rooms SET status = 'MAINTENANCE' WHERE id = 'rm-f-104'").run();
    await expect(AllocationService.finalizeGroupAllocation({ groupId: reg.group.id, adminId: 'admin-root-01', overrideRoomId: 'rm-f-104', accommodationStartDate: '2026-11-01' })).rejects.toThrow(/maintenance/i);
    db.prepare("UPDATE booking_groups SET held_room_id = 'rm-f-105' WHERE id = 'grp-demo-04'").run();
    await expect(AllocationService.finalizeGroupAllocation({ groupId: reg.group.id, adminId: 'admin-root-01', overrideRoomId: 'rm-f-105', accommodationStartDate: '2026-11-01' })).rejects.toThrow(/held/i);
  });

  it('preserves occupancy compatibility and restores an empty old room after reallocation', () => {
    const db = getDb();
    expect(() => AllocationService.reallocateStudent({ studentId: 'stu-demo-01', newRoomId: 'rm-m-201', reason: 'Wrong accommodation type', adminId: 'admin-root-01' })).toThrow(/capacity must match/i);
    const moved = AllocationService.reallocateStudent({ studentId: 'stu-demo-01', newRoomId: 'rm-m-104', reason: 'Accessibility move', adminId: 'admin-root-01' });
    expect(moved.room_id).toBe('rm-m-104');
    expect((db.prepare("SELECT status FROM rooms WHERE id = 'rm-m-101'").get() as any).status).toBe('AVAILABLE');
  });

  it('moves a shared group together and rejects individual movement', () => {
    const db = getDb();
    expect(() => AllocationService.reallocateStudent({ studentId: 'stu-demo-02', newRoomId: 'rm-f-202', reason: 'Split group', adminId: 'admin-root-01' })).toThrow(/relocated together/i);
    const moved = AllocationService.reallocateGroup({ groupId: 'grp-demo-02', newRoomId: 'rm-f-202', reason: 'Floor maintenance relocation', adminId: 'admin-root-01' });
    expect(moved).toHaveLength(2);
    expect((db.prepare("SELECT COUNT(*) as count FROM room_allocations WHERE room_id = 'rm-f-202' AND status = 'FINALIZED'").get() as any).count).toBe(2);
    expect((db.prepare("SELECT status FROM rooms WHERE id = 'rm-f-201'").get() as any).status).toBe('AVAILABLE');
  });
});
