import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import jobRoutes from './jobRoutes.js';
import employerRoutes from './employerRoutes.js';
import blogRoutes from './blogRoutes.js';
import faqRoutes from './faqRoutes.js';
import courseRoutes from './courseRoutes.js';
import educationRoutes from './educationRoutes.js';
import documentationRoutes from './documentationRoutes.js';
import pricingRoutes from './pricingRoutes.js';
import testimonialRoutes from './testimonialRoutes.js';
import adminRoutes from './adminRoutes.js';
import { consultationRouter, contactRouter } from './enquiryRoutes.js';
import resumeRoutes from './resumeRoutes.js';

const router = Router();

router.get('/health', (req, res) =>
  res.json({ success: true, message: 'DutyLaunch API is running', data: { uptime: process.uptime() } })
);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/jobs', jobRoutes);
router.use('/employers', employerRoutes);
router.use('/blogs', blogRoutes);
router.use('/faqs', faqRoutes);
router.use('/courses', courseRoutes);
router.use('/education', educationRoutes);
router.use('/documentation', documentationRoutes);
router.use('/pricing', pricingRoutes);
router.use('/testimonials', testimonialRoutes);
router.use('/consultations', consultationRouter);
router.use('/contact', contactRouter);
router.use('/admin', adminRoutes);
router.use('/resume', resumeRoutes);

export default router;
