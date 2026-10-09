import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJobDescription } from '../services/careerIntelligence/studioAi.js';
import { parseResumeJson } from '../services/careerIntelligence/index.js';

/** Step 4 auto-fill. A fake fetch stands in for the AI providers. */

const resume = parseResumeJson({
  personal: { name: 'Srinivas', headline: 'MERN Stack Developer' },
  experience: [{ title: 'Web Developer Intern', company: 'Acme', bullets: ['Built React pages'] }],
  skills: { technical: ['React', 'Node.js', 'MongoDB'] },
});

const DESCRIPTION = `About the role\nWe are hiring a Full Stack Web Developer to build and maintain web applications.\n\nResponsibilities\n- Build responsive user interfaces\n- Design REST APIs\n- Write tests\n\nRequired skills\n- JavaScript\n- React\n- Node.js\n- SQL or MongoDB\n- Git\n\nNice to have\n- Docker\n- AWS\n\nExperience and education\n- 0–2 years of experience\n- Degree in computer science or equivalent`;

let lastBody;
function fakeAi(reply, status = 200) {
  globalThis.fetch = async (url, opts) => {
    lastBody = JSON.parse(opts.body);
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: {} } : { error: {} }), { status });
  };
}

test.beforeEach(() => {
  process.env.AI_PROVIDER = 'router';
  process.env.GROQ_API_KEY = 'g';
  delete process.env.GEMINI_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

test('writes a job description and keeps the given title', async () => {
  fakeAi(JSON.stringify({ jobTitle: 'Full Stack Web Developer', description: DESCRIPTION }));
  const out = await generateJobDescription(resume, { jobTitle: 'Full stack web developer', experienceLevel: 'entry' });
  assert.equal(out.jobTitle, 'Full Stack Web Developer');
  assert.match(out.description, /Required skills/);
  const prompt = lastBody.messages.map((m) => m.content).join('\n');
  assert.match(prompt, /entry level \(0–2 years\)/);
  assert.match(prompt, /Do not copy the candidate's skill list/);
  assert.match(prompt, /MERN Stack Developer/, 'the prompt includes the LinkedIn profile');
});

test('picks a job title from the profile when none is given', async () => {
  fakeAi(JSON.stringify({ jobTitle: 'MERN Stack Developer', description: DESCRIPTION }));
  const out = await generateJobDescription(resume, {});
  assert.equal(out.jobTitle, 'MERN Stack Developer');
  assert.match(lastBody.messages.map((m) => m.content).join('\n'), /not given — choose from the candidate facts/);
});

test('rejects a too-short or broken reply instead of filling junk', async () => {
  fakeAi(JSON.stringify({ jobTitle: 'X', description: 'too short' }));
  await assert.rejects(() => generateJobDescription(resume, { jobTitle: 'X' }));
  fakeAi('not json at all');
  await assert.rejects(() => generateJobDescription(resume, { jobTitle: 'X' }));
});

test('when the AI is down the call fails (the page then asks to paste the posting)', async () => {
  fakeAi('', 503);
  await assert.rejects(() => generateJobDescription(resume, { jobTitle: 'X' }));
});

test('the AI also reads the experience level from the resume (unknown values ignored)', async () => {
  const DESC = 'About the role\n' + 'We build modern web apps with React and Node.js for clients across India. '.repeat(5);
  fakeAi(JSON.stringify({ jobTitle: 'Frontend Developer', experienceLevel: 'Entry', description: DESC }));
  let out = await generateJobDescription(resume, {});
  assert.equal(out.experienceLevel, 'entry');
  assert.match(lastBody.messages.map((m) => m.content).join('\n'), /experienceLevel/);
  fakeAi(JSON.stringify({ jobTitle: 'Frontend Developer', experienceLevel: 'guru', description: DESC }));
  out = await generateJobDescription(resume, { experienceLevel: 'mid' });
  assert.equal(out.experienceLevel, 'mid', 'falls back to the given level');
});
