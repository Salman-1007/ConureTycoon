import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { startMarketCronWorker } from './marketWorker.js';

const PORT = Number(process.env.PORT ?? 3001);
const db = createDatabase();
const app = createApp(db);
const cronHandle = startMarketCronWorker(db);

const server = app.listen(PORT, () => {
  console.log(`[GCCT Server] Listening on http://localhost:${PORT}`);
});

function shutdown() {
  clearInterval(cronHandle);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
