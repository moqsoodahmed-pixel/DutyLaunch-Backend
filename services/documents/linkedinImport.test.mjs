import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { parseLinkedInText, looksLikeLinkedInExport, normaliseLinkedInUrl, mergeResumes } from '../services/careerIntelligence/linkedinImport.js';
import { extractText, parseResumeText } from '../services/careerIntelligence/resumeParser.js';
import { parseResumeJson } from '../services/careerIntelligence/resumeSchema.js';
import { analyzeCandidate } from '../services/careerIntelligence/index.js';
import { LINKEDIN_EXPORT_TEXT } from './fixtures/linkedinExport.js';

test('detects a LinkedIn export, and not an ordinary CV', () => {
  assert.equal(looksLikeLinkedInExport(LINKEDIN_EXPORT_TEXT), true);
  assert.equal(looksLikeLinkedInExport('John Smith\nEXPERIENCE\nEngineer at X 2019-2022\nEDUCATION\nBSc'), false);
});

test('reads header, contact, sidebar and About', () => {
  const { resume, report } = parseLinkedInText(LINKEDIN_EXPORT_TEXT);
  assert.equal(resume.personal.name, 'Priya Sharma');
  assert.equal(resume.personal.headline, 'Senior Frontend Engineer at Clairo Technologies');
  assert.equal(resume.personal.location, 'Bengaluru, Karnataka, India');
  assert.equal(resume.personal.email, 'priya.sharma@example.com');
  assert.equal(resume.personal.linkedin, 'https://www.linkedin.com/in/priya-sharma-dev');
  assert.equal(resume.personal.website, 'priyasharma.dev');
  assert.deepEqual(resume.skills.technical, ['React.js', 'Node.js', 'TypeScript']);
  assert.equal(resume.languages[1].proficiency, 'Native or Bilingual');
  assert.equal(resume.certifications.length, 2);
  assert.match(resume.summary, /seven years building React/);
  assert.equal(report.status, 'imported');
});

test('groups two roles under one company and skips page footers', () => {
  const { resume } = parseLinkedInText(LINKEDIN_EXPORT_TEXT);
  const [a, b, c] = resume.experience;
  assert.equal(resume.experience.length, 3);
  assert.deepEqual([a.company, a.title, a.current, a.startDate], ['Clairo Technologies', 'Senior Frontend Engineer', true, '2023-06']);
  assert.equal(a.responsibilities.length, 2);
  assert.deepEqual([b.company, b.title, b.startDate, b.endDate], ['Clairo Technologies', 'Frontend Engineer', '2021-06', '2023-05']);
  assert.deepEqual(b.responsibilities, ['Built the design system used by four product teams.']);
  assert.deepEqual([c.company, c.title, c.location], ['Freightify', 'Software Engineer', 'Chennai, Tamil Nadu, India']);
  assert.ok(!JSON.stringify(resume.experience).includes('Page 1 of 2'));
});

test('reads education degree, field and years', () => {
  const { resume } = parseLinkedInText(LINKEDIN_EXPORT_TEXT);
  const [ed] = resume.education;
  assert.equal(ed.institution, 'Visvesvaraya Technological University');
  assert.equal(ed.degree, 'Bachelor of Engineering - BE');
  assert.equal(ed.field, 'Computer Science');
  assert.ok(ed.startDate.startsWith('2014') && ed.endDate.startsWith('2018'), `${ed.startDate}–${ed.endDate}`);
});

test('never invents data: an unreadable file is reported as needing manual input', () => {
  const { resume, report } = parseLinkedInText('random text\nnothing here');
  assert.equal(report.status, 'manual-needed');
  assert.equal(resume.experience.length, 0);
  assert.ok(resume._needsReview.includes('personal.name'));
});

test('output passes the resume schema and the existing scoring engine', () => {
  const { resume } = parseLinkedInText(LINKEDIN_EXPORT_TEXT);
  const valid = parseResumeJson(resume);
  const analysis = analyzeCandidate(valid);
  assert.ok(analysis.health.score > 0 && analysis.health.score <= 100);
});

test('a real PDF goes through the existing text extractor and is detected', async () => {
  // Uncompressed, as DutyLaunch writes its own PDFs: the existing extractor
  // cannot read some compressed pdfkit output.
  const doc = new PDFDocument({ compress: false });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  LINKEDIN_EXPORT_TEXT.split('\n').forEach((l) => doc.text(l));
  doc.end();
  await done;
  const { text } = await extractText(Buffer.concat(chunks), 'application/pdf');
  assert.equal(looksLikeLinkedInExport(text), true);
  assert.equal(parseLinkedInText(text).resume.personal.name, 'Priya Sharma');
});

test('LinkedIn URLs are validated and stored as a reference only', () => {
  assert.equal(normaliseLinkedInUrl('linkedin.com/in/priya-sharma-dev/?trk=x'), 'https://www.linkedin.com/in/priya-sharma-dev');
  assert.equal(normaliseLinkedInUrl('https://evil.com/linkedin.com/in/x'), null);
  assert.equal(normaliseLinkedInUrl('https://www.linkedin.com/company/acme'), null);
});

test('merging a CV adds missing items without overwriting reviewed data', () => {
  const { resume: li } = parseLinkedInText(LINKEDIN_EXPORT_TEXT);
  const cv = parseResumeJson(li);
  cv.personal.name = 'SHOULD NOT OVERWRITE';
  cv.personal.phone = '+91 98765 43210';
  cv.skills.technical.push('GraphQL');
  cv.projects.push({ name: 'Roadmap scorer', role: '', description: '', technologies: [], link: '', startDate: '', endDate: '' });
  const { resume, added } = mergeResumes(li, cv);
  assert.equal(resume.personal.name, 'Priya Sharma');
  assert.equal(resume.personal.phone, '+91 98765 43210');
  assert.ok(resume.skills.technical.includes('GraphQL'));
  assert.equal(resume.experience.length, 3, 'duplicate roles are not added twice');
  assert.ok(added.includes('skill: GraphQL') && added.includes('project: Roadmap scorer'));
});
