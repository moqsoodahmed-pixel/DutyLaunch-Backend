import { z } from 'zod';
import { CONSULTATION_SERVICES, EXPERIENCE_BANDS } from '../models/Consultation.js';
import { JOB_TYPES, JOB_STATUS, WORK_MODES } from '../models/Job.js';
import { APPLICATION_STATUS } from '../models/JobApplication.js';
import { BLOG_CATEGORIES } from '../models/BlogPost.js';
import { FAQ_CATEGORIES } from '../models/FAQ.js';

const name = z.string().trim().min(2, 'Enter at least 2 characters').max(80);
const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const phone = z
  .string()
  .trim()
  .min(7, 'Enter a valid phone number')
  .max(20)
  .regex(/^[+\d][\d\s()-]{6,19}$/, 'Enter a valid phone number');
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72)
  .regex(/[a-zA-Z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/* ---------- auth ---------- */
export const registerSchema = z.object({
  name,
  email,
  phone: phone.optional(),
  password,
  role: z.enum(['user', 'employer']).optional(),
  company: z
    .object({
      name: z.string().trim().min(2).max(120),
      website: z.string().trim().url('Enter a valid URL').optional().or(z.literal('')),
      industry: z.string().trim().max(80).optional(),
      size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
    })
    .optional(),
});

export const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password') });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

export const forgotPasswordSchema = z.object({ email });

export const updateProfileSchema = z.object({
  name: name.optional(),
  phone: phone.optional().or(z.literal('')),
  profile: z
    .object({
      headline: z.string().trim().max(120).optional().or(z.literal('')),
      location: z.string().trim().max(120).optional().or(z.literal('')),
      experienceYears: z.coerce.number().min(0).max(60).optional(),
      currentRole: z.string().trim().max(120).optional().or(z.literal('')),
      skills: z.array(z.string().trim().max(40)).max(30).optional(),
      linkedinUrl: z.string().trim().url('Enter a valid URL').optional().or(z.literal('')),
    })
    .optional(),
  company: z
    .object({
      name: z.string().trim().max(120).optional(),
      website: z.string().trim().url('Enter a valid URL').optional().or(z.literal('')),
      industry: z.string().trim().max(80).optional(),
      size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
      about: z.string().trim().max(1200).optional().or(z.literal('')),
    })
    .optional(),
});

/* ---------- forms ---------- */
export const consultationSchema = z.object({
  name,
  email,
  phone,
  service: z.enum(CONSULTATION_SERVICES),
  experience: z.enum(EXPERIENCE_BANDS),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  preferredSlot: z.string().trim().max(80).optional().or(z.literal('')),
});

export const contactSchema = z.object({
  name,
  email,
  phone: phone.optional().or(z.literal('')),
  subject: z.string().trim().min(3, 'Add a short subject').max(140),
  message: z.string().trim().min(10, 'Tell us a little more').max(2000),
});

/* ---------- jobs ---------- */
export const jobSchema = z.object({
  title: z.string().trim().min(3).max(140),
  company: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  country: z.string().trim().max(60).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
  category: z.string().trim().min(2).max(60),
  experience: z.object({ min: z.coerce.number().min(0).max(60), max: z.coerce.number().min(0).max(60) }).optional(),
  salary: z
    .object({
      min: z.coerce.number().min(0).optional(),
      max: z.coerce.number().min(0).optional(),
      currency: z.enum(['INR', 'AED', 'USD', 'GBP', 'EUR']).optional(),
      period: z.enum(['month', 'year']).optional(),
      disclosed: z.boolean().optional(),
    })
    .optional(),
  description: z.string().trim().min(40, 'Describe the role in a little more detail'),
  responsibilities: z.array(z.string().trim().max(300)).max(20).optional(),
  requirements: z.array(z.string().trim().max(300)).max(20).optional(),
  skills: z.array(z.string().trim().max(40)).max(25).optional(),
  applyUrl: z.string().trim().url().optional().or(z.literal('')),
  status: z.enum(JOB_STATUS).optional(),
  isFeatured: z.boolean().optional(),
  expiresAt: z.coerce.date().optional(),
});

export const applicationSchema = z.object({
  coverLetter: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const applicationStatusSchema = z.object({
  status: z.enum(APPLICATION_STATUS),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

/* ---------- content ---------- */
export const blogSchema = z.object({
  title: z.string().trim().min(5).max(160),
  excerpt: z.string().trim().min(20).max(280),
  content: z.string().trim().min(100, 'An article needs at least a few paragraphs'),
  featuredImage: z.string().trim().optional().or(z.literal('')),
  imageAlt: z.string().trim().max(160).optional().or(z.literal('')),
  category: z.enum(BLOG_CATEGORIES),
  tags: z.array(z.string().trim().max(30)).max(12).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  isFeatured: z.boolean().optional(),
  seo: z
    .object({
      metaTitle: z.string().trim().max(70).optional().or(z.literal('')),
      metaDescription: z.string().trim().max(170).optional().or(z.literal('')),
    })
    .optional(),
});

export const faqSchema = z.object({
  question: z.string().trim().min(8).max(220),
  answer: z.string().trim().min(10).max(2000),
  category: z.enum(FAQ_CATEGORIES).optional(),
  order: z.coerce.number().optional(),
  isPublished: z.boolean().optional(),
});

export const courseSchema = z.object({
  title: z.string().trim().min(4).max(140),
  summary: z.string().trim().min(20).max(280),
  description: z.string().trim().min(60),
  category: objectId.optional(),
  track: z.enum(['professional', 'upskill', 'certification']).optional(),
  outcomes: z.array(z.string().trim().max(200)).max(15).optional(),
  modules: z.array(z.object({ title: z.string().trim().max(140), detail: z.string().trim().max(400).optional() })).max(30).optional(),
  price: z.coerce.number().min(0).optional(),
  priceOnRequest: z.boolean().optional(),
  duration: z.string().trim().max(60).optional(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  mode: z.enum(['Online', 'Live online', 'Blended']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

export const testimonialSchema = z.object({
  name,
  role: z.string().trim().max(120).optional().or(z.literal('')),
  location: z.string().trim().max(80).optional().or(z.literal('')),
  service: z.string().trim().max(80).optional().or(z.literal('')),
  quote: z.string().trim().min(20).max(600),
  rating: z.coerce.number().min(1).max(5).optional(),
  consentOnFile: z.boolean().optional(),
  isPublished: z.boolean().optional(),
});

export const adminUserUpdateSchema = z.object({
  role: z.enum(['user', 'employer', 'admin']).optional(),
  isActive: z.boolean().optional(),
});

export const statusUpdateSchema = z.object({
  status: z.string().trim().min(2).max(40),
  internalNote: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const idParamSchema = z.object({ id: objectId });
