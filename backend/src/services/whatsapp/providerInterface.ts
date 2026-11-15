import { WhatsAppProviderStatus } from '@hostel/shared';

export interface WhatsAppProvider {
  sendTextMessage(to: string, text: string): Promise<any>;
  sendQuickReplyButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<any>;
  sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<any>;
  sendImageBuffer?(to: string, pngBuffer: Buffer, caption?: string): Promise<any>;
  sendListMenu?(to: string, bodyText: string, buttonText: string, sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[]): Promise<any>;
  sendTemplateMessage?(to: string, templateName: string, languageCode: string, bodyParams: string[]): Promise<any>;
  isLive(): boolean;
  getStatus(): WhatsAppProviderStatus;
}
