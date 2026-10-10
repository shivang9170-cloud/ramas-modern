import { assertConfig, config } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

async function main() {
  assertConfig();
  await initDb();
  const app = createApp();
  const server = app.listen(config.port, () => logger.info(`Ramas API listening on http://localhost:${config.port}`));

  const shutdown = async () => {
    logger.info('Shutting down');
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Failed to start', { err: err.message });
  process.exit(1);
});
