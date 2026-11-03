import { createApp } from './app.js';
import { config } from './config.js';
import { getDb, initSchema } from './db/connection.js';

const app = createApp();

// Ensure DB is initialized
const db = getDb();
initSchema(db);

const server = app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(` Hostels Management & WhatsApp Backend Running`);
  console.log(` Port:     ${config.port}`);
  console.log(` Mode:     ${config.nodeEnv}`);
  console.log(` Database: ${config.dbPath}`);
  console.log(` WhatsApp: ${config.meta.accessToken ? 'Meta Cloud API (Configured)' : 'Local Simulator Mode'}`);
  console.log(`=======================================================`);
});

export default server;
