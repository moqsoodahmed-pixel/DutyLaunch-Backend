import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Storage abstraction.
 *
 * Development  → local disk under server/uploads (NOT statically served).
 * Production   → implement the same three functions against S3 or Cloudinary
 *                and switch `driver` below. Nothing else in the codebase
 *                needs to change, because controllers only ever hold a `key`.
 */
const localDriver = {
  /** Turns a multer file into an opaque storage key. */
  keyFromUpload(file, folder) {
    return path.posix.join(folder, path.basename(file.path));
  },

  async stream(key) {
    const absolute = path.resolve(process.cwd(), env.uploadDir, key);
    const root = path.resolve(process.cwd(), env.uploadDir);
    if (!absolute.startsWith(root)) throw ApiError.forbidden('Invalid file path');
    try {
      await fs.access(absolute);
    } catch {
      throw ApiError.notFound('That file is no longer available');
    }
    return createReadStream(absolute);
  },

  async remove(key) {
    if (!key) return;
    const absolute = path.resolve(process.cwd(), env.uploadDir, key);
    await fs.rm(absolute, { force: true });
  },
};

export const storage = localDriver;
