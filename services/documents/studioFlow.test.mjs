/**
 * End-to-end test of the AI Career Studio over HTTP.
 *
 * Real: the Express app, routing, auth middleware (with signed JWTs),
 * validation, multer uploads, consent checks, rate limiters, controllers,
 * the Career Intelligence engine and the PDF/DOCX renderer.
 * Replaced: MongoDB (the three collections and the user lookup are backed
 * by an in-memory store) and the AI model (a scripted fake).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import mammoth from 'mammoth';
import mongoose from 'mongoose';

process.env.MONGODB_URI = 'mongodb://unused';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.NODE_ENV = 'test';

const { default: app } = await import('../app.js');
const { CareerProfile, CoverLetter, InterviewSession, ScoringConfig, User, ResumeAnalysis } = await import('../models/index.js');
const { signToken } = await import('../utils/token.js');
const { __setModelClient } = await import('../services/careerIntelligence/aiClient.js');
const { extractText } = await import('../services/careerIntelligence/resumeParser.js');
const { LINKEDIN_EXPORT_TEXT } = await import('./fixtures/linkedinExport.js');

/* ---------- in-memory Mongo stand-in ---------- */
function backWithMemory(Model) {
  const store = new Map();
  const val = (d, k) => { const v = d.get ? d.get(k) : d[k]; return v == null ? v : String(v); };
  const matches = (d, q = {}) => Object.entries(q).every(([k, v]) => val(d, k) === String(v));
  const wrap = (d) => {
    d.save = async function save() { store.set(String(this._id), this); return this; };
    d.deleteOne = async function del() { store.delete(String(this._id)); };
    return d;
  };
  const chain = (fn) => { const c = { sort: () => c, select: () => c, lean: () => c, then: (r, j) => Promise.resolve(fn()).then(r, j) }; return c; };
  Model.findOne = (q) => chain(() => [...store.values()].find((d) => matches(d, q)) || null);
  Model.find = (q) => chain(() => [...store.values()].filter((d) => matches(d, q)).map((d) => d.toObject()));
  Model.create = async (data) => wrap(new Model(data)).save();
  Model.deleteOne = async (q) => { for (const [k, d] of store) if (matches(d, q)) { store.delete(k); break; } };
  Model.deleteMany = async (q) => { for (const [k, d] of store) if (matches(d, q)) store.delete(k); };
  Model.countDocuments = async (q) => [...store.values()].filter((d) => matches(d, q)).length;
  return store;
}
const profiles = backWithMemory(CareerProfile);
const letters = backWithMemory(CoverLetter);
const sessions = backWithMemory(InterviewSession);
ScoringConfig.activeOverride = async () => null;
backWithMemory(ResumeAnalysis);
const origCreate = CareerProfile.create;
CareerProfile.create = async (data) => { const d = await origCreate(data); return d; };

const users = new Map();
const mkUser = (role) => {
  const u = { _id: new mongoose.Types.ObjectId(), role, isActive: true, name: role, hasPasswordChangedAfter: () => false };
  users.set(String(u._id), u);
  return { user: u, token: signToken({ sub: String(u._id) }) };
};
User.findById = (id) => { const u = users.get(String(id)) || null; const p = Promise.resolve(u); p.select = async () => u; return p; };

/* ---------- scripted AI model ---------- */
const q = (i) => ({ question: `Tailored question ${i}: how did you approach the React work at Clairo?`, category: i <= 3 ? 'Resume & background' : 'Technical', difficulty: 'medium', whyRelevant: 'On your CV', interviewerExpects: 'Specifics', sampleAnswer: 'At Clairo I led the React 18 migration. [the metric you used]', keyPoints: ['React 18'], followUp: 'Why?', placeholders: ['the metric you used'], basedOn: 'Clairo' });
__setModelClient(async (messages, o = {}) => {
  switch (o.task) {
    case 'interview-top10': return JSON.stringify({ questions: Array.from({ length: 10 }, (_, i) => q(i + 1)) });
    case 'interview-regenerate': return JSON.stringify({ question: { ...q(3), question: 'Regenerated question: what trade-offs did the TypeScript migration involve?' } });
    case 'mock-plan': return JSON.stringify({ questions: [{ question: 'Planned mock question one?', category: 'HR' }] });
    case 'mock-evaluate': return JSON.stringify({ score: 70, scores: { relevance: 75, clarity: 65 }, summary: 'Relevant, needs a result.', strengths: ['Specific'], missingPoints: ['No measurable result'], suggestions: ['Add a number'], modelAnswer: 'At Clairo I… [result]', conceptsToReview: ['Code splitting'], followUpQuestion: 'How did you measure the bundle size reduction?' });
    case 'mock-report': return JSON.stringify({ summary: 'Solid practice session.', strengths: ['Specific examples'], improvements: ['Quantify results'], topicsToRevise: ['Code splitting'], nextSteps: ['Practise STAR'] });
    case 'cover-letter-paragraph': return JSON.stringify({ paragraph: 'Rewritten paragraph that uses only my verified React experience at Clairo Technologies.' });
    default: return JSON.stringify({ salutation: 'Dear Hiring Team,', body: 'Paragraph one about my React work at Clairo.\n\nParagraph two about TypeScript.\n\nParagraph three.', closing: 'Yours sincerely,', subjectLine: 'Application' });
  }
});

/* ---------- HTTP helpers ---------- */
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => server.close());

async function call(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(base + path, { method, headers, body });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

async function linkedInPdf() {
  const d = new PDFDocument(); const c = []; d.on('data', (x) => c.push(x)); const done = new Promise((r) => d.on('end', r));
  LINKEDIN_EXPORT_TEXT.split('\n').forEach((l) => d.text(l)); d.end(); await done;
  return Buffer.concat(c);
}
const upload = (buf, name, type, fields = {}) => {
  const f = new FormData();
  f.append('resume', new Blob([buf], { type }), name);
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  return f;
};

const JD = 'Senior Frontend Engineer at Acme. Required: React, TypeScript, GraphQL and automated testing. You will lead frontend architecture and mentor engineers across two product teams.';
const candidate = mkUser('user');
const other = mkUser('user');
const employer = mkUser('employer');
const state = {};

/* ---------- the flow ---------- */

test('access control: no login is 401, a non-candidate role is 403', async () => {
  assert.equal((await call('GET', '/studio')).status, 401);
  assert.equal((await call('GET', '/studio', { token: employer.token })).status, 403);
});

test('empty studio: every step not started, nothing faked', async () => {
  const r = await call('GET', '/studio', { token: candidate.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.profile, null);
  assert.ok(r.data.data.steps.every((s) => s.state === 'not-started'));
  assert.equal(r.data.data.linkedinApi.available, false);
  assert.equal((await call('GET', '/studio/profile-document', { token: candidate.token })).status, 400);
});

test('step 1: import rejects missing consent and disallowed files', async () => {
  const pdf = await linkedInPdf();
  assert.equal((await call('POST', '/studio/import', { token: candidate.token, form: upload(pdf, 'p.pdf', 'application/pdf') })).status, 400);
  assert.equal((await call('POST', '/studio/import', { token: candidate.token, form: upload(Buffer.from('MZ'), 'x.exe', 'application/octet-stream', { consent: 'true' }) })).status, 400);
  assert.equal((await call('POST', '/studio/import', { token: candidate.token, form: upload(pdf, 'p.pdf', 'application/pdf', { consent: 'true', linkedinUrl: 'https://evil.com/x' }) })).status, 400);
});

test('step 1: LinkedIn PDF import reports what was read', async () => {
  const r = await call('POST', '/studio/import', { token: candidate.token, form: upload(await linkedInPdf(), 'Profile.pdf', 'application/pdf', { consent: 'true', linkedinUrl: 'linkedin.com/in/priya-sharma-dev' }) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.data.report.source, 'linkedin-pdf');
  assert.equal(r.data.data.report.status, 'imported');
  assert.equal(r.data.data.resume.personal.name, 'Priya Sharma');
  assert.equal(r.data.data.resume.experience.length, 3);
});

test('a LinkedIn URL alone is a reference, never an import', async () => {
  const r = await call('PUT', '/studio/linkedin-url', { token: candidate.token, json: { url: 'https://www.linkedin.com/in/priya-sharma-dev/' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.imported, false);
});

test('step 2–3: the profile PDF requires confirmation, then downloads', async () => {
  assert.equal((await call('GET', '/studio/profile-document', { token: candidate.token })).status, 400);
  const edited = (await call('GET', '/studio', { token: candidate.token })).data.data;
  assert.equal(edited.steps[0].state, 'completed');
  const master = JSON.parse(JSON.stringify([...profiles.values()][0].master)); // a copy, as a client would send
  master.personal.phone = '+91 98765 43210'; // a reviewed edit
  master._source = { rawText: 'CLIENT TRIED TO OVERWRITE PROVENANCE' };
  const c = await call('POST', '/studio/confirm', { token: candidate.token, json: { resume: master } });
  assert.equal(c.status, 200);
  assert.notEqual([...profiles.values()][0].master._source.rawText, 'CLIENT TRIED TO OVERWRITE PROVENANCE');

  const pdf = await call('GET', '/studio/profile-document', { token: candidate.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="Priya_Sharma_LinkedIn_Profile\.pdf"/);
  const { text } = await extractText(pdf.data, 'application/pdf');
  assert.ok(text.includes('Priya Sharma') && text.includes('+91 98765 43210') && text.includes('Not an official LinkedIn document'));

  const preview = await call('GET', '/studio/profile-document?inline=1', { token: candidate.token });
  assert.match(preview.headers.get('content-disposition'), /^inline/);
});

test('step 4: resume generated by the existing versions endpoint, downloadable as PDF and DOCX', async () => {
  const v = await call('POST', '/career/versions', { token: candidate.token, json: { jobDescription: JD, jobHints: { jobTitle: 'Senior Frontend Engineer', company: 'Acme' }, label: 'Frontend — Acme' } });
  assert.equal(v.status, 201, JSON.stringify(v.data));
  state.versionId = v.data.data.version._id;
  assert.equal(typeof v.data.data.version.health.score, 'number', 'deterministic Resume Health score');
  assert.equal(typeof v.data.data.version.match.overall, 'number', 'deterministic Job Match score');

  const docx = await call('GET', `/studio/versions/${state.versionId}/document?format=docx`, { token: candidate.token });
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get('content-type'), /wordprocessingml/);
  assert.ok((await mammoth.extractRawText({ buffer: docx.data })).value.includes('Clairo Technologies'));
  const pdf = await call('GET', `/studio/versions/${state.versionId}/document`, { token: candidate.token });
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
});

test('step 6: cover letter — create, edit, duplicate, rewrite a paragraph, download', async () => {
  assert.equal((await call('POST', '/studio/cover-letters', { token: candidate.token, json: { jobDescription: 'too short' } })).status, 400);
  const c = await call('POST', '/studio/cover-letters', { token: candidate.token, json: { versionId: state.versionId, jobTitle: 'Senior Frontend Engineer', company: 'Acme', jobDescription: JD, tone: 'confident' } });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  state.letterId = c.data.data.coverLetter._id;
  assert.match(c.data.data.coverLetter.content, /React work at Clairo/);

  const u = await call('PUT', `/studio/cover-letters/${state.letterId}`, { token: candidate.token, json: { content: 'Dear Hiring Team,\n\nMy own edited opening.\n\nSecond paragraph.' } });
  assert.equal(u.data.data.content.includes('My own edited opening.'), true);
  const p = await call('POST', `/studio/cover-letters/${state.letterId}/paragraphs/1`, { token: candidate.token, json: {} });
  assert.equal(p.status, 200);
  assert.match(p.data.data.content, /Rewritten paragraph/);
  assert.match(p.data.data.content, /Second paragraph\./, 'other paragraphs untouched');
  assert.equal((await call('POST', `/studio/cover-letters/${state.letterId}/duplicate`, { token: candidate.token })).status, 201);
  assert.equal((await call('GET', '/studio/cover-letters', { token: candidate.token })).data.data.length, 2);
  const d = await call('GET', `/studio/cover-letters/${state.letterId}/document?format=docx`, { token: candidate.token });
  assert.ok((await mammoth.extractRawText({ buffer: d.data })).value.includes('Rewritten paragraph'));
});

test('step 7: exactly 10 interview questions — edit, regenerate one, download', async () => {
  const s = await call('POST', '/studio/interview-sets', { token: candidate.token, json: { versionId: state.versionId, jobTitle: 'Senior Frontend Engineer', company: 'Acme', jobDescription: JD, experienceLevel: 'senior' } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  state.setId = s.data.data.set._id;
  assert.equal(s.data.data.set.questions.length, 10);
  assert.match(s.data.data.note, /not real or leaked/);

  const e = await call('PUT', `/studio/interview-sets/${state.setId}`, { token: candidate.token, json: { questions: [{ number: 2, sampleAnswer: 'My own confirmed answer.' }] } });
  const q2 = e.data.data.questions.find((x) => x.number === 2);
  assert.equal(q2.sampleAnswer, 'My own confirmed answer.');
  assert.equal(q2.edited, true);

  const r = await call('POST', `/studio/interview-sets/${state.setId}/questions/3/regenerate`, { token: candidate.token });
  assert.equal(r.status, 200);
  assert.match(r.data.data.questions[2].question, /Regenerated question/);
  assert.equal(r.data.data.questions.find((x) => x.number === 2).sampleAnswer, 'My own confirmed answer.', 'edits to other questions survive');

  const pdf = await call('GET', `/studio/interview-sets/${state.setId}/document`, { token: candidate.token });
  const { text } = await extractText(pdf.data, 'application/pdf');
  assert.ok(text.includes('Regenerated question') && text.includes('My own confirmed answer.'));
});

test('phase 2: mock interview from the top-10 set, with a follow-up and a report', async () => {
  const m = await call('POST', '/studio/mock', { token: candidate.token, json: { sourceSetId: state.setId, interviewType: 'technical', difficulty: 'hard', questionCount: 3 } });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  state.mockId = m.data.data.id;
  assert.equal(m.data.data.total, 3);
  assert.match(m.data.data.currentQuestion.question, /Tailored question 1/);

  const a1 = await call('POST', `/studio/mock/${state.mockId}/answer`, { token: candidate.token, json: { answer: 'I led the React 18 migration at Clairo and cut the bundle by 38%.' } });
  assert.equal(a1.status, 200);
  assert.equal(a1.data.data.feedback.score, 70);
  assert.equal(a1.data.data.followUpAdded, true);
  assert.match(a1.data.data.session.currentQuestion.question, /How did you measure the bundle size/);
  assert.match(a1.data.data.practiceNote, /not an employer assessment/);

  assert.equal((await call('POST', `/studio/mock/${state.mockId}/answer`, { token: candidate.token, json: { answer: ' ' } })).status, 400);
  let cur = a1.data.data.session;
  while (cur.currentQuestion) {
    const a = await call('POST', `/studio/mock/${state.mockId}/answer`, { token: candidate.token, json: { answer: 'We used Lighthouse and webpack-bundle-analyzer before and after.' } });
    cur = a.data.data.session;
  }
  assert.equal(cur.turns.length, 4, '3 planned + 1 follow-up (follow-ups are capped)');

  const f = await call('POST', `/studio/mock/${state.mockId}/finish`, { token: candidate.token });
  assert.equal(f.data.data.status, 'completed');
  assert.equal(f.data.data.report.overallScore, 70);
  assert.equal((await call('POST', `/studio/mock/${state.mockId}/answer`, { token: candidate.token, json: { answer: 'late' } })).status, 400);
  const pdf = await call('GET', `/studio/mock/${state.mockId}/document`, { token: candidate.token });
  assert.ok((await extractText(pdf.data, 'application/pdf')).text.includes('not an employer evaluation'));
});

test('ownership: another candidate cannot read, edit, download or answer anything', async () => {
  const t = other.token;
  for (const [method, path, json] of [
    ['GET', `/studio/cover-letters/${state.letterId}`],
    ['PUT', `/studio/cover-letters/${state.letterId}`, { content: 'hijack' }],
    ['GET', `/studio/cover-letters/${state.letterId}/document`],
    ['DELETE', `/studio/interview-sets/${state.setId}`],
    ['GET', `/studio/interview-sets/${state.setId}/document`],
    ['GET', `/studio/mock/${state.mockId}`],
    ['POST', '/studio/mock', { sourceSetId: state.setId }],
  ]) {
    const r = await call(method, path, { token: t, json });
    assert.ok([400, 404].includes(r.status), `${method} ${path} returned ${r.status}`);
  }
  assert.equal((await call('GET', '/studio/cover-letters/not-an-id', { token: candidate.token })).status, 404);
  assert.equal((await call('GET', `/studio/versions/${state.versionId}/document`, { token: t })).status, 400, 'other user has no profile at all');
  assert.equal([...letters.values()].find((l) => String(l._id) === state.letterId).content.includes('hijack'), false);
});

test('progress reflects real saved actions: phase 1 complete', async () => {
  const r = (await call('GET', '/studio', { token: candidate.token })).data.data;
  assert.deepEqual(r.steps.filter((s) => s.state !== 'completed').map((s) => `${s.id}:${s.state}`), []);
  assert.equal(r.phase1Complete, true);
  assert.equal(r.documents.interviewSets[0].questionCount, 10);
  assert.equal(r.documents.mockInterviews[0].score, 70);
});

test('deleting the career profile also erases cover letters and interview practice', async () => {
  const r = await call('DELETE', '/career/profile', { token: candidate.token });
  assert.equal(r.status, 200);
  assert.equal([...letters.values()].filter((l) => String(l.user) === String(candidate.user._id)).length, 0);
  assert.equal([...sessions.values()].filter((s) => String(s.user) === String(candidate.user._id)).length, 0);
});
