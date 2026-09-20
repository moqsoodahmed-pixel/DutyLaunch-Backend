import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true); // blocks `{ $gt: '' }`-style operator injection

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
