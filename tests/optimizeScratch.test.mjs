import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

/**
 * Resume built FROM SCRATCH (no job description): POST /api/career/optimize
 * with { typicalRole: true } lets AI write a typical posting for the
 * candidate's own profession and uses its ATS keywords — but ONLY those the
 * candidate's own data already supports. Missing ones are reported as gaps
 * and never added. Real app and controllers; AI and database are faked.
 */
process.env.MONGODB_URI = 'mongodb://stub';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'router';
process.env.GROQ_API_KEY = 'g';
for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'MISTRAL_API_KEY', 'GROK_API_KEY']) delete process.env[k];
mongoose.set('bufferTimeoutMS', 100); // no database here: fail fast

const { resetProviderHealth } = await import('../services/careerIntelligence/aiClient.js');
const realFetch = globalThis.fetch;
let calls = [];
let jdFails = false;

globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('groq.com')) return realFetch(url, opts);
  const prompt = JSON.parse(opts.body).messages.map((m) => m.content).join('\n');
  const ok = (content) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
  if (prompt.includes('BULLETS:')) {
    calls.push('bullets');
    const rows = [...prompt.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return ok(JSON.stringify(rows.map(([, id, b]) => ({ id, rewritten: b.replace(/^Worked on making/, 'Built') + '.', changed: true, reason: 'Clearer.', keywordsAligned: [] }))));
  }
  if (/"jobTitle"/.test(prompt) && /"description"/.test(prompt)) {
    calls.push('jd');
    if (jdFails) return new Response(JSON.stringify({ error: {} }), { status: 503 });
    return ok(JSON.stringify({ jobTitle: 'Web Developer', experienceLevel: 'mid', description: 'About the role\nWe are hiring a Web Developer to build web applications with React and Node.js.\n\nResponsibilities\n- Build React interfaces and REST APIs in Node.js\n- Work with MongoDB\n- Deploy services to AWS and write TypeScript\n\nRequirements\n- React, Node.js, MongoDB, TypeScript, AWS, Git' }));
  }
  calls.push('summary');
  return ok(JSON.stringify({ rewritten: '', changed: false }));
};

const app = (await import('../app.js')).default;
const server = app.listen(0);
test.after(() => server.close());
test.beforeEach(() => {
  resetProviderHealth();
  calls = [];
  jdFails = false;
});

const RESUME = () => ({
  personal: { name: 'Test Candidate', headline: 'Web Developer', email: 't@example.com' },
  summary: '',
  experience: [{ title: 'Web Developer', company: 'Acme', startDate: 'Jan 2022', endDate: 'Dec 2023', current: false, responsibilities: ['Worked on making websites for clients using React'] }],
  skills: { technical: ['React', 'Node.js', 'MongoDB', 'Git'] },
});

const optimize = async (extra = {}, resume = RESUME()) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/career/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume, scope: 'all', autoApply: true, ...extra }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body).slice(0, 300));
  return body.data;
};

test('from scratch: AI writes a typical posting for the profession and its keywords guide the rewrite', async () => {
  const d = await optimize({ typicalRole: true });
  assert.equal(d.keywordSource, 'typical-role');
  assert.equal(d.targetRole, 'Web Developer');
  assert.equal(d.mode, 'job-matched');
  assert.ok(calls.includes('jd'), 'the typical posting was written by the AI');
  const matched = d.keywords.matched.map((k) => k.term);
  for (const k of ['react', 'node.js', 'mongodb']) assert.ok(matched.includes(k), `${k} is evidenced by the candidate's own data`);
  assert.ok(d.changelog.some((c) => c.final === 'Built websites for clients using React.'), 'the weak bullet was rewritten and applied');
});

test('keywords the candidate does not have are reported as gaps and NEVER added', async () => {
  const d = await optimize({ typicalRole: true });
  const missing = d.keywords.missingRequired.map((k) => k.term);
  assert.ok(missing.includes('aws'), 'AWS is in the posting but not in the resume: reported as a gap');
  const skills = Object.values(d.optimizedResume.skills).flat().map((s) => s.toLowerCase());
  assert.ok(!skills.includes('aws') && !skills.includes('typescript'), 'gaps are never added to the skills');
  assert.ok(!JSON.stringify(d.optimizedResume).toLowerCase().includes('aws'), 'and never appear in the resume text');
});

test('without typicalRole nothing changes: general mode, no extra AI call', async () => {
  const d = await optimize({});
  assert.equal(d.keywordSource, 'none');
  assert.equal(d.mode, 'general');
  assert.ok(!calls.includes('jd'));
});

test('a real job description always wins: no typical posting is written', async () => {
  const d = await optimize({ typicalRole: true, jobDescription: 'We need a Web Developer with React and Node.js experience to build customer-facing web applications.' });
  assert.equal(d.keywordSource, 'job-description');
  assert.ok(!calls.includes('jd'));
});

test('no profession and no job title: there is nothing to base a posting on, so none is written', async () => {
  const r = RESUME();
  r.personal.headline = '';
  r.experience = [{ title: '', company: 'Acme', startDate: 'Jan 2022', endDate: 'Dec 2023', responsibilities: ['Worked on making websites for clients using React'] }];
  const d = await optimize({ typicalRole: true }, r);
  assert.equal(d.keywordSource, 'none');
  assert.ok(!calls.includes('jd'));
});

test('if the AI cannot write the posting, the optimisation still completes without keywords', async () => {
  jdFails = true;
  const d = await optimize({ typicalRole: true });
  assert.equal(d.keywordSource, 'none');
  assert.equal(d.mode, 'general');
  assert.ok(d.changelog.length > 0, 'the rewrite still happened');
});
