import { describe, it, expect, beforeEach } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { MatchingService } from '../src/services/matchingService.js';
import { StudentService } from '../src/services/studentService.js';
import { BookingGroupService } from '../src/services/bookingGroupService.js';

describe('Roommate Groups & Random Matching Queue Rules', () => {
  beforeEach(async () => {
    await runSeed(true);
  });

  it('rejects adding a student to random queue without consent', () => {
    // Register student with consent_random_matching = false
    const stu = StudentService.registerStudent({
      full_name: 'No Consent Student',
      phone_number: '+17770001122',
      gender: 'MALE',
      department: 'Math',
      academic_level: '100 Level',
      preferred_occupancy: 2,
      roommate_mode: 'RANDOM',
      consent_random_matching: false // No consent!
    });

    expect(() => {
      MatchingService.addToQueue(stu.student.id, 'MALE', 2);
    }).toThrow(/not consented/i);
  });

  it('matches 2 consenting students requesting double occupancy into a complete group', () => {
    // Clear any previous queue items to test deterministic matching of 2 students
    const db = (MatchingService as any).getDb ? (MatchingService as any).getDb() : null;

    // Student A
    const stuA = StudentService.registerStudent({
      full_name: 'Match Student Alpha',
      phone_number: '+17771110001',
      gender: 'MALE',
      department: 'Biotech',
      academic_level: '100 Level',
      preferred_occupancy: 2,
      roommate_mode: 'RANDOM',
      consent_random_matching: true
    });

    // Student B
    const stuB = StudentService.registerStudent({
      full_name: 'Match Student Beta',
      phone_number: '+17771110002',
      gender: 'MALE',
      department: 'Biotech',
      academic_level: '100 Level',
      preferred_occupancy: 2,
      roommate_mode: 'RANDOM',
      consent_random_matching: true
    });

    // Male queue had 0 waiting double students in seed, so Alpha and Beta match directly!
    const updatedA = StudentService.getStudentById(stuA.student.id);
    const updatedB = StudentService.getStudentById(stuB.student.id);

    expect(updatedA?.current_group).toBeDefined();
    expect(updatedB?.current_group).toBeDefined();
    expect(updatedA?.current_group?.id).toBe(updatedB?.current_group?.id);
    expect(updatedA?.current_group?.status).toBe('READY_FOR_ALLOCATION');
    expect(updatedA?.current_group?.member_count).toBe(2);
    expect(updatedA?.current_group?.eligible_at).toBeDefined();
  });

  it('prevents a student from joining a full group with invitation code', () => {
    // John Doe is in a single room group GRP-JOHNDOE (capacity 1)
    const newStudent = StudentService.registerStudent({
      full_name: 'Intruder Student',
      phone_number: '+17772223344',
      gender: 'MALE',
      department: 'CS',
      academic_level: '100 Level',
      preferred_occupancy: 1,
      roommate_mode: 'KNOWN',
      consent_random_matching: false
    });

    // Attempt to join John Doe's group
    expect(() => {
      BookingGroupService.joinGroup(newStudent.student.id, 'GRP-JOHNDOE');
    }).toThrow(/already|maximum capacity/i);
  });

  it('requires both known triple-pair members to agree before consuming a consenting queue student', () => {
    const leader = StudentService.registerStudent({ full_name: 'Triple Lead', phone_number: '+17773330001', gender: 'MALE', department: 'CS', academic_level: '100 Level', preferred_occupancy: 3, roommate_mode: 'KNOWN', consent_random_matching: false, auto_complete_triple_consent: true });
    StudentService.registerStudent({ full_name: 'Triple Member', phone_number: '+17773330002', gender: 'MALE', department: 'CS', academic_level: '100 Level', preferred_occupancy: 3, roommate_mode: 'KNOWN', consent_random_matching: false, auto_complete_triple_consent: false, group_invite_code: leader.group.group_code });
    const queued = StudentService.registerStudent({ full_name: 'Queue Consent', phone_number: '+17773330003', gender: 'MALE', department: 'CS', academic_level: '100 Level', preferred_occupancy: 3, roommate_mode: 'RANDOM', consent_random_matching: true });
    expect(() => MatchingService.completeKnownTripleGroup(leader.group.id, queued.queueItem.id)).toThrow(/consenting known pair/i);
  });
});
