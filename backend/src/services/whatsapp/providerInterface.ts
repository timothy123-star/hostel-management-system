import { WhatsAppProviderStatus } from '@hostel/shared';

export interface WhatsAppProvider {
  sendTextMessage(to: string, text: string): Promise<any>;
  sendQuickReplyButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<any>;
  sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<any>;
  isLive(): boolean;
  getStatus(): WhatsAppProviderStatus;
}
