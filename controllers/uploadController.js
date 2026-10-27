import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { UploadedFile } from '../models/UploadedFile.js';

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
    console.error('[Upload] Failed to persist image in MongoDB Atlas:', err);
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
    console.error('[Upload] Failed to persist document in MongoDB Atlas:', err);
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

  // Set secure headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
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
