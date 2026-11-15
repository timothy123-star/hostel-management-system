import crypto from 'crypto';
import { getDb } from '../../db/connection.js';
import { WhatsAppService } from './whatsappService.js';
import { StudentService } from '../studentService.js';
import { BookingGroupService } from '../bookingGroupService.js';
import { QRService } from '../qrService.js';
import { PaymentService } from '../paymentService.js';
import {
  WhatsAppState,
  RoomCapacity,
  HostelCode,
  FullNameSchema,
  DepartmentSchema,
  AcademicLevelSchema,
  GroupInviteCodeSchema,
  StudentRegistrationSchema,
  normalizePhoneNumber,
  isValidCanonicalPhone,
  phoneLookupCandidates,
} from '@hostel/shared';
import { config } from '../../config.js';
import { PHOTO_UPLOAD_DISCLOSURE_VERSION } from '../photoDisplayConsentService.js';

export class ConversationHandler {
  /**
   * Retrieves or initializes conversation state for a phone number.
   * Lookup covers canonical and legacy stored forms (see
   * phoneLookupCandidates) so rows written before phone canonicalization
   * are resumed instead of stranded. A legacy-keyed row is atomically
   * migrated to the canonical key on read.
   */
  static getConversation(phone: string): { state: WhatsAppState; payload: Record<string, any> } {
    const row = this.findConversationRow(phone);
    if (!row) {
      const db = getDb();
      const now = new Date().toISOString();
      const id = `conv-${crypto.randomUUID()}`;
      // INSERT OR IGNORE: concurrent first-messages for the same sender
      // race on UNIQUE(phone_number); the loser re-reads the winner below
      // instead of corrupting state or throwing.
      db.prepare(`
        INSERT OR IGNORE INTO whatsapp_conversations (id, phone_number, current_state, state_payload, last_active_at, created_at, updated_at)
        VALUES (?, ?, 'IDLE', '{}', ?, ?, ?)
      `).run(id, phone, now, now, now);
      const created = this.findConversationRow(phone);
      if (!created) return { state: 'IDLE', payload: {} };
      return {
        state: created.current_state as WhatsAppState,
        payload: JSON.parse(created.state_payload || '{}')
      };
    }
    return {
      state: row.current_state as WhatsAppState,
      payload: JSON.parse(row.state_payload || '{}')
    };
  }

  /**
   * Registration progression order, following the real state machine:
   * name -> gender -> department -> level -> occupancy -> roommate choice
   * -> triple auto-complete consent -> invite code / random consent.
   * AWAITING_INVITE_CODE and AWAITING_RANDOM_CONSENT are both terminal
   * pre-registration steps (rank 8). Higher rank always wins over a lower
   * rank; timestamps only break ties within the same rank. Unknown states
   * rank lowest and never beat a known state.
   */
  private static readonly CONVERSATION_STATE_PROGRESS: Record<string, number> = {
    IDLE: 0,
    AWAITING_NAME: 1,
    AWAITING_GENDER: 2,
    AWAITING_DEPT: 3,
    AWAITING_LEVEL: 4,
    AWAITING_OCCUPANCY: 5,
    AWAITING_ROOMMATE_CHOICE: 6,
    AWAITING_AUTO_COMPLETE_CONSENT: 7,
    AWAITING_INVITE_CODE: 8,
    AWAITING_RANDOM_CONSENT: 8,
  };

  /**
   * Locates a conversation row by any known representation of the number.
   * Lookup covers canonical and legacy stored forms (see
   * phoneLookupCandidates) so rows written before phone canonicalization
   * are resumed instead of stranded. A legacy-keyed row is atomically
   * migrated to the canonical key on read.
   *
   * Collision resolution: the genuinely further-progressed registration
   * state wins (see CONVERSATION_STATE_PROGRESS), not the newest
   * timestamp. Timestamps only break ties between rows at the same
   * progression rank — including same-state rows with divergent payloads,
   * where the most recently active row wins. Losing rows are never
   * silently discarded: each is archived with its full original state and
   * payload in the same transaction before deletion.
   */
  private static findConversationRow(phone: string): any {
    const db = getDb();
    const candidates = phoneLookupCandidates(phone);
    const placeholders = candidates.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT * FROM whatsapp_conversations WHERE phone_number IN (${placeholders})`
    ).all(...candidates) as any[];
    // Legacy rows may use separator formatting (e.g. "(234) 801-234-5679")
    // that no candidate reproduces exactly. Fall back to a digits-only
    // comparison, mirroring findStudentByWhatsAppSender. The conversations
    // table holds one row per sender and stays small.
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (digits.length >= 7) {
      const scanned = db.prepare('SELECT * FROM whatsapp_conversations').all() as any[];
      for (const row of scanned) {
        const rowDigits = (row.phone_number || '').replace(/[^0-9]/g, '');
        if (rowDigits === digits && !rows.some((r: any) => r.id === row.id)) {
          rows.push(row);
        }
      }
    }
    if (rows.length === 0) return null;
    if (rows.length === 1) {
      const only = rows[0];
      if (only.phone_number !== phone) this.migrateConversationKey(only, phone);
      return { ...only, phone_number: phone };
    }
    const progress = (state: string) => this.CONVERSATION_STATE_PROGRESS[state] ?? -1;
    const rank = (r: any) =>
      `${String(progress(r.current_state)).padStart(3, '0')}|${r.last_active_at || ''}|${r.updated_at || ''}|${r.created_at || ''}`;
    const sorted = [...rows].sort((a, b) => (rank(a) < rank(b) ? 1 : rank(a) > rank(b) ? -1 : 0));
    const winner = sorted[0];
    this.migrateConversationKey(winner, phone, sorted.slice(1));
    return { ...winner, phone_number: phone };
  }

  /**
   * Secures the winning row under the canonical phone key. Every losing
   * row is archived with its complete original state and payload BEFORE
   * deletion, in the same transaction — no user input is ever silently
   * discarded. Colliding rows are deleted first so the winner can take
   * the canonical key without violating UNIQUE(phone_number).
   */
  private static migrateConversationKey(winner: any, canonicalPhone: string, losers: any[] = []) {
    const db = getDb();
    const migrate = db.transaction(() => {
      for (const loser of losers) {
        if (loser.id !== winner.id) {
          db.prepare(
            `
            INSERT INTO whatsapp_conversation_archives
              (id, archived_conversation_id, phone_number, current_state, state_payload, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `,
          ).run(
            `wca-${crypto.randomUUID()}`,
            loser.id,
            loser.phone_number,
            loser.current_state,
            loser.state_payload || '{}',
            `collision: kept state ${winner.current_state} over ${loser.current_state}`,
          );
          db.prepare('DELETE FROM whatsapp_conversations WHERE id = ?').run(loser.id);
        }
      }
      if (winner.phone_number !== canonicalPhone) {
        db.prepare('UPDATE whatsapp_conversations SET phone_number = ?, updated_at = ? WHERE id = ?')
          .run(canonicalPhone, new Date().toISOString(), winner.id);
      }
    });
    migrate();
  }

  static updateConversation(phone: string, state: WhatsAppState, payload: Record<string, any>) {
    // Resolve through the candidate lookup so updates land on the migrated
    // canonical record even when the caller still holds a legacy form.
    const row = this.findConversationRow(phone);
    const key = row ? row.phone_number : phone;
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE whatsapp_conversations
      SET current_state = ?, state_payload = ?, last_active_at = ?, updated_at = ?
      WHERE phone_number = ?
    `).run(state, JSON.stringify(payload), now, now, key);
  }

  static resetConversation(phone: string) {
    this.updateConversation(phone, 'IDLE', {});
  }

  /**
   * Validates Meta Webhook HMAC-SHA256 signature using raw body buffer and app secret
   */
  static validateSignature(rawBody: Buffer | string | undefined, signatureHeader?: string | string[]): boolean {
    const appSecret = config.meta.appSecret?.trim() ?? '';
    if (!appSecret || rawBody === undefined || typeof signatureHeader !== 'string') return false;

    const signatureMatch = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader.trim());
    if (!signatureMatch) return false;

    const received = Buffer.from(signatureMatch[1], 'hex');
    const calculated = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
    return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
  }

  static readonly MENU_ROWS = [
    { id: 'menu_book', title: 'Book accommodation', description: 'Start registration (BOOK)' },
    { id: 'menu_status', title: 'Booking status', description: 'View booking (STATUS)' },
    { id: 'menu_qr', title: 'Show QR pass', description: 'Re-deliver QR (QR)' },
    { id: 'menu_payment', title: 'Payment instructions', description: 'DEMO only (PAYMENT)' },
    { id: 'menu_help', title: 'Help', description: 'Commands (HELP)' },
  ];

  /**
   * Exact affirmative replies that grant random-matching consent. Deliberately
   * exact: substring matching previously granted consent on refusals such as
   * "I DO NOT CONSENT" or "NO CONSENT".
   */
  private static readonly RANDOM_CONSENT_YES = new Set(['YES', 'Y', 'I CONSENT', 'CONSENT YES']);

  /**
   * Exact replies that refuse random-matching consent. These must never
   * grant consent. Anything else reprompts.
   */
  private static readonly RANDOM_CONSENT_NO = new Set([
    'NO', 'N', 'NO CONSENT', 'I DO NOT CONSENT', "I DON'T CONSENT", 'DO NOT CONSENT', 'CANCEL', 'NOPE',
  ]);

  /**
   * Exact roommate-choice tokens. Substring matching previously read
   * "UNKNOWN" as KNOWN and "RANDOMIZED" as RANDOM.
   */
  private static readonly ROOMMATE_KNOWN_TOKENS = new Set(['KNOWN', 'KNOWN ROOMMATES', 'KNOWN ROOMMATE']);
  private static readonly ROOMMATE_RANDOM_TOKENS = new Set(['RANDOM', 'RANDOM MATCHING']);

  /**
   * Sends the Main Interactive Menu (buttons for compatibility)
   */
  static async sendMainMenu(phone: string, customGreeting?: string) {
    const provider = WhatsAppService.getProvider();
    const student = StudentService.getStudentByPhone(phone);

    let greeting = customGreeting || '👋 Welcome to the Digital Hostel Accommodation Portal!';
    if (student) {
      greeting = `👋 Welcome back, ${student.full_name}!\nHostel: ${student.gender === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}`;
    }

    const bodyText = `${greeting}\n\nPlease choose an option below or type a command (e.g. *QR*, *BOOK*, *STATUS*, *HELP*):`;

    const buttons = [
      { id: 'btn_show_qr', title: 'Show my QR code' },
      { id: 'btn_view_booking', title: 'View my booking' },
      { id: 'btn_book_acc', title: 'Book accommodation' }
    ];

    await provider.sendQuickReplyButtons(phone, bodyText, buttons);
  }

  static async sendResidentMenu(phone: string, intro?: string) {
    const provider: any = WhatsAppService.getProvider();
    const body = intro || 'HostelOS resident menu — tap a row or type BOOK, STATUS, QR, PAYMENT, HELP.';
    if (typeof provider.sendListMenu === 'function') {
      await provider.sendListMenu(phone, body, 'Open menu', [{ title: 'Resident actions', rows: this.MENU_ROWS }]);
      return;
    }
    await provider.sendQuickReplyButtons(phone, body, [
      { id: 'menu_status', title: 'Booking status' },
      { id: 'menu_qr', title: 'Show QR pass' },
      { id: 'menu_payment', title: 'Payment info' },
    ]);
  }

  static buildBookingSummaryText(student: any): string {
    const group = student.current_group;
    const alloc = student.current_allocation;
    const payment = student.payment;
    let text = `📋 *YOUR ACCOMMODATION BOOKING SUMMARY*\n\n` +
      `*Hostel Facility:* ${student.gender === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}\n` +
      `*Department:* ${student.department} (${student.academic_level})\n` +
      `*Occupancy Preference:* ${student.preferred_occupancy}-Person Room\n\n`;
    if (group) {
      const isSingle = student.preferred_occupancy === 1 || group.target_capacity === 1;
      if (!isSingle) {
        text += `👥 *Booking Group:* ${group.group_code}\n` +
          `*Group Status:* ${String(group.status).replace(/_/g, ' ')}\n` +
          `*Members:* ${group.member_count || 1}/${group.target_capacity}\n`;
        if (group.status === 'FORMING') {
          text += `👉 *Share Code:* Share code *${group.group_code}* with your roommates so they can join this group.\n`;
        }
      } else {
        text += `*Booking Status:* ${String(group.status).replace(/_/g, ' ')}\n`;
      }
      if (group.provisional_room) {
        text += `\n🛏️ *Temporary Room Hold (not final allocation):* Room ${group.provisional_room.room_number}, ` +
          `${group.provisional_room.capacity}-person capacity, $${group.provisional_room.price_per_student} per student.\n` +
          `_All group payments must be verified before the manager can finalize this room._\n`;
      }
    }
    if (payment) {
      text += `\n💳 *Payment Status:* ${payment.status}\n` +
        `*Amount:* $${payment.amount} (Ref: ${payment.reference_code})\n`;
      if (payment.status === 'PENDING') {
        text += `_Your payment has been logged and is awaiting manager verification. DEMO ONLY — no real money._\n`;
      }
    }
    if (alloc && alloc.status === 'FINALIZED') {
      text += `\n🚪 *Allocated Room:* ${alloc.room_number}\n` +
        `*Duration:* ${alloc.accommodation_start_date} to ${alloc.accommodation_end_date}\n` +
        `✅ Your digital pass is active! Type *QR* to view it.\n`;
    }
    return text;
  }

  static canShowPaymentInstructions(student: any): boolean {
    return !!(student?.payment && student.payment.status === 'PENDING' && student?.current_group?.provisional_room);
  }

  /**
   * Handles "Show my QR code" button or "QR" / "PASS" command
   */
  static async handleShowQR(phone: string) {
    const provider = WhatsAppService.getProvider();
    const student = StudentService.getStudentByPhone(phone);

    if (!student) {
      await provider.sendTextMessage(
        phone,
        `❌ You do not have a registered student profile yet.\n\nPlease type *BOOK* or select "Book accommodation" to start your booking.`
      );
      await this.sendMainMenu(phone);
      return;
    }

    const alloc = student.current_allocation;
    if (!alloc || alloc.status !== 'FINALIZED') {
      await provider.sendTextMessage(
        phone,
        `⏳ *Digital Pass Not Ready*\n\n` +
        `Hello ${student.full_name},\n` +
        `Your accommodation pass cannot be issued yet because your room allocation is still pending manager verification.\n\n` +
        `Status: ${alloc ? alloc.status : 'Awaiting payment verification & allocation'}\n\n` +
        `Once all group members' payments are verified by the hostel manager, your individual cryptographic QR identity pass will be available here immediately.`
      );
      return;
    }

    const credential = await QRService.getQRForExistingCredential(student.id);
    if (!credential) {
      await provider.sendTextMessage(phone,
        '⏳ *Digital Pass Awaiting Manager Issuance*\n\nYour finalized accommodation is recorded, but a manager must explicitly authorize your credential after payment and photograph review. This request never creates a credential automatically.');
      return;
    }
    try {
      await QRService.redeliverActiveCredential(student.id);
      return;
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('before recoverable delivery was enabled')) {
        await provider.sendTextMessage(phone,
          '🔐 *Digital Pass Already Issued*\n\nThis pass was issued before secure re-delivery was enabled. Please contact hostel management to request a documented one-time reissue; the next pass will support secure QR re-delivery.');
        return;
      }
      await provider.sendTextMessage(phone,
        `⚠️ QR re-delivery is temporarily unavailable (${msg.slice(0, 160)}). Your credential remains valid. Please try again later or contact management.`);
      return;
    }
  }

  /**
   * Handles "View my booking" button or "STATUS" command
   */
  static async handleViewBooking(phone: string) {
    const provider = WhatsAppService.getProvider();
    const student = StudentService.getStudentByPhone(phone);

    if (!student) {
      await provider.sendTextMessage(
        phone,
        `You do not have an active booking profile yet. Type *BOOK* to begin registration.`
      );
      await this.sendMainMenu(phone);
      return;
    }

    const text = this.buildBookingSummaryText(student);
    await provider.sendTextMessage(phone, text);
    if (this.canShowPaymentInstructions(student)) {
      await provider.sendQuickReplyButtons(phone, 'View your individual DEMO payment instructions. No real money is involved.', [{ id: 'btn_payment_instructions', title: 'Payment instructions' }]);
    }
  }

  static async handlePaymentInstructions(phone: string) {
    const provider = WhatsAppService.getProvider();
    try {
      const { payment, bank, demoWarning } = PaymentService.getStudentInstructions(phone);
      await provider.sendQuickReplyButtons(phone, `💳 *INDIVIDUAL ACCOMMODATION PAYMENT INSTRUCTIONS*\n\nStudent: *${payment.full_name}*\nFacility: *${payment.hostel_name}*\nTemporary Room Hold: *${payment.room_number}* (${payment.capacity}-person)\nAmount: *$${payment.amount} ${payment.currency} (DEMO price)*\nPayment Reference: *${payment.reference_code}*\nStatus: *${payment.reconciliation_status || payment.status}*\n\nBank: *${bank.name}*\nAccount Name: *${bank.accountName}*\nAccount Number: *${bank.accountNumber}*\n\n⚠️ *${demoWarning}*`, [{ id: 'btn_simulate_bank_transfer', title: 'SIMULATE BANK TRANSFER' }]);
    } catch (err: any) { await provider.sendTextMessage(phone, `⚠️ ${err.message}`); }
  }

  /**
   * Main incoming message router (Meta webhook POST or simulator POST)
   */
  static async processIncomingMessage(incoming: {
    messageId: string;
    from: string;
    textBody?: string;
    buttonId?: string;
    image?: { id: string; mime_type?: string };
  }) {
    const db = getDb();
    if (typeof incoming.from !== 'string' || typeof incoming.messageId !== 'string') {
      console.warn('[WhatsApp] Dropping message with missing sender or id.');
      return;
    }
    const rawPhone = incoming.from.trim();
    const canonicalPhone = normalizePhoneNumber(rawPhone);
    if (!isValidCanonicalPhone(canonicalPhone)) {
      console.warn('[WhatsApp] Dropping message with invalid sender phone.');
      return;
    }
    const phone = canonicalPhone;
    const rawText = (typeof incoming.textBody === 'string' ? incoming.textBody : '').trim();
    const upperText = rawText.toUpperCase();
    const buttonId = typeof incoming.buttonId === 'string' ? incoming.buttonId : undefined;

    // 1. Idempotency check. The processed marker is written only AFTER
    // successful handling (see recordInboundProcessed), so a failure leaves
    // the message retryable instead of permanently suppressed.
    const existing = db.prepare('SELECT id FROM whatsapp_processed_messages WHERE message_id = ?').get(incoming.messageId);
    if (existing) {
      console.log(`[WhatsApp] Skipping already processed message ${incoming.messageId}`);
      return;
    }

    try {
      await this.handleIncomingCore(incoming);
    } catch (err) {
      // No processed marker on failure: the durable inbox worker may retry.
      console.warn(`[WhatsApp] Handling failed for ${incoming.messageId}; leaving it retryable.`);
      throw err;
    }

    this.recordInboundProcessed(incoming, phone);
  }

  /**
   * Writes the at-most-once processed marker only after the message was
   * fully handled. Concurrent duplicates race safely on the UNIQUE key.
   */
  private static recordInboundProcessed(
    incoming: { messageId: string; from: string; textBody?: string; buttonId?: string; image?: { id: string; mime_type?: string } },
    phone: string,
  ) {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO whatsapp_processed_messages (id, message_id, phone_number, message_type, direction, payload, processed_at)
        VALUES (?, ?, ?, ?, 'INBOUND', ?, datetime('now'))
      `).run(
        `wpm-${crypto.randomUUID()}`,
        incoming.messageId,
        phone,
        incoming.image ? 'image' : incoming.buttonId ? 'interactive' : 'text',
        JSON.stringify({ messageId: incoming.messageId, from: phone, hasImage: !!incoming.image })
      );
    } catch {
      // Duplicate marker from a concurrent delivery; already handled.
    }
  }

  /**
   * Core state-machine handling for one validated inbound message. Throws
   * on failure so callers (webhook inbox worker, simulator) can retry.
   */
  private static async handleIncomingCore(incoming: {
    messageId: string;
    from: string;
    textBody?: string;
    buttonId?: string;
    image?: { id: string; mime_type?: string };
  }) {
    const db = getDb();
    const rawPhone = incoming.from.trim();
    const canonicalPhone = normalizePhoneNumber(rawPhone);
    if (!isValidCanonicalPhone(canonicalPhone)) {
      console.warn('[WhatsApp] Dropping message with invalid sender phone.');
      return;
    }
    const phone = canonicalPhone;
    const rawText = (typeof incoming.textBody === 'string' ? incoming.textBody : '').trim();
    const upperText = rawText.toUpperCase();
    const buttonId = typeof incoming.buttonId === 'string' ? incoming.buttonId : undefined;

    const provider = WhatsAppService.getProvider();
    const { state, payload } = this.getConversation(phone);

    if (incoming.image) {
      await this.handleWhatsAppImage(phone, incoming.messageId, incoming.image);
      return;
    }

    // Global reset / menu commands
    if (buttonId === 'btn_show_qr' || upperText === 'QR' || upperText === 'PASS') {
      await this.handleShowQR(phone);
      return;
    }

    if (buttonId === 'btn_view_booking' || upperText === 'STATUS' || upperText === 'VIEW') {
      await this.handleViewBooking(phone);
      return;
    }

    if (buttonId === 'btn_payment_instructions' || upperText === 'PAYMENT') {
      await this.handlePaymentInstructions(phone);
      return;
    }

    if (buttonId === 'btn_simulate_bank_transfer') {
      try {
        const txn = PaymentService.simulateBankTransfer(phone);
        await provider.sendTextMessage(phone, `✅ *DEMO TRANSFER RECORDED — NO REAL MONEY*\n\nYour demo transfer has been recorded and is awaiting hostel payment verification.\n\nSimulated bank receipt: *${txn.bank_transaction_reference}*\nPayment reference: *${txn.payment_reference}*\nAmount: $${txn.amount} ${txn.currency}`);
      } catch (err: any) { await provider.sendTextMessage(phone, `⚠️ ${err.message}`); }
      return;
    }

    if (buttonId === 'menu_book' || (upperText === 'BOOK' && buttonId?.startsWith('menu_'))) {
      if (buttonId === 'menu_book') {
        const existing = StudentService.getStudentByPhone(phone);
        if (existing) { await this.handleViewBooking(phone); return; }
        this.updateConversation(phone, 'AWAITING_NAME', {});
        await provider.sendTextMessage(phone, `📝 *Hostel Registration — Step 1/6*\n\nPlease enter your *Full Name* (as registered in your university records):`);
        return;
      }
    }
    if (buttonId === 'menu_status') { await this.handleViewBooking(phone); return; }
    if (buttonId === 'menu_qr') { await this.handleShowQR(phone); return; }
    if (buttonId === 'menu_payment') { await this.handlePaymentInstructions(phone); return; }
    // Display permission is granted only by uploading a photograph after the
    // pre-upload disclosure (recorded automatically on submit). There is no
    // separate grant command. Residents may still withdraw display permission
    // at any time; withdrawal only ever withholds the photograph.
    if (upperText === 'CONSENT PHOTO NO' || upperText === 'CONSENT NO') { await this.handlePhotoConsent(phone, false); return; }
    // 'CONSENT YES' is also a valid random-matching consent token, so it must
    // still reach the state machine while registration is awaiting that
    // decision; otherwise the photo-permission notice would swallow it.
    if (upperText === 'CONSENT PHOTO YES' || (upperText === 'CONSENT YES' && state !== 'AWAITING_RANDOM_CONSENT')) {
      await provider.sendTextMessage(phone, 'No separate consent step is needed: uploading your photograph automatically grants permission for it to appear on authorized QR scans once a manager approves it. To send a photograph, attach it directly to this chat.');
      return;
    }
    if (buttonId === 'menu_help') { this.resetConversation(phone); await this.sendResidentMenu(phone); return; }

    if (upperText === 'MENU') {
      await this.sendResidentMenu(phone);
      return;
    }
    if (upperText === 'HELP' || upperText === 'HI' || upperText === 'HELLO') {
      this.resetConversation(phone);
      await this.sendMainMenu(phone);
      await this.sendResidentMenu(phone, 'More actions are available in the list below.');
      return;
    }

    if (buttonId === 'btn_book_acc' || upperText === 'BOOK') {
      // Check if student already registered
      const existingStudent = StudentService.getStudentByPhone(phone);
      if (existingStudent) {
        await provider.sendTextMessage(
          phone,
          `ℹ️ You are already registered as *${existingStudent.full_name}*.\n\nType *STATUS* to view your current booking, or *QR* to retrieve your pass.`
        );
        return;
      }

      this.updateConversation(phone, 'AWAITING_NAME', {});
      await provider.sendTextMessage(
        phone,
        `📝 *Hostel Registration — Step 1/6*\n\nPlease enter your *Full Name* (as registered in your university records):`
      );
      return;
    }

    // State machine steps
    switch (state) {
      case 'AWAITING_NAME': {
        const nameCheck = FullNameSchema.safeParse(rawText);
        if (!nameCheck.success) {
          const detail = nameCheck.error.issues[0]?.message || 'Please enter a valid full name (minimum 2 characters):';
          await provider.sendTextMessage(phone, `${detail} Reply with your full name as registered in your university records:`);
          return;
        }
        payload.full_name = nameCheck.data;
        this.updateConversation(phone, 'AWAITING_GENDER', payload);

        await provider.sendQuickReplyButtons(
          phone,
          `📝 *Hostel Registration — Step 2/6*\n\nHello ${payload.full_name}! Please select your *Gender* to assign your appropriate hostel facility:`,
          [
            { id: 'gender_male', title: 'Male Hostel' },
            { id: 'gender_female', title: 'Female Hostel' }
          ]
        );
        return;
      }

      case 'AWAITING_GENDER': {
        let gender: HostelCode | null = null;
        if (buttonId === 'gender_male' || upperText === 'MALE' || upperText === 'M') {
          gender = 'MALE';
        } else if (buttonId === 'gender_female' || upperText === 'FEMALE' || upperText === 'F') {
          gender = 'FEMALE';
        }

        if (!gender) {
          await provider.sendTextMessage(phone, 'Please specify your gender facility: type *MALE* or *FEMALE*:');
          return;
        }

        payload.gender = gender;
        this.updateConversation(phone, 'AWAITING_DEPT', payload);
        await provider.sendTextMessage(
          phone,
          `📝 *Hostel Registration — Step 3/6*\n\nPlease enter your *Academic Department* (e.g. Computer Science, Mechanical Engineering, Economics):`
        );
        return;
      }

      case 'AWAITING_DEPT': {
        const deptCheck = DepartmentSchema.safeParse(rawText);
        if (!deptCheck.success) {
          const detail = deptCheck.error.issues[0]?.message || 'Please enter your department:';
          await provider.sendTextMessage(phone, `${detail} Reply with your academic department:`);
          return;
        }
        payload.department = deptCheck.data;
        this.updateConversation(phone, 'AWAITING_LEVEL', payload);
        await provider.sendTextMessage(
          phone,
          `📝 *Hostel Registration — Step 4/6*\n\nPlease enter your *Academic Level* (e.g. 100 Level, 200 Level, 300 Level, 400 Level, Postgraduate):`
        );
        return;
      }

      case 'AWAITING_LEVEL': {
        const levelCheck = AcademicLevelSchema.safeParse(rawText);
        if (!levelCheck.success) {
          const detail = levelCheck.error.issues[0]?.message || 'Please enter your academic level:';
          await provider.sendTextMessage(phone, `${detail} Reply with your academic level:`);
          return;
        }
        payload.academic_level = levelCheck.data;
        this.updateConversation(phone, 'AWAITING_OCCUPANCY', payload);

        await provider.sendQuickReplyButtons(
          phone,
          `📝 *Hostel Registration — Step 5/6*\n\nPlease select your preferred room occupancy:\n\n` +
          `• *Single:* 1 student ($1,200/yr DEMO)\n` +
          `• *Double:* 2 students ($800/yr DEMO)\n` +
          `• *Triple:* 3 students ($600/yr DEMO)`,
          [
            { id: 'occ_1', title: 'Single Room (1)' },
            { id: 'occ_2', title: 'Double Room (2)' },
            { id: 'occ_3', title: 'Triple Room (3)' }
          ]
        );
        return;
      }

      case 'AWAITING_OCCUPANCY': {
        let cap: RoomCapacity | null = null;
        if (buttonId === 'occ_1' || upperText === '1' || upperText === 'SINGLE') cap = 1;
        if (buttonId === 'occ_2' || upperText === '2' || upperText === 'DOUBLE') cap = 2;
        if (buttonId === 'occ_3' || upperText === '3' || upperText === 'TRIPLE') cap = 3;

        if (!cap) {
          await provider.sendTextMessage(phone, 'Please select occupancy: type *1* (Single), *2* (Double), or *3* (Triple):');
          return;
        }

        payload.preferred_occupancy = cap;

        if (cap === 1) {
          // Single room has no roommates needed, complete registration now!
          payload.roommate_mode = 'KNOWN';
          payload.consent_random_matching = false;
          await this.completeRegistration(phone, payload);
          return;
        }

        // Shared room (2 or 3)
        this.updateConversation(phone, 'AWAITING_ROOMMATE_CHOICE', payload);
        await provider.sendQuickReplyButtons(
          phone,
          `📝 *Hostel Registration — Step 6/6*\n\nDo you have specific roommates you want to share with, or would you like to opt into random matching?`,
          [
            { id: 'mode_known', title: 'Known Roommates' },
            { id: 'mode_random', title: 'Random Matching' }
          ]
        );
        return;
      }

      case 'AWAITING_ROOMMATE_CHOICE': {
        if (buttonId === 'mode_known' || this.ROOMMATE_KNOWN_TOKENS.has(upperText)) {
          payload.roommate_mode = 'KNOWN';
          if (payload.preferred_occupancy === 3) {
            this.updateConversation(phone, 'AWAITING_AUTO_COMPLETE_CONSENT', payload);
            await provider.sendQuickReplyButtons(phone,
              'For a triple room, do you and your known roommate(s) agree that management may complete your pair with the next independently consenting student in the FIFO queue?',
              [{ id: 'auto_complete_yes', title: 'Yes, we agree' }, { id: 'auto_complete_no', title: 'No, known only' }]);
            return;
          }
          this.updateConversation(phone, 'AWAITING_INVITE_CODE', payload);
          await provider.sendTextMessage(
            phone,
            `👥 *Roommate Group Setup*\n\n` +
            `• If your roommate already created a group, reply with their *Invitation Code* (e.g. *GRP-M7K2*).\n` +
            `• If you are the first roommate and want to create a new group code to share with friends, reply *NEW*.`
          );
          return;
        }

        if (buttonId === 'mode_random' || this.ROOMMATE_RANDOM_TOKENS.has(upperText)) {
          payload.roommate_mode = 'RANDOM';
          this.updateConversation(phone, 'AWAITING_RANDOM_CONSENT', payload);
          await provider.sendQuickReplyButtons(
            phone,
            `🤝 *Random Roommate Matching Consent*\n\n` +
            `Do you consent to being matched with verified fellow students of the same gender facility requesting ${payload.preferred_occupancy}-person occupancy?\n\n` +
            `_Only students who independently consent can be matched._`,
            [
              { id: 'consent_yes', title: 'I Consent (Yes)' },
              { id: 'consent_no', title: 'No (Cancel)' }
            ]
          );
          return;
        }

        await provider.sendTextMessage(phone, 'Please choose *Known Roommates* or *Random Matching*.');
        return;
      }

      case 'AWAITING_AUTO_COMPLETE_CONSENT': {
        if (buttonId === 'auto_complete_yes' || upperText === 'YES') payload.auto_complete_triple_consent = true;
        else if (buttonId === 'auto_complete_no' || upperText === 'NO') payload.auto_complete_triple_consent = false;
        else {
          await provider.sendTextMessage(phone, 'Please reply YES to agree to automatic completion, or NO for known roommates only.');
          return;
        }
        this.updateConversation(phone, 'AWAITING_INVITE_CODE', payload);
        await provider.sendTextMessage(phone, 'Reply with an invitation code (for example GRP-ABCD), or NEW to create a group.');
        return;
      }

      case 'AWAITING_INVITE_CODE': {
        if (upperText === 'NEW') {
          // Creating new group
          payload.group_invite_code = undefined;
          await this.completeRegistration(phone, payload);
          return;
        }

        const codeCheck = GroupInviteCodeSchema.safeParse(rawText);
        if (codeCheck.success) {
          // Joining with code (stored uppercased by the shared schema)
          payload.group_invite_code = codeCheck.data;
          await this.completeRegistration(phone, payload);
          return;
        }

        await provider.sendTextMessage(phone, 'That invitation code was not recognized. Codes look like *GRP-XXXX* (4 characters, no I/O/0/1). Reply with the code or reply *NEW* to create your own group.');
        return;
      }

      case 'AWAITING_RANDOM_CONSENT': {
        if (buttonId === 'consent_yes' || this.RANDOM_CONSENT_YES.has(upperText)) {
          payload.consent_random_matching = true;
          await this.completeRegistration(phone, payload);
          return;
        }

        if (buttonId === 'consent_no' || this.RANDOM_CONSENT_NO.has(upperText)) {
          this.resetConversation(phone);
          await provider.sendTextMessage(
            phone,
            'Registration cancelled. You can type *BOOK* anytime to start over.'
          );
          await this.sendMainMenu(phone);
          return;
        }

        await provider.sendTextMessage(phone, 'Please confirm your consent: reply *YES* or *NO*.');
        return;
      }

      default:
        // Idle state, unrecognized message
        await this.sendMainMenu(phone);
        break;
    }
  }

  /**
   * Completes registration and informs the student of their booking status
   */
  private static digitsOnly(value: string): string {
    return (value || '').replace(/[^0-9]/g, '');
  }

  private static findStudentByWhatsAppSender(phone: string): { status: 'matched' | 'unknown' | 'ambiguous'; studentId?: string } {
    const db = getDb();
    const trimmed = phone.trim();
    const digits = this.digitsOnly(trimmed);
    const candidates = new Set<string>(phoneLookupCandidates(phone));
    const rows = db.prepare('SELECT id, phone_number FROM students').all() as any[];
    const matches = rows.filter(r => {
      if (candidates.has((r.phone_number || '').trim())) return true;
      return digits.length >= 7 && this.digitsOnly(r.phone_number) === digits;
    });
    const unique = [...new Map(matches.map(r => [r.id, r])).values()];
    if (unique.length === 1) return { status: 'matched', studentId: unique[0].id };
    if (unique.length > 1) return { status: 'ambiguous' };
    return { status: 'unknown' };
  }

  /**
   * Withdrawal-only handler. Permission is granted solely by uploading after
   * the pre-upload disclosure; this path only records a resident takedown
   * (WITHDRAWN), which immediately withholds the photograph from scans.
   */
  static async handlePhotoConsent(phone: string, granted: boolean) {
    const provider = WhatsAppService.getProvider();
    const match = this.findStudentByWhatsAppSender(phone);
    if (match.status !== 'matched' || !match.studentId) {
      await provider.sendTextMessage(phone, 'We could not link this WhatsApp number to a student profile, so photo-display consent was not recorded. Please contact management.');
      return;
    }
    if (granted) {
      await provider.sendTextMessage(phone, 'No separate consent step is needed: uploading your photograph automatically grants permission for it to appear on authorized QR scans once a manager approves it. To send a photograph, attach it directly to this chat.');
      return;
    }
    try {
      const { PhotoDisplayConsentService } = await import('../photoDisplayConsentService.js');
      PhotoDisplayConsentService.recordDecision({ studentId: match.studentId, decision: 'WITHDRAWN', decidedBy: 'RESIDENT', notes: 'Resident withdrew QR photo display via WhatsApp.' });
      await provider.sendTextMessage(phone, 'Noted. Your photograph will NOT be shown on authorized QR scans. Your pass still verifies name, facility, room and dates.');
    } catch (err: any) {
      await provider.sendTextMessage(phone, `⚠️ ${err?.message || 'Consent could not be recorded.'}`);
    }
  }

  /**
   * Durable pre-upload disclosure gate. The photo-display disclosure must be
   * shown before a photograph is accepted: the first image from a sender
   * without a current-version disclosure record triggers the disclosure plus
   * a resend request and is never processed or permission-granting. The
   * record survives conversation resets; rejections re-arm it for the next
   * replacement round.
   */
  static hasPhotoDisclosure(phone: string, studentId: string): boolean {
    try {
      const row = getDb().prepare(
        'SELECT disclosure_version FROM whatsapp_photo_disclosures WHERE phone_number = ?'
      ).get(phone) as any;
      return !!row && row.disclosure_version === PHOTO_UPLOAD_DISCLOSURE_VERSION && !!studentId;
    } catch {
      return false;
    }
  }

  static recordPhotoDisclosure(phone: string, studentId: string): void {
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO whatsapp_photo_disclosures (phone_number, student_id, disclosure_version, shown_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(phone_number) DO UPDATE SET student_id = excluded.student_id, disclosure_version = excluded.disclosure_version, shown_at = excluded.shown_at`)
      .run(phone, studentId, PHOTO_UPLOAD_DISCLOSURE_VERSION, now, now);
  }

  static async handleWhatsAppImage(phone: string, messageId: string, image: { id: string; mime_type?: string }) {
    const provider = WhatsAppService.getProvider();
    const match = this.findStudentByWhatsAppSender(phone);
    if (match.status === 'unknown') {
      await provider.sendTextMessage(phone, `We received your photograph, but this WhatsApp number is not linked to a student profile yet.\n\nType *BOOK* to register first, then resend the photograph.`);
      return;
    }
    if (match.status === 'ambiguous' || !match.studentId) {
      await provider.sendTextMessage(phone, `We received your photograph, but this number matches more than one profile. Please contact hostel management so we link the correct student before resending.`);
      return;
    }
    const { PHOTO_UPLOAD_DISCLOSURE_VERSION, PHOTO_WHATSAPP_DISCLOSURE_TEXT } = await import('../photoDisplayConsentService.js');
    if (!this.hasPhotoDisclosure(phone, match.studentId)) {
      this.recordPhotoDisclosure(phone, match.studentId);
      await provider.sendTextMessage(phone, `${PHOTO_WHATSAPP_DISCLOSURE_TEXT}\n\nYour photograph was not saved yet. Please resend it now to confirm, and it will be reviewed by hostel management.`);
      return;
    }
    try {
      const { WhatsAppMediaService } = await import('./whatsappMediaService.js');
      const { StudentPhotoService } = await import('../studentPhotoService.js');
      const media = await WhatsAppMediaService.getMediaDownload({ id: image.id });
      const submitted = await StudentPhotoService.submitWhatsAppPhoto(match.studentId, media.bytes, { messageId, phoneNumber: phone }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
      await provider.sendTextMessage(phone, submitted.isReplacement
        ? `✅ Replacement photograph received and *PENDING REVIEW*. Your current approved photograph stays active on authorized QR scans until a manager approves the replacement. You will be notified after review.`
        : `✅ Photograph received. By sending it after the disclosure you agreed it will be reviewed by hostel management and, once approved, shown with your name, facility and room when authorized staff verify your QR pass. It is now *PENDING REVIEW*. You will be notified after approval. Type *STATUS* to check your booking.`);
    } catch (err: any) {
      await provider.sendTextMessage(phone, `⚠️ ${err.message || 'Unable to process the photograph. Please resend a clear JPEG, PNG, or WebP image (5 MB or smaller).'}`);
    }
  }

  private static async completeRegistration(phone: string, payload: any) {
    const provider = WhatsAppService.getProvider();
    try {
      // Strict booleans: only an actual `true` grants consent. Strings such
      // as "false" must never become truthy through `!!value`.
      const regInput = {
        full_name: payload.full_name,
        phone_number: phone,
        gender: payload.gender,
        department: payload.department,
        academic_level: payload.academic_level,
        preferred_occupancy: payload.preferred_occupancy,
        roommate_mode: payload.roommate_mode,
        consent_random_matching: payload.consent_random_matching === true,
        auto_complete_triple_consent: payload.auto_complete_triple_consent === true,
        group_invite_code: payload.group_invite_code
      };

      const checked = StudentRegistrationSchema.safeParse(regInput);
      if (!checked.success) {
        const detail = checked.error.issues[0]?.message || 'Registration details need correction.';
        console.warn('[WhatsApp] Registration validation failed:', checked.error.issues);
        this.resetConversation(phone);
        await provider.sendTextMessage(
          phone,
          `We could not complete registration: ${detail}\n\nPlease type *BOOK* to start again and check each answer.`
        );
        return;
      }

      const result = StudentService.registerStudent(checked.data);
      this.resetConversation(phone);

      const isSingle = result.student.preferred_occupancy === 1;
      let successMsg = `🎉 *CONGRATULATIONS, ${result.student.full_name}! REGISTRATION COMPLETE*\n\n` +
        `*Facility:* ${result.student.gender === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}\n` +
        `*Occupancy:* ${result.student.preferred_occupancy}-Person Room\n`;

      if (result.group && !isSingle) {
        successMsg += `*Booking Group Code:* *${result.group.group_code}*\n` +
          `*Status:* ${result.group.status.replace(/_/g, ' ')}\n\n`;
        if (result.group.status === 'FORMING') {
          successMsg += `📢 *Next Step:* Share code *${result.group.group_code}* with your roommate(s). Once all members join, your group becomes eligible for room allocation.\n\n`;
        }
      } else if (result.group) {
        successMsg += `*Booking Status:* ${result.group.status.replace(/_/g, ' ')}\n\n`;
      }

      if (result.queueItem) {
        successMsg += `🤝 *Status:* Placed in the Random Matching Queue. You will be paired with compatible students based on queue priority.\n\n`;
      }

      successMsg += `💳 *Individual Payment:* Payment has been created in PENDING status. Please complete your deposit with the hostel bursary and notify the manager.\n\n` +
        `Type *STATUS* anytime to check your allocation progress, or *QR* once approved!`;

      await provider.sendTextMessage(phone, successMsg);
      try {
        const fresh = StudentService.getStudentByPhone(phone);
        if (fresh) {
          await provider.sendTextMessage(phone, this.buildBookingSummaryText(fresh));
          if (this.canShowPaymentInstructions(fresh)) {
            await provider.sendQuickReplyButtons(phone, 'Tap below for your DEMO payment instructions. Requesting instructions never moves money.', [{ id: 'btn_payment_instructions', title: 'PAYMENT INSTRUCTIONS' }]);
          }
        }
      } catch { /* summary is best-effort */ }
      await this.sendMainMenu(phone, 'How else can we help you today?');
      await this.sendResidentMenu(phone, 'Prefer a list? Use the menu below or type MENU anytime.');
    } catch (err: any) {
      console.error('Error completing student registration:', err);
      this.resetConversation(phone);
      await provider.sendTextMessage(
        phone,
        `❌ We could not complete registration: ${err?.issues?.[0]?.message || err?.message || 'Registration could not be completed.'}\n\nPlease type *BOOK* to try again.`
      );
    }
  }
}
