import test from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import { renderPdf, renderDocx, safeFilename, pdfSafe } from '../services/documents/documentRenderer.js';
import { profileDocument, resumeDocument, interviewDocument, coverLetterDocument } from '../services/documents/careerDocuments.js';
import { parseLinkedInText } from '../services/careerIntelligence/linkedinImport.js';
import { extractText } from '../services/careerIntelligence/resumeParser.js';
import { LINKEDIN_EXPORT_TEXT } from './fixtures/linkedinExport.js';

const { resume } = parseLinkedInText(LINKEDIN_EXPORT_TEXT);

test('profile PDF is real, readable text in LinkedIn section order, with the DutyLaunch notice', async () => {
  const pdf = await renderPdf(profileDocument(resume));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const { text } = await extractText(pdf, 'application/pdf'); // the site's own extractor can re-read it
  for (const s of ['Priya Sharma', 'ABOUT', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'Clairo Technologies', 'Freightify', 'Visvesvaraya Technological University', 'Not an official LinkedIn document', 'Page 1 of 1']) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
  assert.ok(text.indexOf('ABOUT') < text.indexOf('EXPERIENCE') && text.indexOf('EXPERIENCE') < text.indexOf('EDUCATION'));
});

test('long content spans several pages without losing text', async () => {
  const long = JSON.parse(JSON.stringify(resume));
  const marker = (i) => `Unique-bullet-${i} delivered measurable outcome number ${i} for the platform team across quarters.`;
  long.experience[0].responsibilities = Array.from({ length: 120 }, (_, i) => marker(i));
  const pdf = await renderPdf(profileDocument(long));
  const { text, pages } = await extractText(pdf, 'application/pdf');
  assert.ok(pages >= 3, `expected several pages, got ${pages}`);
  assert.ok(text.includes(`Page ${pages} of ${pages}`), 'footer total matches the real page count');
  assert.equal((text.match(/Page \d+ of \d+/g) || []).length, pages, 'exactly one footer per page, no blank overflow pages');
  for (let i = 0; i < 120; i += 1) assert.ok(text.includes(`Unique-bullet-${i} `), `bullet ${i} was clipped`);
});

test('resume DOCX is a valid Word file containing the resume', async () => {
  const buf = await renderDocx(resumeDocument(resume, { label: 'Frontend' }));
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'DOCX is a zip container');
  const { value } = await mammoth.extractRawText({ buffer: buf });
  for (const s of ['Priya Sharma', 'PROFESSIONAL SUMMARY', 'Senior Frontend Engineer', 'Reduced bundle size by 38%', 'Visvesvaraya']) assert.ok(value.includes(s), `missing "${s}"`);
});

test('cover letter and interview pack render in both formats', async () => {
  const letter = coverLetterDocument({ content: 'Dear Hiring Team,\n\nI am applying for the Frontend role.\n\nRegards,\nPriya', jobTitle: 'Frontend Engineer', company: 'Acme' }, resume.personal);
  const set = { jobTitle: 'Frontend Engineer', questions: [{ question: 'Walk me through the billing dashboard migration.', category: 'Resume', difficulty: 'Medium', sampleAnswer: 'At Clairo I led…', keyPoints: ['React 18', 'TypeScript'] }] };
  const [lp, ld, ip] = await Promise.all([renderPdf(letter), renderDocx(letter), renderPdf(interviewDocument(set, resume.personal))]);
  assert.ok((await extractText(lp, 'application/pdf')).text.includes('I am applying for the Frontend role.'));
  assert.ok((await mammoth.extractRawText({ buffer: ld })).value.includes('Regards,'));
  const it = (await extractText(ip, 'application/pdf')).text;
  assert.ok(it.includes('billing dashboard migration') && it.includes('not actual or leaked employer questions'));
});

test('filenames are safe and characters outside the PDF font are handled', () => {
  assert.equal(safeFilename('Priya Sharma', 'LinkedIn Profile'), 'Priya_Sharma_LinkedIn_Profile');
  assert.equal(safeFilename('../../etc/passwd'), 'etcpasswd');
  assert.equal(pdfSafe('Salary ₹12 LPA – “quoted”'), 'Salary Rs. 12 LPA – “quoted”');
  assert.equal(pdfSafe('名'), '?');
});
