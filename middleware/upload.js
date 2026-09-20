import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Development storage driver.
 * Files land in server/uploads/<folder>, which is NOT statically served —
 * they are streamed back through an authorised controller only.
 * Production should swap this for the S3/Cloudinary driver in
 * services/storageService.js without changing any route.
 */
const ALLOWED = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const DOC_TYPES = ['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

function diskStorage(folder) {
  const dest = path.resolve(process.cwd(), env.uploadDir, folder);
  fs.mkdirSync(dest, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = ALLOWED[file.mimetype] || path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  });
}

function buildUploader(folder, accepted) {
  return multer({
    storage: diskStorage(folder),
    limits: { fileSize: env.maxUploadBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      if (!accepted.includes(file.mimetype)) {
        return cb(ApiError.badRequest(`Upload a ${accepted === DOC_TYPES ? 'PDF or Word' : 'PDF, Word, JPG, PNG or WebP'} file`));
      }
      return cb(null, true);
    },
  });
}

export const uploadResume = buildUploader('resumes', DOC_TYPES);
export const uploadDocument = buildUploader('documents', Object.keys(ALLOWED));
export const uploadImage = buildUploader('images', ['image/jpeg', 'image/png', 'image/webp']);

/**
 * ATS analysis reads the file once and does not need it to persist on disk —
 * so it is held in memory only, validated the same way, and discarded after
 * the response is sent (see controllers/resumeController.js).
 */
const RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx'];

export const uploadResumeMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!DOC_TYPES.includes(file.mimetype) || !RESUME_EXTENSIONS.includes(ext)) {
      return cb(ApiError.badRequest('Please upload a PDF, DOC, or DOCX file.'));
    }
    return cb(null, true);
  },
});
