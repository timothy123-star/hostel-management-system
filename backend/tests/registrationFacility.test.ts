import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/connection.js';
import { runSeed } from '../src/db/seed.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { StudentService } from '../src/services/studentService.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';

async function driveSingleRegistration(phone: string, name: string, genderButton: 'gender_male' | 'gender_female') {
  const steps: Array<{ messageId: string; from: string; textBody?: string; buttonId?: string }> = [
    { messageId: `${phone}-s1`, from: phone, textBody: 'BOOK' },
    { messageId: `${phone}-s2`, from: phone, textBody: name },
    { messageId: `${phone}-s3`, from: phone, buttonId: genderButton },
    { messageId: `${phone}-s4`, from: phone, textBody: 'Computer Science' },
    { messageId: `${phone}-s5`, from: phone, textBody: '100 Level' },
    { messageId: `${phone}-s6`, from: phone, buttonId: 'occ_1' },
  ];
  for (const m of steps) {
    await ConversationHandler.processIncomingMessage(m);
  }
}

describe('WhatsApp registration facility resolution', () => {
  beforeEach(async () => {
    await runSeed(true);
    WhatsAppService.setForceSimulator(true);
    SimulatorProvider.clearHistory();
  });

  it('maps Male Hostel selection to the male facility with a single group and pending payment', async () => {
    const phone = '+15550001001';
    await driveSingleRegistration(phone, 'Male Single Tester', 'gender_male');

    const registered = StudentService.getStudentByPhone(phone);
    expect(registered).toBeDefined();
    expect(registered?.gender).toBe('MALE');
    expect(registered?.preferred_occupancy).toBe(1);
    expect(registered?.current_group?.hostel_code).toBe('MALE');
    expect(registered?.current_group?.target_capacity).toBe(1);
    expect(registered?.current_group?.status).toBe('READY_FOR_ALLOCATION');

    const db = getDb();
    expect(db.prepare('SELECT count(*) AS c FROM students WHERE phone_number = ?').get(phone) as any).toMatchObject({ c: 1 });
    const payments = db.prepare('SELECT * FROM payments WHERE student_id = ?').all(registered!.id) as any[];
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('PENDING');
    expect(Number(payments[0].amount)).toBe(1200);

    const history = SimulatorProvider.getHistory(phone);
    expect(history.some(m => m.text?.includes('CONGRATULATIONS'))).toBe(true);
    expect(history.some(m => m.text?.includes('Alpha Male Hall'))).toBe(true);
  });

  it('maps Female Hostel selection to the female facility with a single group and pending payment', async () => {
    const phone = '+15550001002';
    await driveSingleRegistration(phone, 'Female Single Tester', 'gender_female');

    const registered = StudentService.getStudentByPhone(phone);
    expect(registered).toBeDefined();
    expect(registered?.gender).toBe('FEMALE');
    expect(registered?.preferred_occupancy).toBe(1);
    expect(registered?.current_group?.hostel_code).toBe('FEMALE');
    expect(registered?.current_group?.target_capacity).toBe(1);
    expect(registered?.current_group?.status).toBe('READY_FOR_ALLOCATION');

    const db = getDb();
    const payments = db.prepare('SELECT * FROM payments WHERE student_id = ?').all(registered!.id) as any[];
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('PENDING');

    const history = SimulatorProvider.getHistory(phone);
    expect(history.some(m => m.text?.includes('Beta Female Hall'))).toBe(true);
  });

  it('returns a clear error and leaves no partial records when the facility is unavailable', async () => {
    const db = getDb();
    db.prepare('DELETE FROM matching_queue').run();
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM room_allocations').run();
    db.prepare('DELETE FROM booking_group_members').run();
    db.prepare('DELETE FROM booking_groups').run();
    db.prepare('DELETE FROM rooms').run();
    db.prepare('DELETE FROM notification_preferences').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM hostels').run();

    expect(() =>
      StudentService.registerStudent({
        full_name: 'Stranded Tester',
        phone_number: '+15550001003',
        gender: 'MALE',
        department: 'Physics',
        academic_level: '100 Level',
        preferred_occupancy: 1,
        roommate_mode: 'KNOWN',
        consent_random_matching: false,
      })
    ).toThrow('Hostel facility not found');

    expect((db.prepare('SELECT count(*) AS c FROM students').get() as any).c).toBe(0);
    expect((db.prepare('SELECT count(*) AS c FROM booking_groups').get() as any).c).toBe(0);
    expect((db.prepare('SELECT count(*) AS c FROM payments').get() as any).c).toBe(0);
    expect((db.prepare('SELECT count(*) AS c FROM notification_preferences').get() as any).c).toBe(0);
  });
});
