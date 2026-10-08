import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLetterBody, generateCoverLetter } from '../services/careerIntelligence/careerTools.js';
import { parseResumeJson, analyzeCandidate } from '../services/careerIntelligence/index.js';

/** Cover letters are written by AI from the candidate's saved resume. */

test('stray sign-offs, names and [Your Name] are removed from the body', () => {
  const body = 'Para one.\n\nPara two.\n\nSincerely,\n\nBest regards,\n[Your Name]\n\nSHASHIKANT S BILGUNDI';
  assert.equal(cleanLetterBody(body, 'Shashikant S Bilgundi'), 'Para one.\n\nPara two.');
});

test('a [Your Name] inside a sentence becomes the real name', () => {
  assert.equal(cleanLetterBody('I am [Your Name], a web developer.', 'Srinivas Sutar'), 'I am Srinivas Sutar, a web developer.');
});

test('ordinary paragraphs are left alone', () => {
  const body = 'I build React apps.\n\nThank you for considering my application. I would welcome a call.';
  assert.equal(cleanLetterBody(body, 'X'), body);
});

const resume = parseResumeJson({
  personal: { name: 'Srinivas Sutar', headline: 'Web Developer', email: 's@x.in' },
  experience: [{ title: 'Web Developer', company: 'Skyup Digital', achievements: ['Built 12 client websites with React'] }],
  skills: { technical: ['React', 'Node.js'] },
});

test('the AI letter uses the saved resume and comes back clean', async () => {
  process.env.AI_PROVIDER = 'router';
  process.env.MISTRAL_API_KEY = 'm';
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let prompt = '';
  globalThis.fetch = async (url, opts) => {
    prompt = JSON.parse(opts.body).messages.map((m) => m.content).join('\n');
    const reply = { salutation: 'Dear Hiring Manager,', body: 'I am applying for the Web Developer role.\n\nAt Skyup Digital I built 12 client websites.\n\nBest regards,\n[Your Name]', closing: 'Yours sincerely,' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
  };
  const { jobIntel, keywordResult, profile } = analyzeCandidate(resume, { jobDescription: 'We are hiring a Web Developer skilled in React and Node.js to build client websites and REST APIs.' });
  const out = await generateCoverLetter(resume, { jobIntel, keywordResult, profile, company: 'Infosys' });
  assert.equal(out.engine, 'model');
  assert.equal(out.candidateName, 'Srinivas Sutar');
  assert.doesNotMatch(out.body, /\[Your Name\]|Best regards/);
  assert.match(prompt, /Skyup Digital/, 'the prompt contains the candidate’s resume');
  assert.match(prompt, /never placeholders/);
});
