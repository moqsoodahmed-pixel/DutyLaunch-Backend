import app from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { logger } from './utils/logger.js';

const start = async () => {
  await connectDB();

  const server = app.listen(env.port, () => {
    logger.info(`DutyLaunch API listening on :${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    logger.warn(`${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    shutdown('unhandledRejection');
  });
};

start();
