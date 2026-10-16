import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

const ALLOWED_FOLDERS = ['images', 'documents', 'resumes'];

export const uploadSingleImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Please upload an image file');
  const filename = path.basename(req.file.filename);
  const url = `/api/uploads/files/images/${filename}`;
  sendSuccess(res, {
    message: 'Image uploaded successfully',
    data: { url, filename, originalname: req.file.originalname, size: req.file.size },
  });
});

export const uploadSingleDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Please upload a document file (PDF or Word)');
  const filename = path.basename(req.file.filename);
  const url = `/api/uploads/files/documents/${filename}`;
  sendSuccess(res, {
    message: 'Document uploaded successfully',
    data: { url, filename, originalname: req.file.originalname, size: req.file.size },
  });
});

/**
 * Secure file streamer — avoids path traversal and validates folder/file existence.
 */
export const serveUploadedFile = asyncHandler(async (req, res) => {
  const { folder, filename } = req.params;

  if (!ALLOWED_FOLDERS.includes(folder)) {
    throw ApiError.forbidden('Invalid resource location');
  }

  // Prevent path traversal
  const safeFilename = path.basename(filename);
  const filePath = path.resolve(process.cwd(), env.uploadDir, folder, safeFilename);

  if (!fs.existsSync(filePath)) {
    throw ApiError.notFound('Requested file does not exist');
  }

  // Set secure headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ext = path.extname(safeFilename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };

  if (mimeTypes[ext]) {
    res.setHeader('Content-Type', mimeTypes[ext]);
  }

  // For syllabi or images, allow browser inline preview with download fallback
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});
