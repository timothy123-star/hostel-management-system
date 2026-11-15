import { createApp } from './app.js';
import { config, validateProductionConfig } from './config.js';
import { getDb, initSchema } from './db/connection.js';
import { bootstrapInitialManager } from './services/initialAdminService.js';
import { recoverAbandonedInbox, startInboxWorker, stopInboxWorker } from './services/whatsapp/whatsappInbox.js';

export async function startServer() {
  validateProductionConfig();

  // Schema initialization must precede the one-time manager bootstrap.
  const db = getDb();
  initSchema(db);
  // Recover WhatsApp inbox rows abandoned by an unclean shutdown. Never
  // throws: a failed recovery must not prevent the server from booting.
  try {
    recoverAbandonedInbox();
  } catch (err) {
    console.error('[WhatsApp Inbox] Startup recovery failed:', err);
  }
  // Autonomous worker: immediate drain of eligible RECEIVED / due RETRYABLE
  // records, then bounded polling. The poll timer is unreferenced so it
  // never keeps the process alive on its own.
  try {
    startInboxWorker();
  } catch (err) {
    console.error('[WhatsApp Inbox] Worker startup failed:', err);
  }
  // Clean stop for shutdown; in-flight cycles run to completion and the
  // unreferenced timer does not block process exit.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      try {
        stopInboxWorker();
      } catch (err) {
        console.error('[WhatsApp Inbox] Worker stop failed:', err);
      }
    });
  }
  if (config.nodeEnv === 'production') {
    await bootstrapInitialManager(db);
  }

  const app = createApp();
  // Railway injects PORT and requires binding to 0.0.0.0 for public routing.
  return app.listen(config.port, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` Hostels Management & WhatsApp Backend Running`);
    console.log(` Port:     ${config.port}`);
    console.log(` Mode:     ${config.nodeEnv}`);
    console.log(` Database: ${config.dbPath}`);
    console.log(` WhatsApp: ${config.meta.accessToken ? 'Meta Cloud API (Configured)' : 'Local Simulator Mode'}`);
    console.log(`=======================================================`);
  });
}

const server = await startServer();
export default server;
