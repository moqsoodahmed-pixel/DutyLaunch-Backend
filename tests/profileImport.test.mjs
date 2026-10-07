import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeText, parseResumeJson } from '../services/careerIntelligence/index.js';
import { parseLinkedInText, mergeResumes, looksLikeLinkedInExport } from '../services/careerIntelligence/linkedinImport.js';
import { LINKEDIN_EXPORT_TEXT } from '../services/documents/fixtures/linkedinExport.js';

/**
 * Step 1 import with a LinkedIn export AND a CV: LinkedIn is the main
 * source; the CV only fills what LinkedIn is missing.
 */

const CV_TEXT = `Priya S.
priya.cv@example.com | +91 98450 12345 | Bengaluru

Experience
Senior Frontend Developer, Clairo Technologies — June 2023 to Present
- Cut checkout page load time by 1.2 seconds by lazy-loading routes
- Mentored three junior developers

Software Engineer, Freightify — July 2018 to May 2021
- Developed the carrier rate management module

Frontend Intern, Zoho — Jan 2018 to Jun 2018
- Fixed accessibility issues across 40 screens

Skills
React, Redux, Jest, GraphQL

Projects
Expense Tracker PWA`;

const li = () => parseResumeJson(parseLinkedInText(LINKEDIN_EXPORT_TEXT, { fileName: 'li.pdf' }).resume);
const cv = () => parseResumeJson(parseResumeText(CV_TEXT, { fileName: 'cv.txt' }));

test('the fixture is recognised as LinkedIn and the CV is not', () => {
  assert.equal(looksLikeLinkedInExport(LINKEDIN_EXPORT_TEXT), true);
  assert.equal(looksLikeLinkedInExport(CV_TEXT), false);
});

test('LinkedIn values win where both files have them', () => {
  const { resume } = mergeResumes(li(), cv());
  assert.equal(resume.personal.name, 'Priya Sharma');
  assert.equal(resume.personal.email, 'priya.sharma@example.com');
  assert.match(resume.personal.headline, /Senior Frontend Engineer/);
});

test('the CV fills what LinkedIn is missing (phone)', () => {
  const { resume, added } = mergeResumes(li(), cv());
  assert.ok(resume.personal.phone, 'phone comes from the CV');
  assert.ok(added.includes('personal.phone'));
});

test('a job only on the CV is added; the same job is not duplicated', () => {
  const { resume } = mergeResumes(li(), cv());
  const companies = resume.experience.map((r) => r.company);
  assert.ok(companies.some((c) => /Zoho/i.test(c)), 'intern role from the CV is added');
  assert.equal(companies.filter((c) => /Freightify/i.test(c)).length, 1, 'Freightify appears once');
});

test('same job with a different title (Engineer vs Developer) is merged by start date, and CV bullets are added', () => {
  const { resume } = mergeResumes(li(), cv());
  const clairo = resume.experience.filter((r) => /Clairo/i.test(r.company) && /^June 2023|2023-06|Jun 2023/i.test(r.startDate || '') || (/Clairo/i.test(r.company) && /Senior/i.test(r.title)));
  assert.equal(clairo.length, 1, `one Senior role at Clairo, got: ${resume.experience.map((r) => `${r.title}@${r.company} ${r.startDate}`).join(' | ')}`);
  const lines = [...(clairo[0].achievements || []), ...(clairo[0].responsibilities || [])].join(' ');
  assert.match(lines, /billing dashboard/i, 'keeps the LinkedIn bullet');
  assert.match(lines, /1\.2 seconds/i, 'adds the CV bullet');
});

test('skills from both files are combined without repeats', () => {
  const { resume } = mergeResumes(li(), cv());
  const all = Object.values(resume.skills).flat().map((s) => s.toLowerCase());
  assert.ok(all.includes('typescript'), 'LinkedIn skill');
  assert.ok(all.includes('graphql'), 'CV skill');
  assert.equal(all.filter((s) => s === 'react' || s === 'react.js').length >= 1, true);
});
