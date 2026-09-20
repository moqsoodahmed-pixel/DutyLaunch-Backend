import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { BlogPost } from '../models/index.js';
import { listPublished, findOneOrFail } from '../services/contentService.js';

export const listPosts = asyncHandler(async (req, res) => {
  const filters = { status: 'published' };
  if (req.query.category) filters.category = req.query.category;
  if (req.query.tag) filters.tags = req.query.tag.toLowerCase();

  const { items, total, page, limit } = await listPublished(BlogPost, req.query, {
    searchFields: ['title', 'excerpt'],
    filters,
    sort: { publishedAt: -1 },
    populate: { path: 'author', select: 'name' },
    defaultLimit: 9,
  });

  sendSuccess(res, { message: 'Articles', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const getFeatured = asyncHandler(async (req, res) => {
  const [featured, categories] = await Promise.all([
    BlogPost.findOne({ status: 'published', isFeatured: true })
      .sort({ publishedAt: -1 })
      .populate('author', 'name')
      .lean(),
    BlogPost.distinct('category', { status: 'published' }),
  ]);
  sendSuccess(res, { message: 'Blog index', data: { featured, categories: categories.sort() } });
});

export const getPost = asyncHandler(async (req, res) => {
  const post = await findOneOrFail(
    BlogPost,
    { slug: req.params.slug, status: 'published' },
    { populate: { path: 'author', select: 'name' }, message: 'That article does not exist' }
  );

  await BlogPost.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } });

  const related = await BlogPost.find({
    _id: { $ne: post._id },
    status: 'published',
    category: post.category,
  })
    .sort({ publishedAt: -1 })
    .limit(3)
    .select('title slug excerpt category readingMinutes publishedAt featuredImage')
    .lean();

  sendSuccess(res, { message: 'Article', data: { post, related } });
});

/* ---------- admin ---------- */
export const createPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.create({ ...req.body, author: req.user._id });
  sendSuccess(res, { statusCode: 201, message: 'Article created', data: post });
});

export const updatePost = asyncHandler(async (req, res) => {
  const post = await findOneOrFail(BlogPost, { _id: req.params.id }, { message: 'Article not found' });
  Object.assign(post, req.body);
  await post.save();
  sendSuccess(res, { message: 'Article updated', data: post });
});

export const deletePost = asyncHandler(async (req, res) => {
  const post = await findOneOrFail(BlogPost, { _id: req.params.id }, { message: 'Article not found' });
  await post.deleteOne();
  sendSuccess(res, { message: 'Article deleted', data: { id: post._id } });
});

export const listAllPosts = asyncHandler(async (req, res) => {
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  const { items, total, page, limit } = await listPublished(BlogPost, req.query, {
    searchFields: ['title'],
    filters,
    sort: { updatedAt: -1 },
    populate: { path: 'author', select: 'name' },
    defaultLimit: 20,
  });
  sendSuccess(res, { message: 'All articles', data: items, meta: paginationMeta({ page, limit, total }) });
});
