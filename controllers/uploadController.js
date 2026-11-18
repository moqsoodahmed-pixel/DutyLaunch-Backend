import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { UploadedFile } from '../models/UploadedFile.js';
import { logger } from '../utils/logger.js';

const ALLOWED_FOLDERS = ['images', 'documents', 'resumes'];

export const uploadSingleImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Please upload an image file');
  const filename = path.basename(req.file.filename);

  // Persist permanently in MongoDB Atlas so files survive container redeploys
  try {
    const fileBuffer = await fs.promises.readFile(req.file.path);
    await UploadedFile.findOneAndUpdate(
      { filename, folder: 'images' },
      {
        filename,
        folder: 'images',
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        data: fileBuffer,
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    logger.error(`[Upload] Failed to persist image in MongoDB Atlas: ${err.message}`);
  }

  const url = `/api/uploads/files/images/${filename}`;
  sendSuccess(res, {
    message: 'Image uploaded successfully',
    data: { url, filename, originalname: req.file.originalname, size: req.file.size },
  });
});

export const uploadSingleDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Please upload a document file (PDF or Word)');
  const filename = path.basename(req.file.filename);

  // Persist permanently in MongoDB Atlas so files survive container redeploys
  try {
    const fileBuffer = await fs.promises.readFile(req.file.path);
    await UploadedFile.findOneAndUpdate(
      { filename, folder: 'documents' },
      {
        filename,
        folder: 'documents',
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        data: fileBuffer,
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    logger.error(`[Upload] Failed to persist document in MongoDB Atlas: ${err.message}`);
  }

  const url = `/api/uploads/files/documents/${filename}`;
  sendSuccess(res, {
    message: 'Document uploaded successfully',
    data: { url, filename, originalname: req.file.originalname, size: req.file.size },
  });
});

/**
 * Secure file streamer — serves from local disk cache, or streams permanently from MongoDB Atlas
 */
export const serveUploadedFile = asyncHandler(async (req, res) => {
  const { folder, filename } = req.params;

  if (!ALLOWED_FOLDERS.includes(folder)) {
    throw ApiError.forbidden('Invalid resource location');
  }

  // Candidate resumes are personal data (DPDP Act 2023) — unlike the public
  // 'images'/'documents' folders, this one requires a signed-in session.
  // Filenames are random (crypto.randomBytes, see middleware/upload.js), so
  // this isn't full per-owner scoping, but it closes the previous gap where
  // anyone on the internet could fetch a resume with zero authentication.
  if (folder === 'resumes' && !req.user) {
    throw ApiError.unauthorized('Sign in to view this file');
  }

  // Prevent path traversal
  const safeFilename = path.basename(filename);
  const filePath = path.resolve(process.cwd(), env.uploadDir, folder, safeFilename);

  const ext = path.extname(safeFilename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
  };

  // Set secure headers. No wildcard CORS here — the app-level CORS
  // allowlist in app.js already governs cross-origin reads; a '*' override
  // on this route would let any site's JS read responses from it, which
  // matters more than usual since this also serves the 'resumes' folder.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);

  // 1. Check local disk first
  if (fs.existsSync(filePath)) {
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    const stream = fs.createReadStream(filePath);
    return stream.pipe(res);
  }

  // 2. If not on local disk (e.g. after container restart / redeploy on Railway), fetch from MongoDB Atlas
  const fileDoc = await UploadedFile.findOne({ folder, filename: safeFilename });
  if (!fileDoc || !fileDoc.data) {
    throw ApiError.notFound('Requested file does not exist');
  }

  // Cache to disk asynchronously for faster subsequent requests if directory exists
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.promises.writeFile(filePath, fileDoc.data).catch(() => {});
  } catch {
    /* ignore caching error */
  }

  res.setHeader('Content-Type', fileDoc.mimetype || mimeTypes[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', fileDoc.data.length);
  return res.end(fileDoc.data);
});
