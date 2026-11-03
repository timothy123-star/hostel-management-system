import crypto from 'crypto';
import { WhatsAppProvider } from './providerInterface.js';
import { WhatsAppProviderStatus } from '@hostel/shared';
import { getDb } from '../../db/connection.js';
import { config } from '../../config.js';

export interface SimulatedMessage {
  id: string;
  to: string;
  type: 'text' | 'interactive' | 'image';
  text?: string;
  buttons?: { id: string; title: string }[];
  imageUrl?: string;
  caption?: string;
  timestamp: string;
}

export class SimulatorProvider implements WhatsAppProvider {
  private static messageHistory: SimulatedMessage[] = [];

  isLive(): boolean {
    return false;
  }

  getStatus(): WhatsAppProviderStatus {
    return {
      is_live: false,
      provider_name: 'Local Simulator',
      phone_number_id_configured: !!config.meta.phoneNumberId,
      access_token_configured: !!config.meta.accessToken,
      app_secret_configured: !!config.meta.appSecret,
      webhook_verify_token_configured: !!config.meta.verifyToken,
      public_base_url: config.meta.publicBaseUrl,
      graph_api_version: config.meta.graphApiVersion
    };
  }

  private saveMessage(msg: SimulatedMessage) {
    SimulatorProvider.messageHistory.unshift(msg);
    if (SimulatorProvider.messageHistory.length > 200) {
      SimulatorProvider.messageHistory.pop();
    }

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO whatsapp_processed_messages (id, message_id, phone_number, message_type, direction, payload, processed_at)
        VALUES (?, ?, ?, ?, 'OUTBOUND', ?, ?)
      `).run(
        `wpm-${crypto.randomUUID()}`,
        msg.id,
        msg.to,
        msg.type,
        JSON.stringify(msg),
        msg.timestamp
      );
    } catch (e) {
      // Ignore if table not ready
    }
  }

  async sendTextMessage(to: string, text: string): Promise<any> {
    const id = `sim-out-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const msg: SimulatedMessage = { id, to, type: 'text', text, timestamp };
    this.saveMessage(msg);
    return { success: true, messageId: id, simulated: true };
  }

  async sendQuickReplyButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<any> {
    const id = `sim-out-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const msg: SimulatedMessage = { id, to, type: 'interactive', text, buttons, timestamp };
    this.saveMessage(msg);
    return { success: true, messageId: id, simulated: true };
  }

  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<any> {
    const id = `sim-out-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const msg: SimulatedMessage = { id, to, type: 'image', imageUrl, caption, timestamp };
    this.saveMessage(msg);
    return { success: true, messageId: id, simulated: true };
  }

  static getHistory(phone?: string): SimulatedMessage[] {
    if (phone) {
      return this.messageHistory.filter(m => m.to === phone);
    }
    return this.messageHistory;
  }

  static clearHistory() {
    this.messageHistory = [];
  }
}
