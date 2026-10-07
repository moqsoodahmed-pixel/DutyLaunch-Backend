import { Router } from 'express';
import { z } from 'zod';
import * as studio from '../controllers/studioController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { uploadProfileFilesMemory } from '../middleware/upload.js';
import { resumeLimiter, aiLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import { consentField } from '../utils/consent.js';
import { COVER_LETTER_TONES, INTERVIEW_TYPES, INTERVIEW_DIFFICULTIES } from '../models/index.js';

/**
 * AI Career Studio. Candidates only: every route requires a signed-in
 * 'user' account, and every record is looked up by its owner.
 */
const router = Router();
router.use(protect, restrictTo('user'));

const s = (max) => z.string().trim().max(max);
const opt = (max) => s(max).optional();
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id').optional();
const JD = z.string().max(20000).optional();

const importSchema = z.object({
  consent: consentField,
  mode: z.enum(['replace', 'merge']).optional(),
  linkedinUrl: opt(300),
});
const linkedinUrlSchema = z.object({ url: s(300) });
const resumeBody = z.object({ resume: z.record(z.any()).optional(), mode: z.enum(['replace']).optional() });
const manualSchema = z.object({ consent: consentField, resume: z.record(z.any()), mode: z.enum(['replace']).optional() });
const jobDescriptionSchema = z.object({ jobTitle: opt(160), company: opt(160), industry: opt(120), experienceLevel: opt(40) });
const coverLetterSchema = z.object({
  versionId: objectId, jobTitle: opt(160), company: opt(160), jobDescription: z.string().min(40, 'Paste the full job description').max(20000),
  tone: z.enum(COVER_LETTER_TONES).optional(),
});
const coverLetterUpdate = z.object({ title: opt(160), content: z.string().max(12000).optional(), company: opt(160), jobTitle: opt(160) });
const paragraphSchema = z.object({ tone: z.enum(COVER_LETTER_TONES).optional() });
const setSchema = z.object({ versionId: objectId, jobTitle: opt(160), company: opt(160), jobDescription: JD, experienceLevel: opt(40) });
const setUpdate = z.object({
  title: opt(160),
  questions: z.array(z.object({ number: z.number().int().min(1).max(10), question: z.string().max(1200).optional(), sampleAnswer: z.string().max(5000).optional(), followUp: z.string().max(600).optional(), keyPoints: z.array(s(400)).max(8).optional() })).max(10).optional(),
});
const mockSchema = z.object({
  sourceSetId: objectId, versionId: objectId, jobTitle: opt(160), company: opt(160), jobDescription: JD,
  interviewType: z.enum(INTERVIEW_TYPES).optional(), difficulty: z.enum(INTERVIEW_DIFFICULTIES).optional(),
  questionCount: z.number().int().min(1).max(15).optional(), durationMinutes: z.number().int().min(5).max(120).optional(),
});
const answerSchema = z.object({ answer: z.string().trim().min(2, 'Enter your answer').max(8000), mode: z.enum(['text', 'voice']).optional() });

/* Progress and documents */
router.get('/', studio.getStudio);

/* Step 1–2: import, review, confirm */
router.post('/import', resumeLimiter, uploadProfileFilesMemory, validate(importSchema), studio.importProfile);
router.put('/linkedin-url', validate(linkedinUrlSchema), studio.setLinkedInUrl);
router.post('/manual', validate(manualSchema), studio.manualProfile);
router.post('/confirm', validate(resumeBody), studio.confirmProfile);

/* Step 3–4: downloads */
router.get('/profile-document', resumeLimiter, studio.downloadProfileDocument);
router.get('/versions/:versionId/document', resumeLimiter, studio.downloadResumeDocument);

/* Step 6: cover letters */
// Step 4 — AI-written target job description from the confirmed profile
router.post('/job-description', aiLimiter, validate(jobDescriptionSchema), studio.suggestJobDescription);

router.post('/cover-letters', aiLimiter, validate(coverLetterSchema), studio.createCoverLetter);
router.get('/cover-letters', studio.listCoverLetters);
router.get('/cover-letters/:id', studio.getCoverLetter);
router.put('/cover-letters/:id', validate(coverLetterUpdate), studio.updateCoverLetter);
router.delete('/cover-letters/:id', studio.deleteCoverLetter);
router.post('/cover-letters/:id/duplicate', studio.duplicateCoverLetter);
router.post('/cover-letters/:id/paragraphs/:index', aiLimiter, validate(paragraphSchema), studio.regenerateParagraph);
router.get('/cover-letters/:id/document', resumeLimiter, studio.downloadCoverLetter);

/* Step 7: top-10 interview Q&A */
router.post('/interview-sets', aiLimiter, validate(setSchema), studio.createInterviewSet);
router.get('/interview-sets', studio.listInterviewSets);
router.get('/interview-sets/:id', studio.getInterviewSet);
router.put('/interview-sets/:id', validate(setUpdate), studio.updateInterviewSet);
router.delete('/interview-sets/:id', studio.deleteInterviewSet);
router.post('/interview-sets/:id/questions/:number/regenerate', aiLimiter, studio.regenerateInterviewQuestion);
router.get('/interview-sets/:id/document', resumeLimiter, studio.downloadInterviewSet);

/* Phase 2: mock interview */
router.post('/mock', aiLimiter, validate(mockSchema), studio.startMock);
router.get('/mock', studio.listMocks);
router.get('/mock/:id', studio.getMockSession);
router.post('/mock/:id/answer', aiLimiter, validate(answerSchema), studio.answerMock);
router.post('/mock/:id/finish', aiLimiter, studio.finishMock);
router.delete('/mock/:id', studio.deleteMock);
router.get('/mock/:id/document', resumeLimiter, studio.downloadMockReport);

export default router;