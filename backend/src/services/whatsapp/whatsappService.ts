import { WhatsAppProvider } from './providerInterface.js';
import { MetaCloudProvider } from './metaCloudProvider.js';
import { SimulatorProvider } from './simulatorProvider.js';
import { WhatsAppProviderStatus } from '@hostel/shared';
import { config } from '../../config.js';

export class WhatsAppService {
  private static liveProvider: MetaCloudProvider | null = null;
  private static simulatorProvider: SimulatorProvider | null = null;
  private static forceSimulator = false;

  static getProvider(): WhatsAppProvider {
    if (this.forceSimulator) {
      if (!this.simulatorProvider) {
        this.simulatorProvider = new SimulatorProvider();
      }
      return this.simulatorProvider;
    }

    // Check if Meta credentials are fully provided
    const hasCredentials = !!(config.meta.accessToken && config.meta.phoneNumberId);
    if (hasCredentials) {
      if (!this.liveProvider) {
        this.liveProvider = new MetaCloudProvider();
      }
      return this.liveProvider;
    }

    if (!this.simulatorProvider) {
      this.simulatorProvider = new SimulatorProvider();
    }
    return this.simulatorProvider;
  }

  static setForceSimulator(val: boolean) {
    this.forceSimulator = val;
  }

  static getStatus(): WhatsAppProviderStatus {
    return this.getProvider().getStatus();
  }
}
