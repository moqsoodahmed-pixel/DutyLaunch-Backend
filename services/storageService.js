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
import { Readable } from 'node:stream';
import { UploadedFile } from '../models/UploadedFile.js';

const localDriver = {
  /** Turns a multer file into an opaque storage key and persists to MongoDB Atlas. */
  keyFromUpload(file, folder) {
    const filename = path.basename(file.path);
    const key = path.posix.join(folder, filename);

    // Persist asynchronously in MongoDB Atlas
    (async () => {
      try {
        const fileBuffer = await fs.readFile(file.path);
        await UploadedFile.findOneAndUpdate(
          { filename, folder },
          {
            filename,
            folder,
            originalname: file.originalname,
            mimetype: file.mimetype || 'application/pdf',
            size: file.size,
            data: fileBuffer,
          },
          { upsert: true, new: true }
        );
      } catch (err) {
        console.error('[Storage] Failed to persist file in MongoDB Atlas:', err);
      }
    })();

    return key;
  },

  async stream(key) {
    const absolute = path.resolve(process.cwd(), env.uploadDir, key);
    const root = path.resolve(process.cwd(), env.uploadDir);
    if (!absolute.startsWith(root)) throw ApiError.forbidden('Invalid file path');

    // 1. Check local disk
    try {
      await fs.access(absolute);
      return createReadStream(absolute);
    } catch {
      // 2. Fall back to MongoDB Atlas
      const parts = key.split('/');
      const folder = parts[0];
      const filename = parts.slice(1).join('/');
      const doc = await UploadedFile.findOne({ folder, filename });
      if (doc && doc.data) {
        return Readable.from(doc.data);
      }
      throw ApiError.notFound('That file is no longer available');
    }
  },

  async remove(key) {
    if (!key) return;
    const absolute = path.resolve(process.cwd(), env.uploadDir, key);
    await fs.rm(absolute, { force: true }).catch(() => {});
    const parts = key.split('/');
    const folder = parts[0];
    const filename = parts.slice(1).join('/');
    await UploadedFile.deleteOne({ folder, filename }).catch(() => {});
  },
};

export const storage = localDriver;
