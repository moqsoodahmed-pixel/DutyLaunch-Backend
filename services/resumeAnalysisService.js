import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { ApiError } from '../utils/ApiError.js';

/**
 * DutyLaunch ATS Compatibility Score
 * -----------------------------------
 * An internal, heuristic assessment of how well a resume is likely to be
 * parsed and ranked by common Applicant Tracking Systems. It is NOT an
 * official score from any specific ATS vendor.
 */

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
  experience: /(work\s+experience|professional\s+experience|experience|employment\s+history)/i,
  education: /(education|academic\s+background|qualifications)/i,
  skills: /(skills|technical\s+skills|core\s+competencies|key\s+skills)/i,
  summary: /(summary|professional\s+summary|objective|profile)/i,
  achievements: /(achievements|accomplishments|awards|honors)/i,
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const LINKEDIN_RE = /linkedin\.com\/[\w-/]+/i;
const QUANTIFIED_RE = /\b\d+(\.\d+)?\s?(%|percent|x|k|m|million|billion|\+)?\b/gi;

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function extractText(buffer, mimetype) {
  try {
    if (mimetype === 'application/pdf') {
      const result = await pdfParse(buffer);
      return result.text || '';
    }
    if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
    if (mimetype === 'application/msword') {
      // Legacy .doc — best-effort plain-text fallback.
      return buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ');
    }
  } catch {
    throw ApiError.badRequest("We couldn't analyze this resume. Please try again.");
  }
  throw ApiError.badRequest('Please upload a PDF, DOC, or DOCX file.');
}

function scoreContact(text) {
  let score = 0;
  const has = { email: EMAIL_RE.test(text), phone: PHONE_RE.test(text), linkedin: LINKEDIN_RE.test(text) };
  if (has.email) score += 45;
  if (has.phone) score += 35;
  if (has.linkedin) score += 20;
  return { score: clamp(score), has };
}

function scoreFormatting(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  let score = 100;

  // Length: sweet spot ~350-900 words (roughly 1-2 pages).
  if (wordCount < 150) score -= 40;
  else if (wordCount < 250) score -= 15;
  else if (wordCount > 1200) score -= 20;
  else if (wordCount > 900) score -= 8;

  // Excess whitespace / odd characters often mean a table/column layout
  // that ATS parsers mangle.
  const oddCharRatio = (text.match(/[^\x00-\x7F]/g) || []).length / Math.max(text.length, 1);
  if (oddCharRatio > 0.03) score -= 15;

  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const veryShortLineRatio = lines.filter((l) => l.trim().length < 3).length / Math.max(lines.length, 1);
  if (veryShortLineRatio > 0.25) score -= 10;

  return { score: clamp(score), wordCount };
}

function scoreSections(text) {
  const found = Object.entries(SECTION_HEADINGS).filter(([, re]) => re.test(text));
  const experienceFound = found.some(([k]) => k === 'experience');
  const educationFound = found.some(([k]) => k === 'education');
  const skillsFound = found.some(([k]) => k === 'skills');
  const achievementsFound = found.some(([k]) => k === 'achievements');
  return { experienceFound, educationFound, skillsFound, achievementsFound, foundCount: found.length };
}

function scoreKeywords(text) {
  const lower = text.toLowerCase();
  const matched = SKILL_KEYWORDS.filter((kw) => lower.includes(kw));
  const density = matched.length / SKILL_KEYWORDS.length;
  const score = clamp(30 + density * 300); // reward breadth, cap at 100
  return { score: clamp(score), matched };
}

function scoreExperience(text, sections) {
  let score = 0;
  if (sections.experienceFound) score += 40;
  const dateRanges = (text.match(/\b(19|20)\d{2}\b/g) || []).length;
  if (dateRanges >= 2) score += 25;
  else if (dateRanges === 1) score += 10;
  const verbHits = ACTION_VERBS.filter((v) => new RegExp(`\\b${v}`, 'i').test(text)).length;
  score += Math.min(35, verbHits * 4);
  return { score: clamp(score), verbHits };
}

function scoreSkills(text, keywordResult) {
  let score = keywordResult.score * 0.7;
  if (/skills/i.test(text)) score += 30;
  return { score: clamp(score) };
}

function scoreEducation(sections) {
  return { score: sections.educationFound ? 90 : 20 };
}

function scoreAchievements(text, sections) {
  const quantified = (text.match(QUANTIFIED_RE) || []).length;
  let score = 20;
  if (sections.achievementsFound) score += 25;
  score += Math.min(55, quantified * 3);
  return { score: clamp(score), quantified };
}

export function analyzeResumeText(text) {
  if (!text || text.trim().length < 40) {
    throw ApiError.badRequest("We couldn't extract enough text from this file.");
  }

  const contact = scoreContact(text);
  const formatting = scoreFormatting(text);
  const sections = scoreSections(text);
  const keywords = scoreKeywords(text);
  const experience = scoreExperience(text, sections);
  const skills = scoreSkills(text, keywords);
  const education = scoreEducation(sections);
  const achievements = scoreAchievements(text, sections);

  const categoryScores = {
    contact: contact.score,
    formatting: formatting.score,
    keywords: keywords.score,
    experience: experience.score,
    skills: skills.score,
    education: education.score,
    achievements: achievements.score,
  };

  const weights = {
    contact: 0.1,
    formatting: 0.15,
    keywords: 0.2,
    experience: 0.2,
    skills: 0.15,
    education: 0.1,
    achievements: 0.1,
  };

  const overallScore = clamp(
    Object.entries(weights).reduce((sum, [key, w]) => sum + categoryScores[key] * w, 0)
  );

  const strengths = [];
  const weaknesses = [];
  const recommendations = [];

  if (contact.has.email && contact.has.phone) strengths.push('Strong contact information — email and phone are both present.');
  else weaknesses.push('Missing key contact details.');
  if (!contact.has.email) recommendations.push('Add a professional email address near the top of your resume.');
  if (!contact.has.phone) recommendations.push('Include a phone number so recruiters can reach you directly.');
  if (!contact.has.linkedin) recommendations.push('Add your LinkedIn profile URL to strengthen your contact section.');

  if (formatting.score >= 80) strengths.push('Clean, ATS-friendly formatting with a well-balanced resume length.');
  else weaknesses.push('Formatting may be difficult for ATS software to parse.');
  if (formatting.wordCount < 250) recommendations.push('Your resume looks short — add more detail on your experience and impact.');
  if (formatting.wordCount > 1200) recommendations.push('Your resume is quite long — tighten it to the most relevant achievements.');

  if (keywords.score >= 70) strengths.push('Good keyword coverage across common industry and technical terms.');
  else weaknesses.push('Limited keyword alignment with what ATS systems typically scan for.');
  if (keywords.score < 70) recommendations.push('Add more role-relevant keywords and technical/soft skills that match your target job descriptions.');

  if (sections.experienceFound) strengths.push('Clear, labeled work experience section.');
  else { weaknesses.push('No clearly labeled experience section was found.'); recommendations.push('Add a clearly labeled "Work Experience" section with dated roles.'); }

  if (skills.score >= 70) strengths.push('Good skills coverage.');
  else recommendations.push('Add a dedicated "Skills" section listing your key technical and soft skills.');

  if (sections.educationFound) strengths.push('Education section is present and easy to identify.');
  else recommendations.push('Add a clearly labeled "Education" section.');

  if (achievements.quantified >= 4) strengths.push('Achievements are backed by numbers and measurable impact.');
  else recommendations.push('Add more measurable achievements (e.g. "increased sales by 20%", "managed a team of 8").');

  if (experience.verbHits < 4) recommendations.push('Use more strong action verbs (e.g. "led", "built", "delivered") to open your bullet points.');

  if (formatting.score < 90) recommendations.push('Reduce excessive formatting (tables, columns, graphics) that ATS parsers can struggle with.');

  return {
    score: overallScore,
    categoryScores,
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 6),
    recommendations: [...new Set(recommendations)].slice(0, 8),
  };
}

export async function analyzeResumeFile({ buffer, mimetype }) {
  const text = await extractText(buffer, mimetype);
  return analyzeResumeText(text);
}
