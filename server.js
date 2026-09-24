import app from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { logger } from './utils/logger.js';

const start = async () => {
  await connectDB();

<<<<<<< HEAD
  const server = app.listen(env.port, 'localhost', () => {
    logger.info(`DutyLaunch API listening on http://localhost:${env.port} (${env.nodeEnv})`);
=======
  // Bind to 0.0.0.0, NOT localhost. On Railway (and any container host) the
  // platform's proxy connects to the app from outside the container; a server
  // listening on localhost/127.0.0.1 only accepts connections from inside it,
  // so every request fails at the edge with an instant 502.
  const host = process.env.HOST && process.env.HOST !== 'localhost' ? process.env.HOST : '0.0.0.0';
  const server = app.listen(env.port, host, () => {
    logger.info(`DutyLaunch API listening on ${host}:${env.port} (${env.nodeEnv})`);
>>>>>>> 2235a2b (updated the server)
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