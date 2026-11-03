import { WhatsAppProvider } from './providerInterface.js';
import { WhatsAppProviderStatus } from '@hostel/shared';
import { config } from '../../config.js';

export class MetaCloudProvider implements WhatsAppProvider {
  private apiUrl: string;
  private token: string;
  private phoneNumberId: string;

  constructor() {
    this.token = config.meta.accessToken;
    this.phoneNumberId = config.meta.phoneNumberId;
    this.apiUrl = `https://graph.facebook.com/${config.meta.graphApiVersion}/${this.phoneNumberId}/messages`;
  }

  isLive(): boolean {
    return !!(this.token && this.phoneNumberId);
  }

  getStatus(): WhatsAppProviderStatus {
    return {
      is_live: this.isLive(),
      provider_name: 'Meta WhatsApp Cloud API',
      phone_number_id_configured: !!this.phoneNumberId,
      access_token_configured: !!this.token,
      app_secret_configured: !!config.meta.appSecret,
      webhook_verify_token_configured: !!config.meta.verifyToken,
      public_base_url: config.meta.publicBaseUrl,
      graph_api_version: config.meta.graphApiVersion
    };
  }

  private cleanPhoneNumber(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
  }

  private async sendPayload(payload: any): Promise<any> {
    if (!this.isLive()) {
      throw new Error('Meta WhatsApp Cloud API credentials not configured.');
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json() as any;
    if (!response.ok) {
      console.error('Meta Cloud API Error:', data);
      throw new Error(data?.error?.message || 'Meta Cloud API request failed');
    }
    return data;
  }

  async sendTextMessage(to: string, text: string): Promise<any> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.cleanPhoneNumber(to),
      type: 'text',
      text: { preview_url: false, body: text }
    };
    return this.sendPayload(payload);
  }

  async sendQuickReplyButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<any> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.cleanPhoneNumber(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: buttons.slice(0, 3).map(b => ({
            type: 'reply',
            reply: {
              id: b.id,
              title: b.title.slice(0, 20)
            }
          }))
        }
      }
    };
    return this.sendPayload(payload);
  }

  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<any> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.cleanPhoneNumber(to),
      type: 'image',
      image: {
        link: imageUrl,
        caption: caption || undefined
      }
    };
    return this.sendPayload(payload);
  }
}
