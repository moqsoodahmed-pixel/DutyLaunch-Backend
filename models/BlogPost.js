import mongoose from 'mongoose';
import slugify from 'slugify';

export const BLOG_CATEGORIES = [
  'Career Advice',
  'Resume & LinkedIn',
  'Interviews',
  'Study Abroad',
  'UAE & Gulf Careers',
  'Upskilling',
  'Documentation',
];

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, unique: true, index: true },
    excerpt: { type: String, required: true, maxlength: 280 },
    content: { type: String, required: true },
    featuredImage: { type: String },
    imageAlt: { type: String, maxlength: 160 },
    category: { type: String, enum: BLOG_CATEGORIES, required: true, index: true },
    tags: [{ type: String, trim: true, lowercase: true }],
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    readingMinutes: { type: Number, default: 4 },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    isFeatured: { type: Boolean, default: false },
    viewCount: { type: Number, default: 0 },
    seo: {
      metaTitle: { type: String, maxlength: 70 },
      metaDescription: { type: String, maxlength: 170 },
    },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

blogSchema.index({ title: 'text', excerpt: 'text', tags: 'text' });
blogSchema.index({ status: 1, publishedAt: -1 });

blogSchema.pre('validate', function prepare(next) {
  if (this.isModified('title') || !this.slug) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  if (this.isModified('content')) {
    const words = this.content.split(/\s+/).filter(Boolean).length;
    this.readingMinutes = Math.max(1, Math.round(words / 220));
  }
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

export const BlogPost = mongoose.model('BlogPost', blogSchema);
