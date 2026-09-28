import { consentRecord } from '../utils/consent.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { CareerProfile, ScoringConfig, ResumeAnalysis } from '../models/index.js';
import { env } from '../config/env.js';

/* ------------------------------------------------------------------ *
 * MagicalAPI — inlined here to avoid a circular/missing export issue.
 * Sends the resume file to MagicalAPI and returns a normalised score
 * object.  Returns null on any failure so the caller can fall back
 * gracefully to the internal engine.
 * ------------------------------------------------------------------ */
async function analyzeWithMagicalApi({ buffer, mimetype, originalname }) {
  if (!env.magicalApiKey) return null;
  try {
    const form = new FormData();
    form.append('resume_file', new Blob([buffer], { type: mimetype }), originalname || 'resume.pdf');
    const res = await fetch('https://api.magicalapi.com/api/v1/resume-review/', {
      method: 'POST',
      headers: { 'x-api-key': env.magicalApiKey },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn('[MagicalAPI] non-OK response:', res.status);
      return null;
    }
    const data = await res.json();
    const r = data.result || {};
    const sc = (section) => {
      if (!section) return 50;
      const p = (section.pros || []).length;
      const c = (section.cons || []).length;
      return p + c === 0 ? 50 : Math.round((p / (p + c)) * 100);
    };
    return {
      score: data.score ?? null,
      categoryScores: {
        contact:      sc(r.contact),
        formatting:   sc(r.format),
        experience:   sc(r.experiences),
        skills:       sc(r.skills),
        education:    sc(r.educations),
        keywords:     Math.round((sc(r.experiences) + sc(r.summary)) / 2),
        achievements: sc(r.experiences),
      },
      strengths:       Object.values(r).flatMap(s => s?.pros || []).slice(0, 6),
      weaknesses:      Object.values(r).flatMap(s => (s?.cons || []).map(c => c?.message || c)).filter(Boolean).slice(0, 6),
      recommendations: [...new Set(Object.values(r).flatMap(s => (s?.cons || []).flatMap(c => c?.tips || [])).filter(Boolean))].slice(0, 8),
      suggested:       data.suggested?.summary?.content || null,
    };
  } catch (err) {
    console.warn('[MagicalAPI] error:', err.message);
    return null;
  }
}
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
  generateEvidenceQuestions,
  buildAchievementBullet,
  toConfirmedFacts,
  renderResume,
  listTemplates,
  suggestTemplate,
} from '../services/careerIntelligence/index.js';
import { generateLinkedIn, generateCoverLetter, generateInterviewPrep } from '../services/careerIntelligence/careerTools.js';

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
    const [parsedResume, magicalResult] = await Promise.all([
      parseResumeFile({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        fileName: req.file.originalname,
      }),
      analyzeWithMagicalApi({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      }).catch((err) => {
        console.warn('[MagicalAPI] scoring failed, using internal engine:', err.message);
        return null;
      }),
    ]);
    resume = parsedResume;
    resume._magicalScore = magicalResult || null;
  } else if (req.body?.text?.trim()) {
    resume = parseResumeText(req.body.text, { fileName: 'pasted.txt', fileType: 'text/plain' });
  } else {
    throw ApiError.badRequest('Attach a CV file or paste your resume text.');
  }

  // Signed in: this becomes the master profile and the immutable v1.
  if (req.user) {
    const doc = await getProfileDoc(req.user._id, { create: true });

    doc.master = resume;
    doc.consent = { ...(doc.consent?.toObject?.() || doc.consent || {}), dataProcessing: consentRecord(req) };
    doc.touchRetention();
    if (resume._magicalScore) doc.lastMagicalScore = resume._magicalScore;

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

  // Signed-in: MagicalAPI score was persisted on doc during parse.
  // Anonymous: score is on resume._magicalScore (sent inline by frontend).
  const magical = doc?.lastMagicalScore || resume._magicalScore || null;
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
    const catMap = {
      atsStructure:        mc.contact   ?? mc.formatting ?? null,
      achievementStrength: mc.achievements ?? mc.experience ?? null,
      skillsCoverage:      mc.skills    ?? null,
      readability:         mc.formatting ?? null,
      completeness:        mc.education ?? null,
      keywordAlignment:    mc.keywords  ?? null,
      experienceRelevance: mc.experience ?? null,
    };
    Object.entries(catMap).forEach(([key, val]) => {
      if (val !== null && analysis.health.categories[key]) {
        analysis.health.categories[key].score = val;
      }
    });

    if (magical.strengths?.length)  analysis.health.whatIsStrong           = magical.strengths;
    if (magical.weaknesses?.length) analysis.health.whatNeedsImprovement   = magical.weaknesses;
    if (magical.suggested)          analysis.health.suggestedSummary        = magical.suggested;
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
    return sendSuccess(res, { message: 'No career profile yet', data: { exists: false } });
  }

  return sendSuccess(res, {
    message: 'Career profile',
    data: {
      exists: true,
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
  sendSuccess(res, { message: 'Your career profile and analysis history have been deleted.', data: { deleted: true } });
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

/** POST /api/career/optimize — returns proposals for review. */
export const optimize = asyncHandler(async (req, res) => {
  const { resume, doc } = await resolveResume(req);
  const override = await configOverride();

  const analysis = analyzeCandidate(resume, {
    jobDescription: req.body?.jobDescription,
    jobHints: req.body?.jobHints || {},
    confirmedFacts: doc?.confirmedFacts || [],
    configOverride: override,
  });

  const result = await proposeRewrites(resume, {
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    profile: analysis.profile,
    confirmedFacts: doc?.confirmedFacts || [],
    scope: req.body?.scope || 'all',
  });

  sendSuccess(res, {
    message: 'Optimisation proposals ready',
    data: {
      ...result,
      /* Nothing has been changed yet. The candidate accepts, edits or
         rejects each proposal (spec §28). */
      applied: false,
      reviewNote: 'Every change is a proposal until you accept it. Each one shows why it was suggested.',
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