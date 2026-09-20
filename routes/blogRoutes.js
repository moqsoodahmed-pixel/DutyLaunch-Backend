import { Router } from 'express';
import * as blog from '../controllers/blogController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { blogSchema } from '../validators/schemas.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

router.get('/', blog.listPosts);
router.get('/index', blog.getFeatured);
router.get('/admin/all', ...adminOnly, blog.listAllPosts);
router.get('/:slug', blog.getPost);

router.post('/', ...adminOnly, validate(blogSchema), blog.createPost);
router.put('/:id', ...adminOnly, validate(blogSchema.partial()), blog.updatePost);
router.delete('/:id', ...adminOnly, blog.deletePost);

export default router;
