import { describe, it, expect, beforeEach } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { StudentService } from '../src/services/studentService.js';

describe('WhatsApp Conversational Assistant & Simulator', () => {
  beforeEach(async () => {
    await runSeed(true);
    SimulatorProvider.clearHistory();
  });

  it('renders interactive menu with Show my QR code button and responds to MENU command', async () => {
    const testPhone = '+14440001111';
    await ConversationHandler.processIncomingMessage({
      messageId: 'msg-001',
      from: testPhone,
      textBody: 'MENU'
    });

    const history = SimulatorProvider.getHistory(testPhone);
    expect(history.length).toBeGreaterThan(0);
    const reply = history[0];
    expect(reply.type).toBe('interactive');
    expect(reply.buttons).toBeDefined();
    expect(reply.buttons?.some(b => b.title === 'Show my QR code')).toBe(true);
  });

  it('never silently issues a QR credential from the Show my QR button', async () => {
    // John Doe's phone is +15551001001
    const johnPhone = '+15551001001';
    await ConversationHandler.processIncomingMessage({
      messageId: 'msg-qr-001',
      from: johnPhone,
      buttonId: 'btn_show_qr'
    });

    const history = SimulatorProvider.getHistory(johnPhone);
    expect(history.some(m => m.type === 'image')).toBe(false);
    expect(history.some(m => m.text?.includes('Awaiting Manager Issuance'))).toBe(true);
  });

  it('handles typed QR fallback without issuing a credential', async () => {
    const johnPhone = '+15551001001';
    await ConversationHandler.processIncomingMessage({
      messageId: 'msg-qr-fallback-002',
      from: johnPhone,
      textBody: 'QR'
    });

    const history = SimulatorProvider.getHistory(johnPhone);
    expect(history.some(m => m.type === 'image')).toBe(false);
    expect(history.some(m => m.text?.includes('Awaiting Manager Issuance'))).toBe(true);
  });

  it('completes multi-step registration conversation for a new student', async () => {
    const newPhone = '+19998887766';

    // 1. User starts booking
    await ConversationHandler.processIncomingMessage({
      messageId: 'step-1',
      from: newPhone,
      textBody: 'BOOK'
    });

    // 2. Enters Name
    await ConversationHandler.processIncomingMessage({
      messageId: 'step-2',
      from: newPhone,
      textBody: 'Alice Wonderland'
    });

    // 3. Selects Female Hostel
    await ConversationHandler.processIncomingMessage({
      messageId: 'step-3',
      from: newPhone,
      buttonId: 'gender_female'
    });

    // 4. Enters Department
    await ConversationHandler.processIncomingMessage({
      messageId: 'step-4',
      from: newPhone,
      textBody: 'Cybersecurity'
    });

    // 5. Enters Level
    await ConversationHandler.processIncomingMessage({
      messageId: 'step-5',
      from: newPhone,
      textBody: '200 Level'
    });

    // 6. Selects Single Occupancy
    await ConversationHandler.processIncomingMessage({
      messageId: 'step-6',
      from: newPhone,
      buttonId: 'occ_1'
    });

    // Student should now be registered!
    const registered = StudentService.getStudentByPhone(newPhone);
    expect(registered).toBeDefined();
    expect(registered?.full_name).toBe('Alice Wonderland');
    expect(registered?.gender).toBe('FEMALE');
    expect(registered?.preferred_occupancy).toBe(1);

    const history = SimulatorProvider.getHistory(newPhone);
    const successMsg = history.find(m => m.text?.includes('CONGRATULATIONS'));
    expect(successMsg).toBeDefined();
  });

  it('enforces idempotency on duplicate incoming message IDs', async () => {
    const testPhone = '+14441112222';
    const messageId = 'duplicate-id-test-999';

    // First delivery
    await ConversationHandler.processIncomingMessage({
      messageId,
      from: testPhone,
      textBody: 'HELP'
    });

    const count1 = SimulatorProvider.getHistory(testPhone).length;

    // Duplicate delivery of same message ID
    await ConversationHandler.processIncomingMessage({
      messageId,
      from: testPhone,
      textBody: 'HELP'
    });

    const count2 = SimulatorProvider.getHistory(testPhone).length;
    expect(count2).toBe(count1); // Second call ignored due to idempotency!
  });
});
