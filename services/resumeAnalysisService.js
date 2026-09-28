/**
 * Resume Analysis Service
 *
 * Sends the resume file to MagicalAPI's Resume Checker endpoint and maps the
 * response to the shape the rest of DutyLaunch expects:
 *
 *   { score, categoryScores, strengths, weaknesses, recommendations, suggested }
 *
 * The seven category keys match the labels declared in AtsScoreReport.jsx so
 * the UI renders them with the right names automatically.
 *
 * Fallback: if MAGICAL_API_KEY is not set we run the original heuristic engine
 * so local development keeps working without an API key.
 *
 * MagicalAPI docs: https://docs.magicalapi.com/
 */

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

const MAGICAL_ENDPOINT = 'https://api.magicalapi.com/api/v1/resume-review/';

/* ──────────────────────────────────────────────────────────────────────────
 * MagicalAPI integration
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Convert MagicalAPI's pros/cons count for a section into a 0-100 score.
 * Each pro adds weight, each con removes it.  When both are zero we default
 * to 50 so we never surface a misleadingly perfect or terrible sub-score for
 * a section the API did not actually evaluate.
 */
function sectionScore(section) {
  if (!section) return 50;
  const pros = (section.pros || []).length;
  const cons = (section.cons || []).length;
  if (pros + cons === 0) return 50;
  return Math.round((pros / (pros + cons)) * 100);
}

function extractStrengths(result) {
  return Object.values(result || {})
    .flatMap((s) => s?.pros || [])
    .filter(Boolean)
    .slice(0, 6);
}

function extractWeaknesses(result) {
  return Object.values(result || {})
    .flatMap((s) => (s?.cons || []).map((c) => (typeof c === 'string' ? c : c?.message)).filter(Boolean))
    .slice(0, 6);
}

function extractRecommendations(result) {
  return [
    ...new Set(
      Object.values(result || {})
        .flatMap((s) => (s?.cons || []).flatMap((c) => (typeof c === 'object' ? c?.tips || [] : [])))
        .filter(Boolean)
    ),
  ].slice(0, 8);
}

async function analyzeWithMagicalApi({ buffer, mimetype, originalname }) {
  // Use Node 18's built-in FormData and fetch — no extra packages needed.
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimetype });
  form.append('resume_file', blob, originalname || 'resume.pdf');

  let res;
  try {
    res = await fetch(MAGICAL_ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': env.magicalApiKey },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw ApiError.internal(`MagicalAPI network error: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.message || body?.detail || `MagicalAPI responded with ${res.status}`;
    if (res.status === 401 || res.status === 403) throw ApiError.internal('MagicalAPI key is invalid or has expired. Check MAGICAL_API_KEY in your environment.');
    if (res.status === 402) throw ApiError.internal('MagicalAPI credit balance is zero. Top up at magicalapi.com/pricing.');
    throw ApiError.internal(msg);
  }

  const data = await res.json();

  /*
   * MagicalAPI sections  →  DutyLaunch category keys
   *   contact             →  contact
   *   format              →  formatting
   *   experiences         →  experience    (also feeds keywords/achievements)
   *   skills              →  skills
   *   educations          →  education
   *   summary             →  (used for suggestions, not a direct category)
   *
   * Two DutyLaunch categories (keywords, achievements) have no direct
   * MagicalAPI equivalent, so they are approximated from related sections.
   */
  const r = data.result || {};

  const categoryScores = {
    contact:      sectionScore(r.contact),
    formatting:   sectionScore(r.format),
    experience:   sectionScore(r.experiences),
    skills:       sectionScore(r.skills),
    education:    sectionScore(r.educations),
    // keywords  ≈ average of experiences + summary (keyword coverage proxy)
    keywords:     Math.round((sectionScore(r.experiences) + sectionScore(r.summary)) / 2),
    // achievements ≈ experience section (quantified bullet quality proxy)
    achievements: sectionScore(r.experiences),
  };

  const strengths       = extractStrengths(r);
  const weaknesses      = extractWeaknesses(r);
  const recommendations = extractRecommendations(r);

  // The API sometimes rewrites weak sections — surface the rewritten summary
  // if one exists so the frontend can show it as a suggestion.
  const suggested = data.suggested?.summary?.content || null;

  return {
    score: data.score ?? 0,
    categoryScores,
    strengths,
    weaknesses,
    recommendations,
    suggested,       // AI-rewritten summary, shown in the frontend if present
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Local heuristic fallback (used when MAGICAL_API_KEY is not configured)
 * ────────────────────────────────────────────────────────────────────────── */

const ACTION_VERBS = [
  'achieved', 'built', 'created', 'delivered', 'designed', 'developed', 'drove',
  'engineered', 'executed', 'generated', 'improved', 'increased', 'initiated',
  'launched', 'led', 'managed', 'optimized', 'orchestrated', 'reduced',
  'resolved', 'scaled', 'spearheaded', 'streamlined', 'strengthened',
  'transformed', 'implemented', 'automated', 'negotiated', 'mentored', 'won',
];

const SKILL_KEYWORDS = [
  'javascript', 'typescript', 'python', 'java', 'react', 'node', 'express',
  'mongodb', 'sql', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git',
  'agile', 'scrum', 'project management', 'communication', 'leadership',
  'excel', 'powerpoint', 'salesforce', 'sap', 'figma', 'seo', 'marketing',
  'analytics', 'data analysis', 'machine learning', 'ai', 'html', 'css',
  'accounting', 'finance', 'negotiation', 'customer service', 'sales',
  'operations', 'compliance', 'logistics', 'hr', 'recruitment',
];

const SECTION_HEADINGS = {
  experience:   /(work\s+experience|professional\s+experience|experience|employment\s+history)/i,
  education:    /(education|academic\s+background|qualifications)/i,
  skills:       /(skills|technical\s+skills|core\s+competencies|key\s+skills)/i,
  summary:      /(summary|professional\s+summary|objective|profile)/i,
  achievements: /(achievements|accomplishments|awards|honors)/i,
};

const EMAIL_RE    = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;
const PHONE_RE    = /(\+?\d[\d\s().-]{7,}\d)/;
const LINKEDIN_RE = /linkedin\.com\/[\w-/]+/i;
const QUANTIFIED_RE = /\b\d+(\.\d+)?\s?(%|percent|x|k|m|million|billion|\+)?\b/gi;

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

export async function extractText(buffer, mimetype) {
  try {
    if (mimetype === 'application/pdf') {
      const result = await pdfParse(buffer);
      return result.text || '';
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
    if (mimetype === 'application/msword') {
      return buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ');
    }
  } catch {
    throw ApiError.badRequest("We couldn't analyze this resume. Please try again.");
  }
  throw ApiError.badRequest('Please upload a PDF, DOC, or DOCX file.');
}

export function analyzeResumeText(text) {
  if (!text || text.trim().length < 40) throw ApiError.badRequest("We couldn't extract enough text from this file.");

  const lower = text.toLowerCase();

  // Contact
  const hasEmail    = EMAIL_RE.test(text);
  const hasPhone    = PHONE_RE.test(text);
  const hasLinkedin = LINKEDIN_RE.test(text);
  const contactScore = clamp((hasEmail ? 45 : 0) + (hasPhone ? 35 : 0) + (hasLinkedin ? 20 : 0));

  // Formatting
  const words = text.trim().split(/\s+/).filter(Boolean);
  let fmtScore = 100;
  if (words.length < 150) fmtScore -= 40;
  else if (words.length < 250) fmtScore -= 15;
  else if (words.length > 1200) fmtScore -= 20;
  const oddCharRatio = (text.match(/[^\x00-\x7F]/g) || []).length / Math.max(text.length, 1);
  if (oddCharRatio > 0.03) fmtScore -= 15;

  // Sections
  const sectionFound = Object.fromEntries(
    Object.entries(SECTION_HEADINGS).map(([k, re]) => [k, re.test(text)])
  );

  // Keywords
  const matched   = SKILL_KEYWORDS.filter((kw) => lower.includes(kw));
  const kwScore   = clamp(30 + (matched.length / SKILL_KEYWORDS.length) * 300);

  // Experience
  const dateCount  = (text.match(/\b(19|20)\d{2}\b/g) || []).length;
  const verbHits   = ACTION_VERBS.filter((v) => new RegExp(`\\b${v}`, 'i').test(text)).length;
  const expScore   = clamp((sectionFound.experience ? 40 : 0) + (dateCount >= 2 ? 25 : dateCount === 1 ? 10 : 0) + Math.min(35, verbHits * 4));

  // Skills
  const skillScore = clamp(kwScore * 0.7 + (/skills/i.test(text) ? 30 : 0));

  // Education
  const eduScore = sectionFound.education ? 90 : 20;

  // Achievements
  const quantified = (text.match(QUANTIFIED_RE) || []).length;
  const achScore   = clamp(20 + (sectionFound.achievements ? 25 : 0) + Math.min(55, quantified * 3));

  const categoryScores = {
    contact: contactScore, formatting: clamp(fmtScore), keywords: kwScore,
    experience: expScore,  skills: skillScore,          education: eduScore,
    achievements: achScore,
  };

  const weights = { contact: 0.1, formatting: 0.15, keywords: 0.2, experience: 0.2, skills: 0.15, education: 0.1, achievements: 0.1 };
  const score   = clamp(Object.entries(weights).reduce((s, [k, w]) => s + categoryScores[k] * w, 0));

  const strengths = [], weaknesses = [], recommendations = [];
  if (hasEmail && hasPhone) strengths.push('Strong contact information — email and phone are both present.');
  else weaknesses.push('Missing key contact details.');
  if (!hasEmail)    recommendations.push('Add a professional email address near the top of your resume.');
  if (!hasPhone)    recommendations.push('Include a phone number so recruiters can reach you directly.');
  if (!hasLinkedin) recommendations.push('Add your LinkedIn profile URL to strengthen your contact section.');
  if (clamp(fmtScore) >= 80) strengths.push('Clean, ATS-friendly formatting with a well-balanced resume length.');
  else { weaknesses.push('Formatting may be difficult for ATS software to parse.'); recommendations.push('Reduce excessive formatting (tables, columns, graphics) that ATS parsers struggle with.'); }
  if (words.length < 250) recommendations.push('Your resume looks short — add more detail on your experience and impact.');
  if (words.length > 1200) recommendations.push('Your resume is quite long — tighten it to the most relevant achievements.');
  if (kwScore >= 70) strengths.push('Good keyword coverage across common industry and technical terms.');
  else { weaknesses.push('Limited keyword alignment.'); recommendations.push('Add more role-relevant keywords that match your target job descriptions.'); }
  if (sectionFound.experience) strengths.push('Clear, labeled work experience section.');
  else { weaknesses.push('No clearly labeled experience section found.'); recommendations.push('Add a clearly labeled "Work Experience" section with dated roles.'); }
  if (skillScore >= 70) strengths.push('Good skills coverage.');
  else recommendations.push('Add a dedicated "Skills" section listing your key technical and soft skills.');
  if (sectionFound.education) strengths.push('Education section is present and easy to identify.');
  else recommendations.push('Add a clearly labeled "Education" section.');
  if (quantified >= 4) strengths.push('Achievements are backed by numbers and measurable impact.');
  else recommendations.push('Add measurable achievements (e.g. "increased sales by 20%", "managed a team of 8").');
  if (verbHits < 4) recommendations.push('Use more action verbs (e.g. "led", "built", "delivered") to open bullet points.');

  return {
    score,
    categoryScores,
    strengths:       strengths.slice(0, 6),
    weaknesses:      weaknesses.slice(0, 6),
    recommendations: [...new Set(recommendations)].slice(0, 8),
    suggested: null,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main export — called by resumeController.js
 * ────────────────────────────────────────────────────────────────────────── */

export async function analyzeResumeFile({ buffer, mimetype, originalname }) {
  // Use MagicalAPI when the key is configured, fall back to local heuristics.
  if (env.magicalApiKey) {
    return analyzeWithMagicalApi({ buffer, mimetype, originalname });
  }

  // Fallback: parse locally and run heuristics (no API key needed).
  const text = await extractText(buffer, mimetype);
  return analyzeResumeText(text);
}
