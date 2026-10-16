import { Router } from 'express';
import * as course from '../controllers/courseController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { requireVerifiedPartner } from '../middleware/partnerVerification.js';
import { validate } from '../middleware/validate.js';
import { courseSchema } from '../validators/schemas.js';

const router = Router();
const partnerOrAdmin = [protect, restrictTo('admin', 'institute', 'partner')];
const adminOnly = [protect, restrictTo('admin')];

// Public
router.get('/', course.listCourses);
router.get('/categories', course.listCategories);
router.get('/admin/all', ...adminOnly, course.listAllCourses);

// Partner routes (EdTech management)
router.get('/mine', protect, restrictTo('institute', 'partner'), course.listMine);

router.post(
  '/',
  ...partnerOrAdmin,
  requireVerifiedPartner,
  validate(courseSchema),
  course.createCourse
);

router.put(
  '/:id',
  ...partnerOrAdmin,
  requireVerifiedPartner,
  validate(courseSchema.partial()),
  course.updateCourse
);

router.delete(
  '/:id',
  ...partnerOrAdmin,
  requireVerifiedPartner,
  course.deleteCourse
);

router.get('/:slug', course.getCourse);

export default router;
