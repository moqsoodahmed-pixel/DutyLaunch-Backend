import { Router } from 'express';
import * as uploads from '../controllers/uploadController.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { uploadImage, uploadDocument } from '../middleware/upload.js';

const router = Router();

// Uploading files requires authenticated session
router.post('/image', protect, uploadImage.single('image'), uploads.uploadSingleImage);
router.post('/document', protect, uploadDocument.single('document'), uploads.uploadSingleDocument);

// Serving uploaded files safely. 'images'/'documents' are intentionally
// public (avatars, logos, public collateral); 'resumes' holds candidate PII,
// so the controller requires a signed-in session for that folder —
// optionalAuth attaches req.user when present without blocking the public
// folders.
router.get('/files/:folder/:filename', optionalAuth, uploads.serveUploadedFile);

export default router;
