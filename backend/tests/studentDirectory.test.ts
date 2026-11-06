import { beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { StudentService } from '../src/services/studentService.js';

describe('Student Directory data source', () => {
  beforeEach(async () => { await runSeed(true); });

  it('returns seeded and newly registered students when no filters are supplied', () => {
    const initial = StudentService.getStudents({});
    expect(initial.length).toBeGreaterThan(0);
    StudentService.registerStudent({ full_name: 'Directory Regression Student', phone_number: '+17774440001', gender: 'FEMALE', department: 'Science', academic_level: '200 Level', preferred_occupancy: 1, roommate_mode: 'KNOWN', consent_random_matching: false });
    expect(StudentService.getStudents({}).some(student => student.full_name === 'Directory Regression Student')).toBe(true);
  });

  it('returns the manager selector data without requiring an internal ID lookup', () => {
    const john = StudentService.getStudents({ search: 'John Doe', limit: 20 }).find(student => student.id === 'stu-demo-01') as any;
    expect(john).toMatchObject({
      full_name: 'John Doe (DEMO)',
      phone_number: '+15551001001',
      current_allocation: { status: 'FINALIZED', room_number: 'M-101', hostel_code: 'MALE' },
      payment: { status: 'VERIFIED' }
    });
    expect(john.photo_status).toBe('NOT_SUBMITTED');
  });
});
