import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBuilderSuggestions } from '../services/careerIntelligence/studioAi.js';

/** Resume Builder wizard examples. A fake fetch stands in for the AI. */

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

test('bullets for a job title, duplicates removed', async () => {
  fakeAi(JSON.stringify({ items: ['Built dashboards in Power BI', 'built dashboards in power bi', 'Cleaned data in SQL'] }));
  const items = await generateBuilderSuggestions({ kind: 'bullets', jobTitle: 'Data Analyst' });
  assert.deepEqual(items, ['Built dashboards in Power BI', 'Cleaned data in SQL']);
  assert.match(lastBody.messages[1].content, /Job title: Data Analyst/);
  assert.match(lastBody.messages[1].content, /\[number\]/, 'asks for placeholders, not invented figures');
});

test('summaries use the candidate details and forbid invention', async () => {
  fakeAi(JSON.stringify({ items: ['Summary one.', 'Summary two.', 'Summary three.'] }));
  await generateBuilderSuggestions({ kind: 'summary', jobTitle: 'Web Developer', details: { name: 'Srinivas', jobs: ['Web Developer at Skyup'], skills: ['React'] } });
  const prompt = lastBody.messages[1].content;
  assert.match(prompt, /Web Developer at Skyup/);
  assert.match(prompt, /never invent employers/);
});

test('bad or failed replies throw (the page falls back to built-in examples)', async () => {
  fakeAi('not json');
  await assert.rejects(() => generateBuilderSuggestions({ kind: 'skills', jobTitle: 'Nurse' }));
  fakeAi('', 503);
  await assert.rejects(() => generateBuilderSuggestions({ kind: 'skills', jobTitle: 'Nurse' }));
});
