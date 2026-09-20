import { Router } from 'express';
import * as course from '../controllers/courseController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { courseSchema } from '../validators/schemas.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

router.get('/', course.listCourses);
router.get('/categories', course.listCategories);
router.get('/admin/all', ...adminOnly, course.listAllCourses);
router.get('/:slug', course.getCourse);

router.post('/', ...adminOnly, validate(courseSchema), course.createCourse);
router.put('/:id', ...adminOnly, validate(courseSchema.partial()), course.updateCourse);
router.delete('/:id', ...adminOnly, course.deleteCourse);

export default router;
