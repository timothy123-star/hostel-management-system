import crypto from 'crypto';
import { getDb } from '../../db/connection.js';
import { WhatsAppService } from './whatsappService.js';
import { StudentService } from '../studentService.js';
import { BookingGroupService } from '../bookingGroupService.js';
import { QRService } from '../qrService.js';
import { PaymentService } from '../paymentService.js';
import { WhatsAppState, RoomCapacity, HostelCode } from '@hostel/shared';
import { config } from '../../config.js';

export class ConversationHandler {
  /**
   * Retrieves or initializes conversation state for a phone number
   */
  static getConversation(phone: string): { state: WhatsAppState; payload: Record<string, any> } {
    const db = getDb();
    const row = db.prepare('SELECT * FROM whatsapp_conversations WHERE phone_number = ?').get(phone) as any;
    if (!row) {
      const now = new Date().toISOString();
      const id = `conv-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO whatsapp_conversations (id, phone_number, current_state, state_payload, last_active_at, created_at, updated_at)
        VALUES (?, ?, 'IDLE', '{}', ?, ?, ?)
      `).run(id, phone, now, now, now);
      return { state: 'IDLE', payload: {} };
    }
    return {
      state: row.current_state as WhatsAppState,
      payload: JSON.parse(row.state_payload || '{}')
    };
  }

  static updateConversation(phone: string, state: WhatsAppState, payload: Record<string, any>) {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE whatsapp_conversations
      SET current_state = ?, state_payload = ?, last_active_at = ?, updated_at = ?
      WHERE phone_number = ?
    `).run(state, JSON.stringify(payload), now, now, phone);
  }

  static resetConversation(phone: string) {
    this.updateConversation(phone, 'IDLE', {});
  }

  /**
   * Validates Meta Webhook HMAC-SHA256 signature using raw body buffer and app secret
   */
  static validateSignature(rawBody: Buffer | string, signatureHeader?: string): boolean {
    if (!config.meta.appSecret) {
      // In simulator or local testing without secret, allow through
      return true;
    }
    if (!signatureHeader) return false;

    const signature = signatureHeader.replace(/^sha256=/, '');
    const hmac = crypto.createHmac('sha256', config.meta.appSecret);
    const calculated = hmac.update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(calculated, 'hex'));
  }

  /**
   * Sends the Main Interactive Menu
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

    // Allocation is finalized! Fetch existing QR credential
    const qrResult = await QRService.getOrIssueCredential(student.id, alloc.id);

    const caption = `🏛️ *OFFICIAL HOSTEL DIGITAL IDENTITY PASS*\n\n` +
      `👤 *Student:* ${student.full_name}\n` +
      `🏢 *Facility:* ${alloc.hostel_code === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}\n` +
      `🚪 *Room:* ${alloc.room_number || 'Assigned'}\n` +
      `📅 *Start Date:* ${alloc.accommodation_start_date}\n` +
      `⏳ *Expiry Date:* ${alloc.accommodation_end_date}\n` +
      `🛡️ *Status:* ACTIVE\n\n` +
      `_Show this QR code at security checkpoints and hostel entry gates for verification._`;

    // Send the QR image
    await provider.sendImageMessage(phone, qrResult.qrImageData, caption);
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

    const group = student.current_group;
    const alloc = student.current_allocation;
    const payment = student.payment;

    let text = `📋 *YOUR ACCOMMODATION BOOKING SUMMARY*\n\n` +
      `*Name:* ${student.full_name}\n` +
      `*Hostel Facility:* ${student.gender === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}\n` +
      `*Department:* ${student.department} (${student.academic_level})\n` +
      `*Occupancy Preference:* ${student.preferred_occupancy}-Person Room\n\n`;

    if (group) {
      text += `👥 *Booking Group:* ${group.group_code}\n` +
        `*Group Status:* ${group.status.replace(/_/g, ' ')}\n` +
        `*Members:* ${group.member_count || 1}/${group.target_capacity}\n`;

      if (group.status === 'FORMING') {
        text += `👉 *Share Code:* Share code *${group.group_code}* with your roommates so they can join this group.\n`;
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
        text += `_Your payment has been logged and is awaiting manager verification._\n`;
      }
    }

    if (alloc && alloc.status === 'FINALIZED') {
      text += `\n🚪 *Allocated Room:* ${alloc.room_number}\n` +
        `*Duration:* ${alloc.accommodation_start_date} to ${alloc.accommodation_end_date}\n` +
        `✅ Your digital pass is active! Type *QR* to view it.\n`;
    }

    await provider.sendTextMessage(phone, text);
    if (payment?.status === 'PENDING' && group?.provisional_room) {
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
  }) {
    const db = getDb();
    const phone = incoming.from.trim();
    const rawText = (incoming.textBody || '').trim();
    const upperText = rawText.toUpperCase();
    const buttonId = incoming.buttonId;

    // 1. Idempotency Check
    const existing = db.prepare('SELECT id FROM whatsapp_processed_messages WHERE message_id = ?').get(incoming.messageId);
    if (existing) {
      console.log(`[WhatsApp] Skipping already processed message ${incoming.messageId}`);
      return;
    }

    // Record incoming message for idempotency
    try {
      db.prepare(`
        INSERT INTO whatsapp_processed_messages (id, message_id, phone_number, message_type, direction, payload, processed_at)
        VALUES (?, ?, ?, ?, 'INBOUND', ?, datetime('now'))
      `).run(
        `wpm-${crypto.randomUUID()}`,
        incoming.messageId,
        phone,
        buttonId ? 'interactive' : 'text',
        JSON.stringify(incoming)
      );
    } catch (e) {
      // Duplicate message caught by unique constraint
      return;
    }

    const provider = WhatsAppService.getProvider();
    const { state, payload } = this.getConversation(phone);

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

    if (upperText === 'HELP' || upperText === 'MENU' || upperText === 'HI' || upperText === 'HELLO') {
      this.resetConversation(phone);
      await this.sendMainMenu(phone);
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
        if (rawText.length < 2) {
          await provider.sendTextMessage(phone, 'Please enter a valid full name (minimum 2 characters):');
          return;
        }
        payload.full_name = rawText;
        this.updateConversation(phone, 'AWAITING_GENDER', payload);

        await provider.sendQuickReplyButtons(
          phone,
          `📝 *Hostel Registration — Step 2/6*\n\nHello ${rawText}! Please select your *Gender* to assign your appropriate hostel facility:`,
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
        if (rawText.length < 2) {
          await provider.sendTextMessage(phone, 'Please enter your department:');
          return;
        }
        payload.department = rawText;
        this.updateConversation(phone, 'AWAITING_LEVEL', payload);
        await provider.sendTextMessage(
          phone,
          `📝 *Hostel Registration — Step 4/6*\n\nPlease enter your *Academic Level* (e.g. 100 Level, 200 Level, 300 Level, 400 Level, Postgraduate):`
        );
        return;
      }

      case 'AWAITING_LEVEL': {
        if (rawText.length < 1) {
          await provider.sendTextMessage(phone, 'Please enter your academic level:');
          return;
        }
        payload.academic_level = rawText;
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
        if (buttonId === 'mode_known' || upperText.includes('KNOWN')) {
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

        if (buttonId === 'mode_random' || upperText.includes('RANDOM')) {
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

        if (upperText.startsWith('GRP-') || rawText.length >= 4) {
          // Joining with code
          payload.group_invite_code = upperText;
          await this.completeRegistration(phone, payload);
          return;
        }

        await provider.sendTextMessage(phone, 'Please reply with the invitation code (e.g. *GRP-ABCD*) or reply *NEW* to create your own group.');
        return;
      }

      case 'AWAITING_RANDOM_CONSENT': {
        if (buttonId === 'consent_yes' || upperText === 'YES' || upperText === 'Y' || upperText.includes('CONSENT')) {
          payload.consent_random_matching = true;
          await this.completeRegistration(phone, payload);
          return;
        }

        if (buttonId === 'consent_no' || upperText === 'NO' || upperText === 'N') {
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
  private static async completeRegistration(phone: string, payload: any) {
    const provider = WhatsAppService.getProvider();
    try {
      const regInput = {
        full_name: payload.full_name,
        phone_number: phone,
        gender: payload.gender,
        department: payload.department,
        academic_level: payload.academic_level,
        preferred_occupancy: payload.preferred_occupancy,
        roommate_mode: payload.roommate_mode,
        consent_random_matching: !!payload.consent_random_matching,
        auto_complete_triple_consent: !!payload.auto_complete_triple_consent,
        group_invite_code: payload.group_invite_code
      };

      const result = StudentService.registerStudent(regInput);
      this.resetConversation(phone);

      let successMsg = `🎉 *CONGRATULATIONS, ${result.student.full_name}! REGISTRATION COMPLETE*\n\n` +
        `*Facility:* ${result.student.gender === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}\n` +
        `*Occupancy:* ${result.student.preferred_occupancy}-Person Room\n`;

      if (result.group) {
        successMsg += `*Booking Group Code:* *${result.group.group_code}*\n` +
          `*Status:* ${result.group.status.replace(/_/g, ' ')}\n\n`;

        if (result.group.status === 'FORMING') {
          successMsg += `📢 *Next Step:* Share code *${result.group.group_code}* with your roommate(s). Once all members join, your group becomes eligible for room allocation.\n\n`;
        }
      }

      if (result.queueItem) {
        successMsg += `🤝 *Status:* Placed in the Random Matching Queue. You will be paired with compatible students based on queue priority.\n\n`;
      }

      successMsg += `💳 *Individual Payment:* Payment has been created in PENDING status. Please complete your deposit with the hostel bursary and notify the manager.\n\n` +
        `Type *STATUS* anytime to check your allocation progress, or *QR* once approved!`;

      await provider.sendTextMessage(phone, successMsg);
      await this.sendMainMenu(phone, 'How else can we help you today?');
    } catch (err: any) {
      console.error('Error completing student registration:', err);
      this.resetConversation(phone);
      await provider.sendTextMessage(
        phone,
        `❌ Registration error: ${err.message}\n\nPlease type *BOOK* to try again.`
      );
    }
  }
}
