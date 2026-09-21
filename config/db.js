import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);
// NOTE: `sanitizeFilter` is intentionally left off. It's meant to block
// `{ $gt: '' }`-style operator injection from user input, but in this
// Mongoose version it also breaks the app's own legitimate `$ne`/operator
// queries when used through Model.exists() (e.g. Job.js's slug-uniqueness
// check, and the "related items" lookups in blogController/jobController/
// courseController) — it throws a CastError trying to cast the whole
// `{ $ne: ... }` object instead of just its value. Operator-injection
// protection is already handled at the edge by middleware/sanitize.js,
// which strips any `$`-prefixed key out of req.body/params/query before
// it ever reaches a Mongoose query, so this isn't a net loss of safety.

let connection = null;

export async function connectDB() {
  if (connection) return connection;

  try {
    connection = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });
    logger.info(`MongoDB connected → ${connection.connection.host}/${connection.connection.name}`);
  } catch (error) {
    logger.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (err) => logger.error(`MongoDB error: ${err.message}`));

  return connection;
}

export async function disconnectDB() {
  if (!connection) return;
  await mongoose.connection.close(false);
  connection = null;
  logger.info('MongoDB connection closed');
}