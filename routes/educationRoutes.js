import { Router } from 'express';
import * as education from '../controllers/educationController.js';
import { protect, restrictTo } from '../middleware/auth.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

router.get('/programs', education.listPrograms);
router.get('/filters', education.getProgramFilters);
router.get('/programs/:slug', education.getProgram);

router.post('/programs', ...adminOnly, education.createProgram);
router.put('/programs/:id', ...adminOnly, education.updateProgram);
router.delete('/programs/:id', ...adminOnly, education.deleteProgram);

export default router;
