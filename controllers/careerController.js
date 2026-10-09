import crypto from 'node:crypto';
import { consentRecord } from '../utils/consent.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { CareerProfile, ScoringConfig, ResumeAnalysis, CoverLetter, InterviewSession } from '../models/index.js';
import { env } from '../config/env.js';
import {
  parseResumeFile,
  parseResumeText,
  parseResumeJson,
  applyEdit,
  analyzeCandidate,
  analyzeJobDescription,
  deriveTargetedResume,
  proposeRewrites,
  applyDecisions,
  buildComparison,
  runQualityControl,
  validateIntegrity,
  generateEvidenceQuestions,
  buildAchievementBullet,
  toConfirmedFacts,
  renderResume,
  listTemplates,
  suggestTemplate,
} from '../services/careerIntelligence/index.js';
import { generateLinkedIn, generateCoverLetter, generateInterviewPrep } from '../services/careerIntelligence/careerTools.js';
import { buildOptimizedResume, summarizeAnalysis, keywordReport } from '../services/careerIntelligence/optimizeWorkflow.js';

/* ------------------------------------------------------------------ *
 * MagicalAPI Resume Checker
 *
 * Contract taken from MagicalAPI's official client (magicalapi-python):
 *   POST https://gw.magicalapi.com/resume-review
 *   headers: { 'api-key': KEY, 'Content-Type': 'application/json' }
 *   body:    { url: '<public URL of a PDF>' }
 *   201 -> { data: { request_id }, usage }  => re-POST with request_id
 *   200 -> { data: { score, result, suggested }, usage }
 *
 * The API reads the resume from a URL, not an upload, so the PDF is
 * served from this backend at a random single-use link that expires
 * after a few minutes (see serveTempResume below).
 * ------------------------------------------------------------------ */

const MAGICAL_BASE = 'https://gw.magicalapi.com';
const TEMP_TTL_MS = 5 * 60 * 1000;
const tempFiles = new Map();      // token -> { buffer, mimetype, expires }
const pendingMagical = new Map(); // userId -> Promise<result|null>

function putTempFile(buffer, mimetype) {
  const now = Date.now();
  for (const [t, f] of tempFiles) if (f.expires < now) tempFiles.delete(t);
  const token = crypto.randomBytes(24).toString('hex');
  tempFiles.set(token, { buffer, mimetype, expires: now + TEMP_TTL_MS });
  return token;
}

/** GET /api/career/magical-file/:token — lets MagicalAPI fetch the PDF once. */
export const serveTempResume = (req, res) => {
  const token = String(req.params.token || '').replace(/\.pdf$/, '');
  const file = tempFiles.get(token);
  if (!file || file.expires < Date.now()) {
    tempFiles.delete(token);
    return res.status(404).end();
  }
  res.set('Content-Type', file.mimetype);
  res.set('Cache-Control', 'no-store');
  res.send(file.buffer);
};

function publicBaseUrl(req) {
  return (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function normaliseMagical(body) {
  const d = body?.data;
  if (!d || typeof d.score !== 'number') return null;
  const r = d.result || {};
  const sc = (section) => {
    if (!section) return 50;
    const p = (section.pros || []).length;
    const c = (section.cons || []).length;
    return p + c === 0 ? 50 : Math.round((p / (p + c)) * 100);
  };
  return {
    score: d.score,
    categoryScores: {
      contact: sc(r.contact),
      formatting: sc(r.format),
      experience: sc(r.experiences),
      skills: sc(r.skills),
      education: sc(r.educations),
      summary: sc(r.summary),
    },
    strengths: Object.values(r).flatMap((s) => s?.pros || []).slice(0, 6),
    weaknesses: Object.values(r).flatMap((s) => (s?.cons || []).map((c) => c?.message)).filter(Boolean).slice(0, 6),
    recommendations: [...new Set(Object.values(r).flatMap((s) => (s?.cons || []).flatMap((c) => c?.tips || [])))].slice(0, 8),
    suggested: d.suggested?.summary?.content || null,
  };
}

export async function analyzeWithMagicalApi({ buffer, mimetype, baseUrl }) {
  if (!env.magicalApiKey) {
    console.warn('[MagicalAPI] MAGICAL_API_KEY is not set — using internal engine.');
    return null;
  }
  if (mimetype !== 'application/pdf') {
    console.warn('[MagicalAPI] only PDF resumes are supported — using internal engine for', mimetype);
    return null;
  }

  const token = putTempFile(buffer, mimetype);
  const url = `${baseUrl}/api/career/magical-file/${token}.pdf`;
  const payload = { url };
  const deadline = Date.now() + 60_000;

  try {
    while (Date.now() < deadline) {
      const res = await fetch(`${MAGICAL_BASE}/resume-review`, {
        method: 'POST',
        headers: { 'api-key': env.magicalApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* not JSON */ }

      if (res.status === 201 && body?.data?.request_id) {
        payload.request_id = body.data.request_id; // still processing — poll again
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (res.status === 200) {
        const result = normaliseMagical(body);
        console.log('[MagicalAPI] score received:', result?.score);
        return result;
      }
      console.warn(`[MagicalAPI] HTTP ${res.status}:`, text.slice(0, 300));
      return null;
    }
    console.warn('[MagicalAPI] timed out after 60s — using internal engine.');
    return null;
  } catch (err) {
    console.warn('[MagicalAPI] request failed:', err.message);
    return null;
  } finally {
    tempFiles.delete(token);
  }
}

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

/** Loads (or creates) the signed-in candidate's Master Career Profile. */
async function getProfileDoc(userId, { create = false } = {}) {
  let doc = await CareerProfile.findOne({ user: userId });
  if (!doc && create) {
    doc = await CareerProfile.create({ user: userId });
    doc.touchRetention();
    await doc.save();
  }
  return doc;
}

/**
 * Resolves the resume a request is operating on, in priority order:
 * an inline resume in the body, a named version, or the master profile.
 * Anonymous callers must send the resume inline — we do not persist
 * anything for a visitor who has not signed in.
 */
async function resolveResume(req) {
  if (req.body?.resume) return { resume: parseResumeJson(req.body.resume), doc: null, version: null };

  if (!req.user) {
    throw ApiError.badRequest('Send your resume data with this request, or sign in to use your saved career profile.');
  }

  const doc = await getProfileDoc(req.user._id);
  if (!doc) throw ApiError.notFound('No career profile yet. Upload your CV first.');

  if (req.body?.versionId || req.params?.versionId) {
    const versionId = req.body?.versionId || req.params.versionId;
    const version = doc.versions.id(versionId);
    if (!version) throw ApiError.notFound('That resume version does not exist.');
    return { resume: parseResumeJson(version.resume), doc, version };
  }

  if (!doc.master) throw ApiError.notFound('Your career profile has no resume yet. Upload your CV first.');
  return { resume: parseResumeJson(doc.master), doc, version: null };
}

/** The baseline every integrity check diffs against: the original upload. */
function baselineFor(doc, fallback) {
  const original = doc?.versions?.find((v) => v.kind === 'original');
  if (original?.resume) return parseResumeJson(original.resume);
  if (doc?.master) return parseResumeJson(doc.master);
  return fallback;
}

/* ------------------------------------------------------------------ *
 * Upload and parse (spec §4, §5)
 * ------------------------------------------------------------------ */

/** POST /api/career/resume/parse */
export const parseUpload = asyncHandler(async (req, res) => {
  let resume;

  if (req.file) {
    resume = await parseResumeFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      fileName: req.file.originalname,
    });
  } else if (req.body?.text?.trim()) {
    resume = parseResumeText(req.body.text, { fileName: 'pasted.txt', fileType: 'text/plain' });
  } else {
    throw ApiError.badRequest('Attach a CV file or paste your resume text.');
  }

  // Resume Builder only needs the data: leave the saved profile alone and
  // skip the (paid) MagicalAPI check.
  const builderOnly = req.body?.purpose === 'builder';

  // Signed in: this becomes the master profile and the immutable v1.
  if (req.user && !builderOnly) {
    const doc = await getProfileDoc(req.user._id, { create: true });

    doc.master = resume;
    doc.consent = { ...(doc.consent?.toObject?.() || doc.consent || {}), dataProcessing: consentRecord(req) };
    doc.touchRetention();
    // A new CV invalidates any MagicalAPI score from a previous upload.
    doc.lastMagicalScore = null;
    doc.markModified('lastMagicalScore');

    // The original is stored once and never replaced, so there is always
    // a verified baseline to check every later rewrite against.
    if (!doc.versions.some((v) => v.kind === 'original')) {
      doc.versions.push({
        label: 'Original resume',
        kind: 'original',
        resume,
        templateId: 'ats-classic',
      });
    }

    await doc.save();
  }

  // Score with MagicalAPI in the background: the upload returns now, and
  // /career/analyze waits for this result (up to 15s) before scoring.
  if (req.file && req.user && !builderOnly) {
    const userId = String(req.user._id);
    const job = analyzeWithMagicalApi({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      baseUrl: publicBaseUrl(req),
    })
      .then(async (result) => {
        if (result) {
          await CareerProfile.updateOne({ user: req.user._id }, { $set: { lastMagicalScore: result } });
        }
        return result;
      })
      .catch((err) => {
        console.warn('[MagicalAPI] background job failed:', err.message);
        return null;
      })
      .finally(() => {
        if (pendingMagical.get(userId) === job) pendingMagical.delete(userId);
      });
    pendingMagical.set(userId, job);
  }

  sendSuccess(res, {
    message: 'Resume parsed',
    data: {
      resume,
      needsReview: resume._needsReview,
      confidence: resume._confidence,
      saved: Boolean(req.user),
      /* Spec §4: the review step is part of the flow, not an optional
         extra. Say so explicitly rather than implying the parse is final. */
      reviewNote:
        resume._needsReview.length > 0
          ? `We could not read ${resume._needsReview.length} field${resume._needsReview.length === 1 ? '' : 's'} confidently. Check them before you continue — we would rather ask than guess.`
          : 'Everything parsed cleanly, but please check it against your original before continuing.',
    },
  });
});

/* ------------------------------------------------------------------ *
 * Analysis (spec §5, §6, §7, §8, §15, §18)
 * ------------------------------------------------------------------ */

/** POST /api/career/analyze */
export const analyze = asyncHandler(async (req, res) => {
  const { resume, doc } = await resolveResume(req);
  const override = await configOverride();

  const analysis = analyzeCandidate(resume, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: override,
  });

  // MagicalAPI score for this user's latest upload. Waits for a job that is
  // still running, then reads the stored result — this works whether the
  // frontend sent the resume inline or relied on the saved profile.
  let magical = null;
  if (req.user) {
    const pending = pendingMagical.get(String(req.user._id));
    if (pending) {
      await Promise.race([pending, new Promise((r) => setTimeout(r, 15_000))]);
    }
    const fresh = await CareerProfile.findOne({ user: req.user._id }).select('lastMagicalScore').lean();
    magical = fresh?.lastMagicalScore || null;
  }
  console.log('[MagicalAPI] analyze using', magical ? `MagicalAPI score ${magical.score}` : 'internal engine');
  if (magical && typeof magical.score === 'number') {
    analysis.health.score = magical.score;
    analysis.health.band = magical.score >= 85
      ? { label: 'Strong',     tone: 'success' }
      : magical.score >= 70
        ? { label: 'Good',       tone: 'azure'   }
        : magical.score >= 50
          ? { label: 'Needs work', tone: 'amber'   }
          : { label: 'Weak',       tone: 'danger'  };

    const mc = magical.categoryScores || {};
    const avg = (...v) => {
      const n = v.filter((x) => typeof x === 'number');
      return n.length ? Math.round(n.reduce((t, x) => t + x, 0) / n.length) : null;
    };
    const catMap = {
      atsStructure:        avg(mc.contact, mc.formatting),
      achievementStrength: avg(mc.experience),
      skillsCoverage:      avg(mc.skills),
      readability:         avg(mc.summary, mc.formatting),
      completeness:        avg(mc.education, mc.contact),
      keywordAlignment:    avg(mc.experience, mc.summary),
      experienceRelevance: avg(mc.experience),
    };
    Object.entries(catMap).forEach(([key, val]) => {
      if (val !== null && analysis.health.categories[key]) {
        analysis.health.categories[key].score = val;
      }
    });

    if (magical.strengths?.length)  analysis.health.whatIsStrong           = magical.strengths;
    if (magical.weaknesses?.length) analysis.health.whatNeedsImprovement   = magical.weaknesses;
    if (magical.suggested)          analysis.health.suggestedSummary        = magical.suggested;
    analysis.health.methodology =
      'This score is provided by MagicalAPI\u2019s Resume Checker. It is not a guarantee of ATS acceptance or interview success.';
    analysis.health.scoredByMagicalApi = true;
  }

  const record = req.body?.record !== false;

  if (doc && record) {
    doc.profile = analysis.profile;
    doc.lastAnalyzedAt = new Date();
    doc.touchRetention();
    await doc.save();
  }

  // Keeps the existing ATS history feature working, now fed by the
  // richer engine rather than the old heuristic scorer.
  if (req.user && record) {
    await ResumeAnalysis.create({
      user: req.user._id,
      fileName: resume._source?.fileName || 'career-profile',
      fileType: resume._source?.fileType || 'application/json',
      score: analysis.health.score,
      categoryScores: Object.fromEntries(
        Object.entries(analysis.health.categories).map(([k, v]) => [k, v.score])
      ),
      strengths: analysis.health.whatIsStrong,
      weaknesses: analysis.health.whatNeedsImprovement,
      recommendations: analysis.recommendations.map((r) => r.title),
    }).catch(() => null);
  }

  sendSuccess(res, { message: 'Analysis complete', data: analysis });
});

/** POST /api/career/job/analyze — JD analysis on its own (spec §10). */
export const analyzeJob = asyncHandler(async (req, res) => {
  const text = req.body?.jobDescription?.trim();
  if (!text && !req.body?.jobTitle) {
    throw ApiError.badRequest('Paste a job description, or give us a job title to work from.');
  }
  const intel = analyzeJobDescription(text || '', req.body?.jobHints || { jobTitle: req.body?.jobTitle });
  sendSuccess(res, { message: 'Job description analyzed', data: intel });
});

/* ------------------------------------------------------------------ *
 * Master profile CRUD (spec §43)
 * ------------------------------------------------------------------ */

/** GET /api/career/profile */
export const getProfile = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id);
  if (!doc) {
    return sendSuccess(res, { message: 'No career profile yet', data: { exists: false, identityName: req.user?.resumeIdentity?.name || null } });
  }

  return sendSuccess(res, {
    message: 'Career profile',
    data: {
      exists: true,
      // The name this account's resumes are locked to (null until first save).
      identityName: req.user?.resumeIdentity?.name || null,
      master: doc.master,
      profile: doc.profile,
      preferences: doc.preferences,
      consent: doc.consent,
      confirmedFacts: doc.confirmedFacts,
      lastAnalyzedAt: doc.lastAnalyzedAt,
      versions: doc.versions.map((v) => ({
        id: v._id,
        label: v.label,
        kind: v.kind,
        target: v.target,
        templateId: v.templateId,
        health: v.health,
        match: v.match,
        integrity: v.integrity,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    },
  });
});

/** PUT /api/career/profile — save edits to the master resume. */
export const updateProfile = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id, { create: true });

  if (req.body?.resume) {
    // applyEdit guarantees `_source` survives, whatever the client sends.
    doc.master = applyEdit(doc.master || {}, req.body.resume);
  }
  if (req.body?.preferences) {
    doc.preferences = { ...doc.preferences.toObject?.() ?? doc.preferences, ...req.body.preferences };
  }
  if (req.body?.consent) {
    const now = new Date();
    ['aiProcessing', 'analytics', 'modelTraining'].forEach((key) => {
      if (typeof req.body.consent[key] === 'boolean') {
        doc.consent[key] = req.body.consent[key];
        doc.consent[`${key}At`] = now;
      }
    });
  }

  doc.touchRetention();
  await doc.save();

  sendSuccess(res, { message: 'Career profile updated', data: { master: doc.master, preferences: doc.preferences, consent: doc.consent } });
});

/** DELETE /api/career/profile — user-controlled deletion (spec §39). */
export const deleteProfile = asyncHandler(async (req, res) => {
  await CareerProfile.deleteOne({ user: req.user._id });
  await ResumeAnalysis.deleteMany({ user: req.user._id });
  // Studio documents are part of the same profile and are erased with it.
  await CoverLetter.deleteMany({ user: req.user._id });
  await InterviewSession.deleteMany({ user: req.user._id });
  sendSuccess(res, { message: 'Your career profile, analysis history, cover letters and interview practice have been deleted.', data: { deleted: true } });
});

/* ------------------------------------------------------------------ *
 * Evidence and achievements (spec §13, §14)
 * ------------------------------------------------------------------ */

/** POST /api/career/evidence/questions */
export const getEvidenceQuestions = asyncHandler(async (req, res) => {
  const { resume, doc } = await resolveResume(req);
  const analysis = analyzeCandidate(resume, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: await configOverride(),
  });

  sendSuccess(res, {
    message: 'Evidence questions',
    data: {
      questions: analysis.questions,
      note: 'Nothing you tell us here is added to your resume automatically. You review every generated line before it goes in.',
    },
  });
});

/** POST /api/career/evidence/answer */
export const submitEvidenceAnswer = asyncHandler(async (req, res) => {
  const { question, answers } = req.body || {};
  if (!question?.id) throw ApiError.badRequest('Which question is this answering?');

  const facts = toConfirmedFacts(question, answers || {});
  const built = buildAchievementBullet({ keyword: question.keyword, answers: answers || {} });

  if (req.user) {
    const doc = await getProfileDoc(req.user._id, { create: true });
    // Replace any earlier answer to the same question rather than
    // accumulating contradictory facts.
    doc.confirmedFacts = [
      ...doc.confirmedFacts.filter((f) => f.questionId !== question.id),
      ...facts,
    ];
    doc.touchRetention();
    await doc.save();
  }

  sendSuccess(res, {
    message: 'Answer recorded',
    data: {
      confirmedFacts: facts,
      suggestedBullet: built,
      note: built
        ? 'This bullet was built only from what you just confirmed. Edit it freely — nothing is added to your resume until you accept it.'
        : 'Thanks. There was not enough detail to build a bullet from this yet.',
    },
  });
});

/* ------------------------------------------------------------------ *
 * Optimisation (spec §15, §28, §29, §30)
 * ------------------------------------------------------------------ */

/**
 * POST /api/career/optimize
 *
 * Default: returns proposals for review; nothing is changed.
 * With `autoApply: true` (the Resume Builder upload flow): proposals that
 * passed the integrity checks are applied to a COPY of the resume and the
 * complete optimised resume is returned together with before/after scores
 * and a keyword report. The original is never modified, and the optimised
 * copy is discarded in favour of the original if the integrity validator
 * finds a serious problem in it.
 */
export const optimize = asyncHandler(async (req, res) => {
  const { resume, doc } = await resolveResume(req);
  const override = await configOverride();
  const confirmedFacts = doc?.confirmedFacts || [];
  const analysisOpts = {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts,
    configOverride: override,
  };

  const analysis = analyzeCandidate(resume, analysisOpts);

  const result = await proposeRewrites(resume, {
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    profile: analysis.profile,
    confirmedFacts,
    scope: req.body?.scope || 'all',
  });

  if (!req.body?.autoApply) {
    return sendSuccess(res, {
      message: 'Optimisation proposals ready',
      data: {
        ...result,
        /* Nothing has been changed yet. The candidate accepts, edits or
           rejects each proposal (spec §28). */
        applied: false,
        reviewNote: 'Every change is a proposal until you accept it. Each one shows why it was suggested.',
      },
    });
  }

  const built = buildOptimizedResume(resume, result.proposals, { keywordResult: analysis.keywords });
  const integrity = validateIntegrity(built.resume, resume, { confirmedFacts });

  let optimized = built.resume;
  let changelog = [...built.changelog, ...built.extras];
  let pending = built.pending;
  const warnings = [...(result.warnings || [])];

  if (integrity.blocked) {
    /* A serious fact change slipped through: ship nothing automatically. */
    optimized = resume;
    changelog = [];
    pending = result.proposals;
    warnings.push('The rewritten version failed our fact check, so your original resume was kept. Review the suggestions one by one instead.');
  }

  const after = analyzeCandidate(optimized, analysisOpts);
  const comparison = buildComparison(resume, optimized, changelog);

  // The raw upload text is evidence for validation only; do not echo it back.
  const lean = JSON.parse(JSON.stringify(optimized));
  if (lean._source) lean._source = { ...lean._source, rawText: '' };
  delete lean._confidence;

  sendSuccess(res, {
    message: 'Optimised resume ready',
    data: {
      engine: result.engine,
      engineNote: result.engineNote,
      failureReason: result.failureReason,
      warnings,
      rejections: (result.rejections || []).slice(0, 40),
      considered: result.summary?.bulletsConsidered ?? null,
      applied: true,
      mode: analysis.jobIntel ? 'job-matched' : 'general',
      optimizedResume: lean,
      changelog,
      comparison,
      pendingProposals: pending,
      scores: { before: summarizeAnalysis(analysis), after: summarizeAnalysis(after) },
      keywords: keywordReport(after),
      remaining: {
        issues: after.health?.whatNeedsImprovement || [],
        recommendations: (after.recommendations || []).slice(0, 4).map((r) => ({ id: r.id, title: r.title, body: r.body })),
        confirmationQuestions: (after.questions || []).slice(0, 6),
      },
      integrity: { passed: integrity.passed, blocked: integrity.blocked },
      disclaimer:
        'This is an estimate. Different employers configure their applicant tracking systems differently, so no tool can guarantee a score.',
    },
  });
});

/** POST /api/career/optimize/apply */
export const applyOptimization = asyncHandler(async (req, res) => {
  const { resume, doc } = await resolveResume(req);
  const { decisions = [], proposals = [] } = req.body || {};

  if (!Array.isArray(proposals) || !proposals.length) {
    throw ApiError.badRequest('Send the proposals alongside your decisions so we can apply exactly what you reviewed.');
  }

  const { resume: updated, changelog } = applyDecisions(resume, decisions, proposals);
  const comparison = buildComparison(resume, updated, changelog);

  const baseline = baselineFor(doc, resume);
  const analysis = analyzeCandidate(updated, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: await configOverride(),
  });

  const qc = runQualityControl(updated, baseline, {
    health: analysis.health,
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    profile: analysis.profile,
    confirmedFacts: doc?.confirmedFacts || [],
  });

  sendSuccess(res, {
    message: 'Changes applied',
    data: { resume: updated, comparison, health: analysis.health, match: analysis.match, qualityControl: qc },
  });
});

/* ------------------------------------------------------------------ *
 * Versions (spec §17, §42, §43)
 * ------------------------------------------------------------------ */

/** POST /api/career/versions — create a targeted version from the master. */
export const createVersion = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id, { create: true });
  if (!doc.master) throw ApiError.badRequest('Upload your CV first — targeted versions are derived from your master profile.');

  const master = parseResumeJson(doc.master);
  const override = await configOverride();

  const analysis = analyzeCandidate(master, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc.confirmedFacts,
    configOverride: override,
  });

  // The master is read, never written. The derived version shortens less
  // relevant roles without deleting anything from the master (spec §44).
  const targeted = req.body?.resume
    ? parseResumeJson(req.body.resume)
    : deriveTargetedResume(master, { jobIntel: analysis.jobIntel, keywordResult: analysis.keywords });

  const targetedAnalysis = analyzeCandidate(targeted, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc.confirmedFacts,
    configOverride: override,
  });

  const label =
    req.body?.label?.trim() ||
    [analysis.jobIntel?.role?.jobTitle, analysis.jobIntel?.role?.company].filter(Boolean).join(' — ') ||
    `Version ${doc.versions.length + 1}`;

  doc.versions.push({
    label,
    kind: req.body?.kind || 'targeted',
    resume: targeted,
    target: {
      jobTitle: analysis.jobIntel?.role?.jobTitle || req.body?.jobHints?.jobTitle || '',
      company: analysis.jobIntel?.role?.company || req.body?.jobHints?.company || '',
      country: req.body?.jobHints?.country || doc.preferences?.country || '',
      jobDescription: req.body?.jobDescription || '',
      job: req.body?.jobId || undefined,
    },
    templateId: req.body?.templateId || targetedAnalysis.suggestedTemplate,
    health: { score: targetedAnalysis.health.score, categories: targetedAnalysis.health.categories },
    match: targetedAnalysis.match ? { overall: targetedAnalysis.match.overall, dimensions: targetedAnalysis.match.dimensions } : undefined,
  });

  doc.touchRetention();
  await doc.save();

  const created = doc.versions[doc.versions.length - 1];

  sendSuccess(res, {
    statusCode: 201,
    message: 'Targeted version created',
    data: {
      version: created,
      analysis: targetedAnalysis,
      masterUntouched: true,
      note: 'Your master profile is unchanged. Roles less relevant to this job were shortened in this version only — nothing was deleted from your full history.',
    },
  });
});

/** GET /api/career/versions */
export const listVersions = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id);
  sendSuccess(res, {
    message: 'Resume versions',
    data: (doc?.versions || []).map((v) => ({
      id: v._id,
      label: v.label,
      kind: v.kind,
      target: v.target,
      templateId: v.templateId,
      health: v.health,
      match: v.match,
      integrity: v.integrity,
      exportCount: v.exportCount,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    })),
  });
});

/** GET /api/career/versions/:versionId */
export const getVersion = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id);
  const version = doc?.versions?.id(req.params.versionId);
  if (!version) throw ApiError.notFound('That resume version does not exist.');
  sendSuccess(res, { message: 'Resume version', data: version });
});

/** PUT /api/career/versions/:versionId */
export const updateVersion = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id);
  const version = doc?.versions?.id(req.params.versionId);
  if (!version) throw ApiError.notFound('That resume version does not exist.');

  if (version.kind === 'original') {
    throw ApiError.badRequest('The original upload is kept as your verified baseline and cannot be edited. Create a new version instead.');
  }

  if (req.body?.resume) version.resume = applyEdit(version.resume, req.body.resume);
  if (req.body?.label) version.label = String(req.body.label).trim().slice(0, 120);
  if (req.body?.templateId) version.templateId = req.body.templateId;

  doc.touchRetention();
  await doc.save();

  sendSuccess(res, { message: 'Version updated', data: version });
});

/** DELETE /api/career/versions/:versionId */
export const deleteVersion = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id);
  const version = doc?.versions?.id(req.params.versionId);
  if (!version) throw ApiError.notFound('That resume version does not exist.');
  if (version.kind === 'original') throw ApiError.badRequest('The original upload is your verified baseline and cannot be deleted while your profile exists.');

  version.deleteOne();
  await doc.save();
  sendSuccess(res, { message: 'Version deleted', data: { deleted: true } });
});

/** POST /api/career/versions/:versionId/restore — make a version the master. */
export const restoreVersion = asyncHandler(async (req, res) => {
  const doc = await getProfileDoc(req.user._id);
  const version = doc?.versions?.id(req.params.versionId);
  if (!version) throw ApiError.notFound('That resume version does not exist.');

  // Restoring copies into the master; the version itself is left in place
  // so the history stays complete (spec §42).
  doc.master = applyEdit(doc.master || version.resume, version.resume);
  doc.touchRetention();
  await doc.save();

  sendSuccess(res, { message: `Restored "${version.label}" into your master profile`, data: { master: doc.master } });
});

/* ------------------------------------------------------------------ *
 * Validation and export (spec §27, §33)
 * ------------------------------------------------------------------ */

/** POST /api/career/validate */
export const validate = asyncHandler(async (req, res) => {
  const { resume, doc } = await resolveResume(req);
  const baseline = baselineFor(doc, resume);

  const analysis = analyzeCandidate(resume, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: await configOverride(),
  });

  const qc = runQualityControl(resume, baseline, {
    health: analysis.health,
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    profile: analysis.profile,
    confirmedFacts: doc?.confirmedFacts || [],
  });

  sendSuccess(res, { message: qc.exportBlocked ? 'Issues need your attention before export' : 'Validation passed', data: qc });
});

/** GET /api/career/templates */
export const getTemplates = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Templates', data: listTemplates() });
});

/** POST /api/career/render */
export const render = asyncHandler(async (req, res) => {
  const { resume } = await resolveResume(req);
  const templateId = req.body?.templateId || suggestTemplate(null, null);
  const { html, css, template } = renderResume(resume, templateId, { fragment: true });
  sendSuccess(res, { message: 'Rendered', data: { html, css, template } });
});

/**
 * POST /api/career/export
 *
 * Returns a complete, self-contained HTML document the client prints to
 * PDF. Export is refused while a high-severity integrity finding stands,
 * unless the candidate explicitly acknowledges it (spec §33).
 */
export const exportResume = asyncHandler(async (req, res) => {
  const { resume, doc, version } = await resolveResume(req);
  const baseline = baselineFor(doc, resume);

  const analysis = analyzeCandidate(resume, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: await configOverride(),
  });

  const qc = runQualityControl(resume, baseline, {
    health: analysis.health,
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    profile: analysis.profile,
    confirmedFacts: doc?.confirmedFacts || [],
  });

  if (qc.exportBlocked && !req.body?.acknowledgeIssues) {
    throw ApiError.badRequest(
      `${qc.blockingIssues.length} issue${qc.blockingIssues.length === 1 ? '' : 's'} need your confirmation before export: ${qc.blockingIssues.map((i) => i.label).join(', ')}.`,
      // Structured copy so the client can list the issues, not just show one sentence.
      qc.blockingIssues.map((i) => ({ field: 'integrity', message: i.label, detail: i.detail }))
    );
  }

  const templateId = req.body?.templateId || version?.templateId || analysis.suggestedTemplate;
  const { html } = renderResume(resume, templateId);

  if (version) {
    version.exportedAt = new Date();
    version.exportCount = (version.exportCount || 0) + 1;
    version.integrity = {
      passed: qc.integrity.passed,
      blocked: qc.integrity.blocked,
      findingCount: qc.integrity.summary.total,
      checkedAt: new Date(),
    };
    await doc.save();
  }

  sendSuccess(res, {
    message: 'Resume ready to download',
    data: {
      html,
      templateId,
      fileName: `${(resume.personal?.name || 'resume').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}-${templateId}.pdf`,
      qualityControl: qc,
      acknowledged: Boolean(req.body?.acknowledgeIssues),
    },
  });
});

/* ------------------------------------------------------------------ *
 * Career tools (spec §24, §25, §26)
 * ------------------------------------------------------------------ */

async function toolContext(req) {
  const { resume, doc } = await resolveResume(req);
  const analysis = analyzeCandidate(resume, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: await configOverride(),
  });
  return { resume, doc, analysis };
}

/** POST /api/career/linkedin */
export const linkedin = asyncHandler(async (req, res) => {
  const { resume, doc, analysis } = await toolContext(req);
  const data = await generateLinkedIn(resume, {
    profile: analysis.profile,
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    confirmedFacts: doc?.confirmedFacts || [],
  });
  sendSuccess(res, { message: 'LinkedIn recommendations', data });
});

/** POST /api/career/cover-letter */
export const coverLetter = asyncHandler(async (req, res) => {
  const { resume, doc, analysis } = await toolContext(req);
  const data = await generateCoverLetter(resume, {
    profile: analysis.profile,
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    company: req.body?.company,
    hiringManager: req.body?.hiringManager,
    tone: req.body?.tone,
    confirmedFacts: doc?.confirmedFacts || [],
  });
  sendSuccess(res, { message: 'Cover letter drafted', data });
});

/** POST /api/career/interview */
export const interview = asyncHandler(async (req, res) => {
  const { resume, doc, analysis } = await toolContext(req);
  const data = await generateInterviewPrep(resume, {
    profile: analysis.profile,
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    confirmedFacts: doc?.confirmedFacts || [],
  });
  sendSuccess(res, { message: 'Interview preparation', data });
});