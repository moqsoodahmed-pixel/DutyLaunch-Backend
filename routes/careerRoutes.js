import { Router } from 'express';
import * as career from '../controllers/careerController.js';
import { optionalAuth, protect } from '../middleware/auth.js';
import { uploadCvMemory } from '../middleware/upload.js';
import { resumeLimiter, aiLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import {
  careerParseSchema,
  careerAnalyzeSchema,
  careerJobAnalyzeSchema,
  careerProfileUpdateSchema,
  careerEvidenceQuestionsSchema,
  careerEvidenceAnswerSchema,
  careerOptimizeSchema,
  careerApplyOptimizationSchema,
  careerVersionCreateSchema,
  careerVersionUpdateSchema,
  careerRenderSchema,
  careerExportSchema,
  careerCoverLetterSchema,
  careerToolSchema,
} from '../validators/schemas.js';

/**
 * DutyLaunch Career Intelligence API (spec §41).
 *
 * Two access levels, deliberately:
 *
 *  - `optionalAuth` on the analysis surface, so a visitor can upload a CV
 *    and get a full Resume Health report without creating an account.
 *    Nothing is persisted for an anonymous caller; they must send their
 *    resume JSON inline on each request.
 *  - `protect` on anything that reads or writes the Master Career
 *    Profile, which is personal data.
 *
 * Generation endpoints sit behind the AI limiter, parsing and analysis
 * behind the resume limiter.
 */

const router = Router();

/* Single-use link MagicalAPI uses to fetch an uploaded PDF (expires in 5 min). */
router.get('/magical-file/:token', career.serveTempResume);

/* ---------- upload and parse (§4, §5) ---------- */
router.post(
  '/resume/parse',
  resumeLimiter,
  optionalAuth,
  uploadCvMemory.single('resume'),
  validate(careerParseSchema),
  career.parseUpload
);

/* ---------- analysis (§6–§8, §15, §18) ---------- */
router.post('/analyze', resumeLimiter, optionalAuth, validate(careerAnalyzeSchema), career.analyze);
router.post('/job/analyze', resumeLimiter, optionalAuth, validate(careerJobAnalyzeSchema), career.analyzeJob);

/* ---------- master career profile (§3, §43) ---------- */
router.get('/profile', protect, career.getProfile);
router.put('/profile', protect, validate(careerProfileUpdateSchema), career.updateProfile);
router.delete('/profile', protect, career.deleteProfile);

/* ---------- evidence and achievements (§13, §14) ---------- */
router.post(
  '/evidence/questions',
  resumeLimiter,
  optionalAuth,
  validate(careerEvidenceQuestionsSchema),
  career.getEvidenceQuestions
);
router.post(
  '/evidence/answer',
  resumeLimiter,
  optionalAuth,
  validate(careerEvidenceAnswerSchema),
  career.submitEvidenceAnswer
);

/* ---------- optimisation (§15, §28–§30) ---------- */
router.post('/optimize', aiLimiter, optionalAuth, validate(careerOptimizeSchema), career.optimize);
router.post(
  '/optimize/apply',
  resumeLimiter,
  optionalAuth,
  validate(careerApplyOptimizationSchema),
  career.applyOptimization
);

/* ---------- version history (§17, §42) ---------- */
router.post('/versions', protect, validate(careerVersionCreateSchema), career.createVersion);
router.get('/versions', protect, career.listVersions);
router.get('/versions/:versionId', protect, career.getVersion);
router.put('/versions/:versionId', protect, validate(careerVersionUpdateSchema), career.updateVersion);
router.delete('/versions/:versionId', protect, career.deleteVersion);
router.post('/versions/:versionId/restore', protect, career.restoreVersion);

/* ---------- validation, templates, export (§20, §27, §33) ---------- */
router.post('/validate', resumeLimiter, optionalAuth, validate(careerAnalyzeSchema), career.validate);
router.get('/templates', career.getTemplates);
router.post('/render', resumeLimiter, optionalAuth, validate(careerRenderSchema), career.render);
router.post('/export', resumeLimiter, optionalAuth, validate(careerExportSchema), career.exportResume);

/* ---------- career tools (§24–§26) ---------- */
router.post('/linkedin', aiLimiter, optionalAuth, validate(careerToolSchema), career.linkedin);
router.post('/cover-letter', aiLimiter, optionalAuth, validate(careerCoverLetterSchema), career.coverLetter);
router.post('/interview', aiLimiter, optionalAuth, validate(careerToolSchema), career.interview);

export default router;