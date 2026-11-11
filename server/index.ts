import { createApp, initializeAppData } from './app.js';
import { createDatabase } from './db.js';
import { startMarketCronWorker } from './marketWorker.js';

const PORT = Number(process.env.PORT ?? 3001);

async function startServer() {
  const db = await createDatabase();
  await initializeAppData(db);
  const app = createApp(db);
  const cronHandle = startMarketCronWorker(db);

  const server = app.listen(PORT, () => {
    console.log(`[GCCT Server] Listening on http://localhost:${PORT} (db: ${db.dialect})`);
  });

  function shutdown() {
    clearInterval(cronHandle);
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[GCCT Server] Fatal startup error:', err);
  process.exit(1);
});
