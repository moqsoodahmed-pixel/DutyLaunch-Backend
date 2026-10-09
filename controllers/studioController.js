/**
 * AI Career Studio — Phase 1 (profile → documents) and Phase 2 (mock
 * interview), built on the existing Career Intelligence engine.
 *
 * Reuse, not duplication:
 *   - one profile: CareerProfile.master is the verified source for everything;
 *   - resume generation and "Improve my resume" are the existing
 *     /career/versions and /career/optimize endpoints — the Studio UI calls
 *     them directly, and this controller only adds downloads;
 *   - every score shown comes from the deterministic analyzeCandidate();
 *     no model ever assigns a Resume Health or Job Match score.
 *
 * Ownership: every query filters on req.user._id. A record id that is
 * malformed or belongs to someone else is a 404, never a 403, so ids
 * cannot be probed.
 */

import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { consentRecord } from '../utils/consent.js';
import { logger } from '../utils/logger.js';
import { CareerProfile, ScoringConfig, CoverLetter, InterviewSession, COVER_LETTER_TONES } from '../models/index.js';
import { parseResumeText, parseResumeJson, analyzeCandidate, generateCoverLetter } from '../services/careerIntelligence/index.js';
import { extractText } from '../services/careerIntelligence/resumeParser.js';
import { looksLikeLinkedInExport, parseLinkedInText, mergeResumes, normaliseLinkedInUrl } from '../services/careerIntelligence/linkedinImport.js';
import { generateTop10, regenerateQuestion, planMockQuestions, evaluateAnswer, buildMockReport, parseModelJson, generateJobDescription, generateBuilderSuggestions } from '../services/careerIntelligence/studioAi.js';
import { callModel, aiConfigured, aiStatus } from '../services/careerIntelligence/aiClient.js';
import { buildPrompt, buildRewriteContext } from '../services/careerIntelligence/rewriter.js';
import { sendDocument, safeFilename } from '../services/documents/documentRenderer.js';
import { profileDocument, resumeDocument, coverLetterDocument, interviewDocument, mockReportDocument } from '../services/documents/careerDocuments.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function configOverride() {
  try {
    return await ScoringConfig.activeOverride();
  } catch {
    return null;
  }
}

async function getDoc(userId, { create = false } = {}) {
  let doc = await CareerProfile.findOne({ user: userId });
  if (!doc && create) {
    doc = await CareerProfile.create({ user: userId });
    doc.touchRetention();
  }
  return doc;
}

async function requireMaster(userId) {
  const doc = await getDoc(userId);
  if (!doc?.master) throw ApiError.badRequest('Import your LinkedIn PDF or upload your CV first — the Studio works from your confirmed profile.');
  return doc;
}

function findVersion(doc, versionId) {
  if (!versionId) return null;
  if (!mongoose.isValidObjectId(versionId)) throw ApiError.notFound('Resume version not found.');
  const v = doc.versions.id(versionId);
  if (!v) throw ApiError.notFound('Resume version not found.');
  return v;
}

async function ownDoc(Model, id, userId, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found.`);
  const item = await Model.findOne({ _id: id, user: userId });
  if (!item) throw ApiError.notFound(`${label} not found.`);
  return item;
}

/** Resume (a version or the master) plus a fresh deterministic analysis. */
async function context(userId, { versionId, jobDescription, jobTitle, company, country } = {}) {
  const doc = await requireMaster(userId);
  const version = findVersion(doc, versionId);
  const resume = parseResumeJson(version ? version.resume : doc.master);
  const jd = jobDescription || version?.target?.jobDescription || '';
  const analysis = analyzeCandidate(resume, {
    jobDescription: jd || undefined,
    jobHints: { jobTitle: jobTitle || version?.target?.jobTitle, company: company || version?.target?.company, country },
    confirmedFacts: doc.confirmedFacts || [],
    configOverride: await configOverride(),
  });
  // The deterministic job analysis leaves jobTitle empty when the posting
  // does not state one; the candidate's own target fills it.
  if (analysis.jobIntel?.role && !analysis.jobIntel.role.jobTitle && jobTitle) analysis.jobIntel.role.jobTitle = jobTitle;
  if (analysis.jobIntel?.role && !analysis.jobIntel.role.company && company) analysis.jobIntel.role.company = company;
  return { doc, version, resume, analysis, jobDescription: jd };
}

const genOpts = (ctx, extra = {}) => ({
  profile: ctx.analysis.profile,
  jobIntel: ctx.analysis.jobIntel,
  keywordResult: ctx.analysis.keywords,
  confirmedFacts: ctx.doc.confirmedFacts || [],
  jobDescription: ctx.jobDescription,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Progress — computed from saved data, never stored as a guess
 * ------------------------------------------------------------------ */

function stepState(done, { started = false, attention = false } = {}) {
  if (attention) return 'attention';
  if (done) return 'completed';
  return started ? 'in-progress' : 'not-started';
}

export const getStudio = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const [doc, letters, sets, mocks] = await Promise.all([
    getDoc(userId),
    CoverLetter.find({ user: userId }).sort({ updatedAt: -1 }).select('title company jobTitle tone engine versionId updatedAt createdAt downloadCount').lean(),
    InterviewSession.find({ user: userId, kind: 'top10' }).sort({ updatedAt: -1 }).select('title jobTitle company engine versionId updatedAt createdAt downloadCount questions.number').lean(),
    InterviewSession.find({ user: userId, kind: 'mock' }).sort({ updatedAt: -1 }).select('title jobTitle interviewType difficulty status questionCount currentIndex report.overallScore completedAt updatedAt createdAt sourceSetId').lean(),
  ]);

  const studio = doc?.studio || {};
  const master = doc?.master ? parseResumeJson(doc.master) : null;
  const needsReview = master?._needsReview || [];
  const versions = (doc?.versions || []).filter((v) => v.kind !== 'original');
  const analysed = versions.filter((v) => typeof v.health?.score === 'number');
  const anyDownload = Boolean(studio.documentsDownloadedAt) || versions.some((v) => v.exportCount) || letters.some((l) => l.downloadCount) || sets.some((s) => s.downloadCount);

  const steps = [
    { id: 'import', label: 'Import LinkedIn profile', state: stepState(Boolean(master)), detail: studio.importStatus || null },
    { id: 'review', label: 'Review and confirm profile', state: stepState(Boolean(studio.profileConfirmedAt), { started: Boolean(master), attention: Boolean(master) && !studio.profileConfirmedAt && needsReview.length > 0 }), detail: needsReview.length ? `${needsReview.length} field(s) to check` : null },
    { id: 'profile-pdf', label: 'Download LinkedIn profile PDF', state: stepState(Boolean(studio.profilePdfDownloadedAt), { started: Boolean(studio.profileConfirmedAt) }) },
    { id: 'resume', label: 'Generate professional resume', state: stepState(versions.length > 0, { started: Boolean(studio.profileConfirmedAt) }) },
    { id: 'ats', label: 'Check Resume Health and Job Match', state: stepState(analysed.some((v) => v.target?.jobDescription) || analysed.length > 0, { started: versions.length > 0 }) },
    { id: 'cover-letter', label: 'Generate cover letter', state: stepState(letters.length > 0, { started: versions.length > 0 }) },
    { id: 'interview', label: 'Generate top 10 interview Q&A', state: stepState(sets.length > 0, { started: letters.length > 0 }) },
    { id: 'documents', label: 'Save or download career documents', state: stepState(anyDownload, { started: sets.length > 0 || letters.length > 0 }) },
  ];

  const latest = versions.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];

  sendSuccess(res, {
    message: 'AI Career Studio',
    data: {
      steps,
      completed: steps.filter((s) => s.state === 'completed').length,
      phase1Complete: steps.every((s) => s.state === 'completed'),
      profile: master
        ? {
            name: master.personal?.name || '',
            headline: master.personal?.headline || '',
            needsReview,
            importSource: studio.importSource || '',
            importStatus: studio.importStatus || '',
            importedAt: studio.importedAt || null,
            importAdded: studio.importAdded || [],
            linkedinUrl: studio.linkedinUrl || '',
            confirmedAt: studio.profileConfirmedAt || null,
            profilePdfDownloadedAt: studio.profilePdfDownloadedAt || null,
          }
        : null,
      latestResume: latest
        ? { id: latest._id, label: latest.label, health: latest.health?.score ?? null, match: latest.match?.overall ?? null, updatedAt: latest.updatedAt }
        : null,
      documents: {
        resumes: versions.map((v) => ({ id: v._id, label: v.label, templateId: v.templateId, target: { jobTitle: v.target?.jobTitle, company: v.target?.company }, health: v.health?.score ?? null, match: v.match?.overall ?? null, updatedAt: v.updatedAt, exportCount: v.exportCount || 0 })),
        coverLetters: letters.map((l) => ({ id: l._id, ...l, _id: undefined })),
        interviewSets: sets.map((s) => ({ id: s._id, title: s.title, jobTitle: s.jobTitle, company: s.company, engine: s.engine, questionCount: s.questions?.length || 0, updatedAt: s.updatedAt, downloadCount: s.downloadCount || 0 })),
        mockInterviews: mocks.map((m) => ({ id: m._id, title: m.title, jobTitle: m.jobTitle, interviewType: m.interviewType, difficulty: m.difficulty, status: m.status, questionCount: m.questionCount, answered: m.currentIndex, score: m.report?.overallScore ?? null, completedAt: m.completedAt, updatedAt: m.updatedAt })),
      },
      ai: { ...aiStatus(), configured: aiConfigured() },
      linkedinApi: {
        available: false,
        note: 'Direct LinkedIn import needs LinkedIn API partner approval, which DutyLaunch does not have yet. Download your profile from LinkedIn (More → Save to PDF) and upload it here instead.',
      },
    },
  });
});

/* ------------------------------------------------------------------ *
 * Step 1 — import
 * ------------------------------------------------------------------ */

/** POST /api/studio/import — LinkedIn PDF or CV (multipart "resume"). */
/** Reads one uploaded file into a resume. `slot` names it in error messages. */
async function readProfileFile(file, slot, { linkedinUrl }) {
  const { text, wasScanned, lossy } = await extractText(file.buffer, file.mimetype);
  if (wasScanned) {
    throw ApiError.badRequest(`Your ${slot} looks like a scanned or image-only PDF, so there is no text to read. Upload a text-based PDF, or enter your details manually.`);
  }
  if (looksLikeLinkedInExport(text)) {
    const { resume, report } = parseLinkedInText(text, { fileName: file.originalname, fileType: file.mimetype, linkedinUrl });
    return { resume: parseResumeJson(resume), kind: 'linkedin', report };
  }
  const resume = parseResumeText(text, { fileName: file.originalname, fileType: file.mimetype, lossy });
  return { resume: parseResumeJson(resume), kind: 'cv', report: null };
}

function importStatusOf(resume) {
  const found = { header: Boolean(resume.personal?.name), experience: resume.experience?.length || 0, education: resume.education?.length || 0 };
  return {
    found,
    status: found.header && found.experience ? 'imported' : found.header || found.experience ? 'partial' : 'manual-needed',
    missing: [!found.header && 'name', !found.experience && 'experience', !found.education && 'education'].filter(Boolean),
  };
}

/**
 * POST /api/studio/import — multipart with "linkedin" (LinkedIn "Save to
 * PDF" export, the main source) and/or "cv" (optional). When both are sent,
 * the LinkedIn data is kept and the CV only fills what LinkedIn is missing:
 * empty fields, extra jobs, bullet points, skills, certifications and
 * projects.
 */
export const importProfile = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const linkedinFile = files.linkedin?.[0] || null;
  const cvFile = files.cv?.[0] || files.resume?.[0] || null;
  if (!linkedinFile && !cvFile) throw ApiError.badRequest('Attach your LinkedIn profile PDF, your CV, or both.');

  const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
  const linkedinUrl = req.body?.linkedinUrl ? normaliseLinkedInUrl(req.body.linkedinUrl) : null;
  if (req.body?.linkedinUrl && !linkedinUrl) throw ApiError.badRequest('That does not look like a LinkedIn profile URL (linkedin.com/in/…).');

  const warnings = [];
  const fromLiBox = linkedinFile ? await readProfileFile(linkedinFile, 'LinkedIn PDF', { linkedinUrl }) : null;
  const fromCvBox = cvFile ? await readProfileFile(cvFile, 'CV', { linkedinUrl }) : null;
  if (fromLiBox && fromLiBox.kind !== 'linkedin' && fromCvBox?.kind !== 'linkedin') {
    warnings.push('The file in the LinkedIn box does not look like a LinkedIn "Save to PDF" export, so it was read like a CV.');
  }

  // Decide by what each file actually is, not by which box it was dropped
  // in: a recognised LinkedIn export is always the main source.
  let li = null;
  let cv = null;
  if (fromCvBox?.kind === 'linkedin' && fromLiBox?.kind !== 'linkedin') {
    li = fromCvBox;
    cv = fromLiBox;
  } else {
    li = fromLiBox?.kind === 'linkedin' ? fromLiBox : null;
    cv = li ? fromCvBox : fromLiBox && fromCvBox ? fromCvBox : fromLiBox || fromCvBox;
    // Two CVs and no LinkedIn export: the LinkedIn-box file leads.
    if (!li && fromLiBox && fromCvBox) li = fromLiBox;
  }

  // LinkedIn first; the CV only adds what LinkedIn does not have.
  let imported = (li || cv).resume;
  let addedFromCv = [];
  if (li && cv) ({ resume: imported, added: addedFromCv } = mergeResumes(li.resume, cv.resume));
  imported = parseResumeJson(imported);
  if (linkedinUrl && !imported.personal.linkedin) imported.personal.linkedin = linkedinUrl;

  const liIsLinkedIn = li?.kind === 'linkedin';
  const source = liIsLinkedIn && cv ? 'linkedin-pdf+resume' : liIsLinkedIn ? 'linkedin-pdf' : 'resume';
  const { found, status, missing } = importStatusOf(imported);
  const report = {
    source,
    status,
    found,
    missing,
    files: { linkedin: liIsLinkedIn, cv: Boolean(cv) || (Boolean(li) && !liIsLinkedIn) },
    addedFromCv: addedFromCv.length,
    warnings,
    note:
      liIsLinkedIn && cv
        ? `Your LinkedIn profile was read, and your CV added ${addedFromCv.length} item(s) LinkedIn did not have. Review every section before continuing.`
        : liIsLinkedIn
          ? 'Your LinkedIn profile was read. Review every section before continuing.'
          : 'Your CV was read. Review every section before continuing.',
  };

  const doc = await getDoc(req.user._id, { create: true });
  let master = imported;
  let added = addedFromCv.map((a) => `from CV — ${a}`);
  if (mode === 'merge' && doc.master) {
    let mergedNew;
    ({ resume: master, added: mergedNew } = mergeResumes(parseResumeJson(doc.master), imported));
    master = parseResumeJson(master);
    added = mergedNew;
    report.merged = true;
    report.note = mergedNew.length ? `Added ${mergedNew.length} item(s) that were not already in your profile. Nothing you had already reviewed was changed.` : 'Nothing new was found to add to your profile.';
  }

  doc.master = master;
  doc.consent = { ...(doc.consent?.toObject?.() || doc.consent || {}), dataProcessing: consentRecord(req) };
  doc.studio = {
    ...(doc.studio?.toObject?.() || doc.studio || {}),
    importSource: source,
    importStatus: status,
    importedAt: new Date(),
    importAdded: added.slice(0, 200),
    linkedinUrl: linkedinUrl || doc.studio?.linkedinUrl || '',
    // New data must be reviewed again before it is used for documents.
    profileConfirmedAt: undefined,
  };
  if (!doc.versions.some((v) => v.kind === 'original')) {
    doc.versions.push({ label: 'Original resume', kind: 'original', resume: master, templateId: 'ats-classic' });
  }
  doc.touchRetention();
  await doc.save();

  sendSuccess(res, { statusCode: 201, message: 'Profile imported', data: { resume: master, report, needsReview: master._needsReview || [] } });
});

/** PUT /api/studio/linkedin-url — stored as a reference only. */
export const setLinkedInUrl = asyncHandler(async (req, res) => {
  const url = normaliseLinkedInUrl(req.body?.url || '');
  if (!url) throw ApiError.badRequest('Enter a LinkedIn profile URL like linkedin.com/in/your-name.');
  const doc = await getDoc(req.user._id, { create: true });
  doc.studio = { ...(doc.studio?.toObject?.() || doc.studio || {}), linkedinUrl: url };
  if (doc.master) {
    const m = parseResumeJson(doc.master);
    if (!m.personal.linkedin) {
      m.personal.linkedin = url;
      doc.master = m;
    }
  }
  await doc.save();
  sendSuccess(res, {
    message: 'LinkedIn URL saved',
    data: {
      linkedinUrl: url,
      imported: false,
      note: 'Saved as a link on your profile. A URL alone does not give DutyLaunch access to your LinkedIn data — upload your LinkedIn PDF to import your details.',
    },
  });
});

/** POST /api/studio/manual — start a profile from manually entered details. */
export const manualProfile = asyncHandler(async (req, res) => {
  const resume = parseResumeJson(req.body?.resume || {});
  if (!resume.personal?.name) throw ApiError.badRequest('Add at least your name to start a profile.');
  const doc = await getDoc(req.user._id, { create: true });
  if (doc.master && req.body?.mode !== 'replace') throw ApiError.badRequest('You already have a profile. Edit it on the review step instead.');
  resume._needsReview = [];
  doc.master = resume;
  doc.consent = { ...(doc.consent?.toObject?.() || doc.consent || {}), dataProcessing: consentRecord(req) };
  doc.studio = { ...(doc.studio?.toObject?.() || doc.studio || {}), importSource: 'manual', importStatus: 'imported', importedAt: new Date(), profileConfirmedAt: undefined };
  if (!doc.versions.some((v) => v.kind === 'original')) doc.versions.push({ label: 'Original resume', kind: 'original', resume, templateId: 'ats-classic' });
  doc.touchRetention();
  await doc.save();
  sendSuccess(res, { statusCode: 201, message: 'Profile started', data: { resume } });
});

/* ------------------------------------------------------------------ *
 * Step 2 — review and confirm
 * ------------------------------------------------------------------ */

/** POST /api/studio/confirm — optional { resume } saves the reviewed edits first. */
export const confirmProfile = asyncHandler(async (req, res) => {
  const doc = await requireMaster(req.user._id);
  let master = parseResumeJson(doc.master);
  if (req.body?.resume) {
    const edited = parseResumeJson(req.body.resume);
    edited._source = master._source; // provenance is never client-editable
    edited._confidence = master._confidence;
    master = edited;
  }
  if (!master.personal?.name) throw ApiError.badRequest('Your profile needs at least your name before it can be confirmed.');
  master._needsReview = []; // the candidate has now reviewed every field
  doc.master = master;
  doc.studio = { ...(doc.studio?.toObject?.() || doc.studio || {}), profileConfirmedAt: new Date() };
  doc.touchRetention();
  await doc.save();
  sendSuccess(res, { message: 'Profile confirmed', data: { resume: master, confirmedAt: doc.studio.profileConfirmedAt } });
});

/* ------------------------------------------------------------------ *
 * Step 3 — LinkedIn-style profile PDF
 * ------------------------------------------------------------------ */

/** GET /api/studio/profile-document?format=pdf|docx&inline=1 */
export const downloadProfileDocument = asyncHandler(async (req, res) => {
  const doc = await requireMaster(req.user._id);
  if (!doc.studio?.profileConfirmedAt) throw ApiError.badRequest('Confirm your profile on the review step before generating the profile PDF.');
  const resume = parseResumeJson(doc.master);
  const inline = req.query.inline === '1';
  if (!inline) {
    doc.studio.profilePdfDownloadedAt = new Date();
    await doc.save();
  }
  await sendDocument(res, profileDocument(resume), {
    format: req.query.format,
    filename: safeFilename(resume.personal?.name || 'Candidate', 'LinkedIn_Profile'),
    inline,
  });
});

/* ------------------------------------------------------------------ *
 * Step 4 — resume downloads (generation uses /career/versions)
 * ------------------------------------------------------------------ */

/** GET /api/studio/versions/:versionId/document?format=pdf|docx&inline=1 */
export const downloadResumeDocument = asyncHandler(async (req, res) => {
  const doc = await requireMaster(req.user._id);
  const version = findVersion(doc, req.params.versionId);
  const resume = parseResumeJson(version.resume);
  const inline = req.query.inline === '1';
  if (!inline) {
    version.exportedAt = new Date();
    version.exportCount = (version.exportCount || 0) + 1;
    doc.studio = { ...(doc.studio?.toObject?.() || doc.studio || {}), documentsDownloadedAt: new Date() };
    await doc.save();
  }
  await sendDocument(res, resumeDocument(resume, { label: version.label }), {
    format: req.query.format,
    filename: safeFilename(resume.personal?.name || 'Candidate', 'Resume', version.label),
    inline,
  });
});

/** User-facing message when the AI fails: say so plainly when it is only
    the free per-minute limit (it clears by itself within a minute). */
const BUSY_MSG = 'The free AI limit for this minute has been reached. Wait about a minute and try again.';
const aiFailMsg = (err, fallback) => (err?.rateLimited ? BUSY_MSG : fallback);

/**
 * POST /api/studio/suggestions — Resume Builder wizard examples:
 * { kind: 'bullets' | 'skills' | 'summary', jobTitle, experienceLevel?, details? }
 */
export const builderSuggestions = asyncHandler(async (req, res) => {
  const { kind, jobTitle, experienceLevel, details } = req.body || {};
  if (!aiConfigured()) throw new ApiError(503, 'AI suggestions are not available right now. Use the examples or write your own.');
  let items;
  try {
    items = await generateBuilderSuggestions({ kind, jobTitle, experienceLevel, details });
  } catch (err) {
    logger.error(`[studio] builder suggestions failed: ${err.message}`);
    throw new ApiError(503, aiFailMsg(err, 'AI suggestions are busy right now. Use the examples or write your own.'));
  }
  sendSuccess(res, { message: 'Suggestions', data: { kind, jobTitle, items } });
});

/**
 * POST /api/studio/job-description — step 4. Writes a target job
 * description from the candidate's confirmed LinkedIn/CV profile.
 */
export const suggestJobDescription = asyncHandler(async (req, res) => {
  const { jobTitle, company, industry, experienceLevel } = req.body || {};
  if (!aiConfigured()) throw new ApiError(503, 'AI is not available right now. Paste the job posting instead.');
  const ctx = await context(req.user._id, { jobTitle, company });
  let result;
  try {
    result = await generateJobDescription(ctx.resume, { ...genOpts(ctx), jobTitle, company, industry, experienceLevel });
  } catch (err) {
    logger.error(`[studio] job description generation failed: ${err.message}`);
    throw new ApiError(503, aiFailMsg(err, 'The AI could not write a job description right now. Try again in a moment, or paste the job posting.'));
  }
  sendSuccess(res, { message: 'Job description written', data: { ...result, source: 'ai' } });
});

/* ------------------------------------------------------------------ *
 * Step 6 — cover letters
 * ------------------------------------------------------------------ */

const TONE_GUIDE = {
  professional: 'professional',
  confident: 'confident and direct, without exaggeration',
  concise: 'concise — about 180 words',
  'entry-level': 'entry-level / fresher: lead with education, projects, internships and skills; never imply employment the candidate does not have',
  experienced: 'experienced professional: lead with the most relevant roles and documented results',
  'career-change': 'career change: connect transferable, documented experience to the new field honestly',
};

const letterText = (l) => [l.salutation, l.body, l.closing, l.candidateName].filter(Boolean).join('\n\n');

export const createCoverLetter = asyncHandler(async (req, res) => {
  const { versionId, jobTitle, company, tone = 'professional' } = req.body || {};
  // A one-line "description" is not enough to tailor to; treat it as missing.
  let jobDescription = String(req.body?.jobDescription || '').trim();
  if (jobDescription.length < 40) jobDescription = '';
  let jobDescriptionSource = 'user';
  if (!jobDescription && !String(jobTitle || '').trim()) {
    throw ApiError.badRequest('Add the job title, or paste the job description — the letter is tailored to it.');
  }
  // Only a job title: the AI first reads the candidate's saved resume and
  // writes a typical description for that role, then the letter from it.
  if (!jobDescription) {
    const base = await context(req.user._id, { versionId, jobTitle, company });
    try {
      jobDescription = (await generateJobDescription(base.resume, { ...genOpts(base), jobTitle, company })).description;
      jobDescriptionSource = 'ai';
    } catch (err) {
      logger.error(`[studio] cover letter: job description generation failed: ${err.message}`);
      throw new ApiError(503, aiFailMsg(err, 'The AI could not prepare this job right now. Paste the job description, or try again in a moment.'));
    }
  }
  const ctx = await context(req.user._id, { versionId, jobDescription, jobTitle, company });
  const generated = await generateCoverLetter(ctx.resume, {
    ...genOpts(ctx),
    company,
    tone: TONE_GUIDE[tone] || 'professional',
  });
  const content = letterText(generated);
  const letter = await CoverLetter.create({
    user: req.user._id,
    versionId: ctx.version?._id,
    title: [jobTitle, company].filter(Boolean).join(' — ') || 'Cover letter',
    company, jobTitle, jobDescription, tone: COVER_LETTER_TONES.includes(tone) ? tone : 'professional',
    generated: content, content, engine: generated.engine === 'rules' ? 'rules' : 'model',
  });
  sendSuccess(res, {
    statusCode: 201,
    message: 'Cover letter created',
    data: {
      coverLetter: letter,
      jobDescriptionSource,
      engineNote: generated.engine === 'rules' ? 'AI generation is unavailable right now, so this letter was assembled from your own CV lines. Edit it before sending.' : generated.note,
    },
  });
});

export const listCoverLetters = asyncHandler(async (req, res) => {
  const items = await CoverLetter.find({ user: req.user._id }).sort({ updatedAt: -1 }).select('-jobDescription -generated').lean();
  sendSuccess(res, { message: 'Cover letters', data: items });
});

export const getCoverLetter = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Cover letter', data: await ownDoc(CoverLetter, req.params.id, req.user._id, 'Cover letter') });
});

export const updateCoverLetter = asyncHandler(async (req, res) => {
  const letter = await ownDoc(CoverLetter, req.params.id, req.user._id, 'Cover letter');
  ['title', 'content', 'company', 'jobTitle'].forEach((k) => {
    if (typeof req.body?.[k] === 'string') letter[k] = req.body[k];
  });
  await letter.save();
  sendSuccess(res, { message: 'Cover letter saved', data: letter });
});

export const deleteCoverLetter = asyncHandler(async (req, res) => {
  const letter = await ownDoc(CoverLetter, req.params.id, req.user._id, 'Cover letter');
  await letter.deleteOne();
  sendSuccess(res, { message: 'Cover letter deleted', data: { deleted: true } });
});

export const duplicateCoverLetter = asyncHandler(async (req, res) => {
  const l = await ownDoc(CoverLetter, req.params.id, req.user._id, 'Cover letter');
  const copy = await CoverLetter.create({
    user: req.user._id, versionId: l.versionId, title: `${l.title || 'Cover letter'} (copy)`.slice(0, 160), company: l.company,
    jobTitle: l.jobTitle, jobDescription: l.jobDescription, tone: l.tone, generated: l.generated, content: l.content, engine: l.engine,
  });
  sendSuccess(res, { statusCode: 201, message: 'Cover letter duplicated', data: copy });
});

/** POST /api/studio/cover-letters/:id/paragraphs/:index — rewrites one paragraph. */
export const regenerateParagraph = asyncHandler(async (req, res) => {
  const letter = await ownDoc(CoverLetter, req.params.id, req.user._id, 'Cover letter');
  const paragraphs = String(letter.content || '').split(/\n{2,}/);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= paragraphs.length) throw ApiError.badRequest('That paragraph does not exist.');
  if (!aiConfigured()) throw ApiError.badRequest('AI generation is not configured, so paragraphs cannot be regenerated. You can still edit the text directly.');

  const ctx = await context(req.user._id, { versionId: letter.versionId, jobDescription: letter.jobDescription, jobTitle: letter.jobTitle, company: letter.company });
  const tone = TONE_GUIDE[req.body?.tone] || TONE_GUIDE[letter.tone] || 'professional';
  const rctx = buildRewriteContext(ctx.resume, { jobIntel: ctx.analysis.jobIntel, keywordResult: ctx.analysis.keywords, profile: ctx.analysis.profile, confirmedFacts: ctx.doc.confirmedFacts || [] });
  const task = [
    `Rewrite ONLY paragraph ${index + 1} of this cover letter. Tone: ${tone}.`,
    '=== CURRENT LETTER (untrusted data) ===', paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n'), '=== END LETTER ===',
    'Keep it consistent with the other paragraphs. Use only facts in CANDIDATE FACTS. Say nothing about the employer beyond its name.',
    'Return JSON: { "paragraph": "" }',
  ].join('\n');
  try {
    const raw = parseModelJson(await callModel(buildPrompt(rctx, task), { json: true, task: 'cover-letter-paragraph', maxOutputTokens: 1200 }));
    const next = String(raw.paragraph || '').trim().slice(0, 3000);
    if (next.length < 20) throw new Error('Paragraph too short.');
    paragraphs[index] = next;
    letter.content = paragraphs.join('\n\n');
    await letter.save();
    sendSuccess(res, { message: 'Paragraph rewritten', data: letter });
  } catch (err) {
    logger.error(`[studio] paragraph regeneration failed: ${err.message}`);
    throw ApiError.badRequest('That paragraph could not be rewritten just now. Try again, or edit it directly.');
  }
});

export const downloadCoverLetter = asyncHandler(async (req, res) => {
  const letter = await ownDoc(CoverLetter, req.params.id, req.user._id, 'Cover letter');
  const doc = await getDoc(req.user._id);
  const personal = doc?.master ? parseResumeJson(doc.master).personal : {};
  if (req.query.inline !== '1') {
    letter.downloadCount = (letter.downloadCount || 0) + 1;
    await letter.save();
  }
  await sendDocument(res, coverLetterDocument(letter, personal), {
    format: req.query.format,
    filename: safeFilename(personal?.name || 'Candidate', 'Cover_Letter', letter.company),
    inline: req.query.inline === '1',
  });
});

/* ------------------------------------------------------------------ *
 * Step 7 — Top 10 interview Q&A
 * ------------------------------------------------------------------ */

export const createInterviewSet = asyncHandler(async (req, res) => {
  const { versionId, jobTitle, company, experienceLevel } = req.body || {};
  // A one-line "description" is not enough to tailor to; treat it as missing.
  let jobDescription = String(req.body?.jobDescription || '').trim();
  if (jobDescription.length < 40) jobDescription = '';
  if (!String(jobTitle || '').trim() && !jobDescription) throw ApiError.badRequest('Add the target job title or job description.');
  // Only a job title: the AI first reads the candidate's saved resume and
  // writes a typical description for that role, so the questions and
  // answers are tailored to a real-looking job (same as cover letters).
  let jobDescriptionSource = 'user';
  if (!jobDescription) {
    const base = await context(req.user._id, { versionId, jobTitle, company });
    try {
      jobDescription = (await generateJobDescription(base.resume, { ...genOpts(base), jobTitle, company, experienceLevel })).description;
      jobDescriptionSource = 'ai';
    } catch (err) {
      logger.error(`[studio] interview set: job description generation failed: ${err.message}`);
      throw new ApiError(503, aiFailMsg(err, 'The AI could not prepare this job right now. Paste the job description, or try again in a moment.'));
    }
  }
  const ctx = await context(req.user._id, { versionId, jobDescription, jobTitle, company });
  const result = await generateTop10(ctx.resume, genOpts(ctx, { experienceLevel }));
  const set = await InterviewSession.create({
    user: req.user._id, kind: 'top10', versionId: ctx.version?._id,
    title: `Top 10 — ${jobTitle || ctx.analysis.jobIntel?.role?.jobTitle || 'target role'}`.slice(0, 160),
    jobTitle: jobTitle || ctx.analysis.jobIntel?.role?.jobTitle || '', company, jobDescription: ctx.jobDescription, experienceLevel,
    engine: result.engine, questions: result.questions,
  });
  sendSuccess(res, {
    statusCode: 201,
    message: 'Interview questions ready',
    data: {
      set,
      jobDescriptionSource,
      note: result.note,
      engineNote: result.engine === 'rules' ? 'AI generation is unavailable right now, so these questions were built from your CV and the job description without a model. Answers are frameworks with [placeholders] for you to fill.' : result.partial ? 'Some questions were completed from our standard set because the AI response was incomplete.' : null,
    },
  });
});

export const listInterviewSets = asyncHandler(async (req, res) => {
  const items = await InterviewSession.find({ user: req.user._id, kind: 'top10' }).sort({ updatedAt: -1 }).select('title jobTitle company engine versionId createdAt updatedAt downloadCount').lean();
  sendSuccess(res, { message: 'Interview question sets', data: items });
});

const getSet = (req) => ownDoc(InterviewSession, req.params.id, req.user._id, 'Question set').then((s) => {
  if (s.kind !== 'top10') throw ApiError.notFound('Question set not found.');
  return s;
});

export const getInterviewSet = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Question set', data: await getSet(req) });
});

/** PUT /api/studio/interview-sets/:id — the candidate edits answers or notes. */
export const updateInterviewSet = asyncHandler(async (req, res) => {
  const set = await getSet(req);
  if (typeof req.body?.title === 'string') set.title = req.body.title.slice(0, 160);
  if (Array.isArray(req.body?.questions)) {
    req.body.questions.forEach((edit) => {
      const q = set.questions.find((x) => x.number === Number(edit.number));
      if (!q) return;
      ['question', 'sampleAnswer', 'followUp'].forEach((k) => {
        if (typeof edit[k] === 'string' && edit[k] !== q[k]) {
          q[k] = edit[k];
          q.edited = true;
        }
      });
      if (Array.isArray(edit.keyPoints)) {
        q.keyPoints = edit.keyPoints.map(String).slice(0, 8);
        q.edited = true;
      }
    });
    set.markModified('questions');
  }
  await set.save();
  sendSuccess(res, { message: 'Question set saved', data: set });
});

export const regenerateInterviewQuestion = asyncHandler(async (req, res) => {
  const set = await getSet(req);
  const n = Number(req.params.number);
  const idx = set.questions.findIndex((q) => q.number === n);
  if (idx < 0) throw ApiError.notFound('Question not found.');
  const ctx = await context(req.user._id, { versionId: set.versionId, jobDescription: set.jobDescription, jobTitle: set.jobTitle, company: set.company });
  const result = await regenerateQuestion(ctx.resume, { question: set.questions[idx].question, index: idx, ...genOpts(ctx, { experienceLevel: set.experienceLevel }) });
  if (!result.question) throw ApiError.badRequest(result.message);
  set.questions[idx] = { ...result.question, number: n };
  set.markModified('questions');
  await set.save();
  sendSuccess(res, { message: 'Question regenerated', data: set });
});

export const deleteInterviewSet = asyncHandler(async (req, res) => {
  const set = await getSet(req);
  await set.deleteOne();
  sendSuccess(res, { message: 'Question set deleted', data: { deleted: true } });
});

export const downloadInterviewSet = asyncHandler(async (req, res) => {
  const set = await getSet(req);
  const doc = await getDoc(req.user._id);
  const personal = doc?.master ? parseResumeJson(doc.master).personal : {};
  if (req.query.inline !== '1') {
    set.downloadCount = (set.downloadCount || 0) + 1;
    await set.save();
  }
  await sendDocument(res, interviewDocument(set, personal), {
    format: req.query.format,
    filename: safeFilename(personal?.name || 'Candidate', 'Interview_Preparation', set.jobTitle),
    inline: req.query.inline === '1',
  });
});

/* ------------------------------------------------------------------ *
 * Phase 2 — mock interview
 * ------------------------------------------------------------------ */

const MAX_FOLLOW_UPS = (count) => Math.max(1, Math.floor(count / 2));

function publicSession(s) {
  const o = s.toObject ? s.toObject() : s;
  const current = o.status === 'in-progress' ? o.plannedQuestions[o.currentIndex] || null : null;
  return { ...o, id: o._id, currentQuestion: current, total: o.plannedQuestions.length };
}

export const startMock = asyncHandler(async (req, res) => {
  const { sourceSetId, versionId, jobTitle, company, jobDescription, interviewType = 'mixed', difficulty = 'medium', durationMinutes } = req.body || {};
  const questionCount = Math.min(15, Math.max(1, Number(req.body?.questionCount) || 5));
  let set = null;
  if (sourceSetId) set = await ownDoc(InterviewSession, sourceSetId, req.user._id, 'Question set');

  const ctx = await context(req.user._id, {
    versionId: versionId || set?.versionId,
    jobDescription: jobDescription || set?.jobDescription,
    jobTitle: jobTitle || set?.jobTitle,
    company: company || set?.company,
  });

  let planned;
  let engine;
  if (set?.questions?.length) {
    planned = set.questions.slice(0, questionCount).map((q) => ({ question: q.question, category: q.category, difficulty: q.difficulty || undefined }));
    engine = set.engine;
  } else {
    const plan = await planMockQuestions(ctx.resume, { interviewType, difficulty, count: questionCount, ...genOpts(ctx) });
    planned = plan.questions;
    engine = plan.engine;
  }

  const session = await InterviewSession.create({
    user: req.user._id, kind: 'mock', sourceSetId: set?._id, versionId: ctx.version?._id,
    title: `Mock ${interviewType} interview — ${jobTitle || set?.jobTitle || 'practice'}`.slice(0, 160),
    jobTitle: jobTitle || set?.jobTitle || '', company: company || set?.company, jobDescription: ctx.jobDescription,
    interviewType, difficulty, durationMinutes: durationMinutes ? Math.min(120, Math.max(5, Number(durationMinutes))) : undefined,
    questionCount: planned.length, plannedQuestions: planned, engine, startedAt: new Date(),
  });
  sendSuccess(res, { statusCode: 201, message: 'Mock interview started', data: publicSession(session) });
});

export const listMocks = asyncHandler(async (req, res) => {
  const items = await InterviewSession.find({ user: req.user._id, kind: 'mock' }).sort({ updatedAt: -1 })
    .select('title jobTitle interviewType difficulty status questionCount currentIndex report.overallScore startedAt completedAt updatedAt').lean();
  sendSuccess(res, { message: 'Mock interviews', data: items });
});

const getMock = (req) => ownDoc(InterviewSession, req.params.id, req.user._id, 'Mock interview').then((s) => {
  if (s.kind !== 'mock') throw ApiError.notFound('Mock interview not found.');
  return s;
});

export const getMockSession = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Mock interview', data: publicSession(await getMock(req)) });
});

/** POST /api/studio/mock/:id/answer — { answer, mode: 'text'|'voice' } */
export const answerMock = asyncHandler(async (req, res) => {
  const session = await getMock(req);
  if (session.status !== 'in-progress') throw ApiError.badRequest('This mock interview is already finished.');
  const current = session.plannedQuestions[session.currentIndex];
  if (!current) throw ApiError.badRequest('There are no more questions in this session.');
  const answer = String(req.body?.answer || '').trim();
  if (answer.length < 2) throw ApiError.badRequest('Type (or dictate) your answer before submitting.');

  const ctx = await context(req.user._id, { versionId: session.versionId, jobDescription: session.jobDescription, jobTitle: session.jobTitle, company: session.company });
  const isFollowUp = Boolean(current.isFollowUp);
  const canFollowUp = !isFollowUp && session.followUpsAsked < MAX_FOLLOW_UPS(session.questionCount);
  const feedback = await evaluateAnswer(ctx.resume, { question: current.question, category: current.category, answer, allowFollowUp: canFollowUp, ...genOpts(ctx) });

  const { followUpQuestion, ...stored } = feedback;
  session.turns.push({ question: current.question, category: current.category, isFollowUp, answer: answer.slice(0, 8000), answeredAt: new Date(), answerMode: req.body?.mode === 'voice' ? 'voice' : 'text', feedback: stored });

  // A follow-up is asked next, before the next planned question.
  if (canFollowUp && followUpQuestion) {
    session.plannedQuestions.splice(session.currentIndex + 1, 0, { question: followUpQuestion, category: `${current.category || 'General'} follow-up`, isFollowUp: true });
    session.followUpsAsked += 1;
    session.markModified('plannedQuestions');
  }
  session.currentIndex += 1;
  await session.save();

  sendSuccess(res, {
    message: 'Answer evaluated',
    data: { feedback: stored, followUpAdded: Boolean(canFollowUp && followUpQuestion), session: publicSession(session), practiceNote: 'AI-generated practice feedback — not an employer assessment.' },
  });
});

export const finishMock = asyncHandler(async (req, res) => {
  const session = await getMock(req);
  if (session.status === 'completed') return sendSuccess(res, { message: 'Report', data: publicSession(session) });
  const ctx = await context(req.user._id, { versionId: session.versionId, jobDescription: session.jobDescription, jobTitle: session.jobTitle, company: session.company });
  session.report = await buildMockReport(ctx.resume, session, genOpts(ctx));
  session.status = 'completed';
  session.completedAt = new Date();
  await session.save();
  sendSuccess(res, { message: 'Mock interview complete', data: publicSession(session) });
});

export const deleteMock = asyncHandler(async (req, res) => {
  const s = await getMock(req);
  await s.deleteOne();
  sendSuccess(res, { message: 'Mock interview deleted', data: { deleted: true } });
});

export const downloadMockReport = asyncHandler(async (req, res) => {
  const session = await getMock(req);
  if (session.status !== 'completed') throw ApiError.badRequest('Finish the interview to download its report.');
  const doc = await getDoc(req.user._id);
  const personal = doc?.master ? parseResumeJson(doc.master).personal : {};
  await sendDocument(res, mockReportDocument(session, personal), {
    format: req.query.format,
    filename: safeFilename(personal?.name || 'Candidate', 'Mock_Interview_Report'),
    inline: req.query.inline === '1',
  });
});