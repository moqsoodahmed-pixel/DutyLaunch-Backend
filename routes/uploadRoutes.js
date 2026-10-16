import { Router } from 'express';
import * as uploads from '../controllers/uploadController.js';
import { protect } from '../middleware/auth.js';
import { uploadImage, uploadDocument } from '../middleware/upload.js';

const router = Router();

// Uploading files requires authenticated session
router.post('/image', protect, uploadImage.single('image'), uploads.uploadSingleImage);
router.post('/document', protect, uploadDocument.single('document'), uploads.uploadSingleDocument);

// Serving uploaded files safely
router.get('/files/:folder/:filename', uploads.serveUploadedFile);

export default router;
