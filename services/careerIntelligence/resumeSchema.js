/**
 * The DutyLaunch Resume JSON contract (spec §3).
 *
 * Every agent in the pipeline reads and writes this one shape, and every
 * template renders from it. Nothing downstream is allowed to invent a new
 * field shape — if a template needs something, it belongs here first.
 *
 * Two hard rules this file enforces:
 *   1. Optional sections stay optional. An empty array is meaningful
 *      ("candidate has none"), never a parse failure.
 *   2. `_source` is immutable provenance. The parser writes the candidate's
 *      original wording there and nothing ever overwrites it (spec §4).
 */

import { z } from 'zod';

/** Evidence classification applied to any generated claim (spec §2, §9). */
export const EVIDENCE = Object.freeze({
  VERIFIED: 'VERIFIED',
  INFERRED: 'INFERRED',
  UNVERIFIED: 'UNVERIFIED',
  MISSING: 'MISSING',
});

export const EVIDENCE_LEVELS = Object.values(EVIDENCE);

/* ------------------------------------------------------------------ *
 * Empty-document factory
 * ------------------------------------------------------------------ */

export function emptyResume() {
  return {
    schemaVersion: 1,
    personal: {
      name: '',
      headline: '',
      email: '',
      phone: '',
      location: '',
      linkedin: '',
      website: '',
    },
    target: {
      jobTitle: '',
      industry: '',
      country: '',
      seniority: '',
      jobDescription: '',
    },
    summary: '',
    experience: [],
    education: [],
    skills: { technical: [], functional: [], soft: [], tools: [], industry: [] },
    certifications: [],
    projects: [],
    achievements: [],
    awards: [],
    languages: [],
    volunteering: [],
    publications: [],
    professionalMemberships: [],
    portfolio: [],
    customSections: [],
    /* Provenance. Written once by the parser, never mutated (spec §4). */
    _source: {
      rawText: '',
      fileName: '',
      fileType: '',
      parsedAt: null,
      wasScanned: false,
      ocrUsed: false,
    },
    /* Per-field parse confidence, so the review step can flag guesses
       (spec §5). Shape: { 'experience.0.startDate': 0.4 } */
    _confidence: {},
    /* Fields the parser could not read at all — drives the review UI. */
    _needsReview: [],
  };
}

export function emptyExperience() {
  return {
    id: '',
    company: '',
    title: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    employmentType: '',
    responsibilities: [],
    achievements: [],
    skillsUsed: [],
    /* The candidate's own words for this role, preserved verbatim. */
    _originalText: '',
  };
}

export function emptyEducation() {
  return {
    id: '',
    institution: '',
    degree: '',
    field: '',
    location: '',
    startDate: '',
    endDate: '',
    grade: '',
    highlights: [],
    _originalText: '',
  };
}

/* ------------------------------------------------------------------ *
 * Zod contract — used to validate anything arriving from a client
 * (the resume editor PUTs the whole document back).
 * ------------------------------------------------------------------ */

const str = z.string().trim().max(2000).default('');
const strArray = z.array(z.string().trim().min(1).max(2000)).default([]);

export const experienceSchema = z.object({
  id: z.string().trim().max(64).optional().default(''),
  company: str,
  title: str,
  location: str,
  startDate: str,
  endDate: str,
  current: z.boolean().default(false),
  employmentType: str,
  responsibilities: strArray,
  achievements: strArray,
  skillsUsed: strArray,
  _originalText: z.string().max(20000).optional().default(''),
});

export const educationSchema = z.object({
  id: z.string().trim().max(64).optional().default(''),
  institution: str,
  degree: str,
  field: str,
  location: str,
  startDate: str,
  endDate: str,
  grade: str,
  highlights: strArray,
  _originalText: z.string().max(20000).optional().default(''),
});

export const projectSchema = z.object({
  id: z.string().trim().max(64).optional().default(''),
  name: str,
  role: str,
  description: str,
  technologies: strArray,
  link: str,
  startDate: str,
  endDate: str,
  highlights: strArray,
});

export const certificationSchema = z.object({
  name: str,
  issuer: str,
  issueDate: str,
  expiryDate: str,
  credentialId: str,
  link: str,
});

export const customSectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  items: strArray,
  body: str,
});

export const resumeSchema = z.object({
  schemaVersion: z.number().int().default(1),
  personal: z
    .object({
      name: str,
      headline: str,
      email: z.string().trim().max(160).default(''),
      phone: str,
      location: str,
      linkedin: str,
      website: str,
    })
    .default({}),
  target: z
    .object({
      jobTitle: str,
      industry: str,
      country: str,
      seniority: str,
      jobDescription: z.string().trim().max(40000).default(''),
    })
    .default({}),
  summary: z.string().trim().max(4000).default(''),
  experience: z.array(experienceSchema).max(40).default([]),
  education: z.array(educationSchema).max(20).default([]),
  skills: z
    .object({
      technical: strArray,
      functional: strArray,
      soft: strArray,
      tools: strArray,
      industry: strArray,
    })
    .default({}),
  certifications: z.array(certificationSchema).max(40).default([]),
  projects: z.array(projectSchema).max(40).default([]),
  achievements: strArray,
  awards: strArray,
  languages: z
    .array(z.object({ name: str, proficiency: str }).or(z.string().trim().max(120)))
    .max(20)
    .default([]),
  volunteering: strArray,
  publications: strArray,
  professionalMemberships: strArray,
  portfolio: strArray,
  customSections: z.array(customSectionSchema).max(15).default([]),
  _source: z
    .object({
      rawText: z.string().max(400000).default(''),
      fileName: str,
      fileType: str,
      parsedAt: z.union([z.string(), z.date(), z.null()]).optional().default(null),
      wasScanned: z.boolean().default(false),
      ocrUsed: z.boolean().default(false),
    })
    .default({}),
  _confidence: z.record(z.number().min(0).max(1)).default({}),
  _needsReview: strArray,
});

/**
 * Parses and normalises an arbitrary object into a valid Resume JSON.
 * Throws a ZodError the controller converts into a 422.
 */
export function parseResumeJson(input) {
  return resumeSchema.parse({ ...emptyResume(), ...(input || {}) });
}

/**
 * Merges an edit into an existing resume WITHOUT ever touching `_source`.
 * This is the only sanctioned write path for the resume editor — it makes
 * "never overwrite the candidate's original wording" (spec §4) a property
 * of the code rather than a rule people have to remember.
 */
export function applyEdit(current, patch) {
  const base = parseResumeJson(current);
  const next = parseResumeJson({ ...base, ...(patch || {}) });
  next._source = base._source; // provenance is immutable
  return next;
}

/** Every free-text string in the document, flattened. Used by the validator. */
export function collectText(resume) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };

  push(resume.summary);
  push(resume.personal?.headline);
  (resume.experience || []).forEach((e) => {
    push(e.company);
    push(e.title);
    (e.responsibilities || []).forEach(push);
    (e.achievements || []).forEach(push);
    (e.skillsUsed || []).forEach(push);
  });
  (resume.education || []).forEach((e) => {
    push(e.institution);
    push(e.degree);
    push(e.field);
    (e.highlights || []).forEach(push);
  });
  Object.values(resume.skills || {}).forEach((list) => (list || []).forEach(push));
  (resume.certifications || []).forEach((c) => {
    push(c.name);
    push(c.issuer);
  });
  (resume.projects || []).forEach((p) => {
    push(p.name);
    push(p.description);
    (p.highlights || []).forEach(push);
    (p.technologies || []).forEach(push);
  });
  (resume.achievements || []).forEach(push);
  (resume.awards || []).forEach(push);
  (resume.customSections || []).forEach((s) => {
    push(s.title);
    push(s.body);
    (s.items || []).forEach(push);
  });

  return out;
}

/** One lowercased haystack for substring matching. */
export function resumeHaystack(resume) {
  return collectText(resume).join('\n').toLowerCase();
}
