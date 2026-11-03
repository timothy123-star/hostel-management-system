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
});
