/**
 * Live check of the AI resume optimizer (uses your real .env and real AI calls).
 *
 *   node scripts/checkAi.mjs
 *   node scripts/checkAi.mjs path/to/resume.docx
 *   node scripts/checkAi.mjs path/to/resume.docx path/to/job-description.txt
 *
 * Step 1  Pings Gemini and OpenAI one by one, so a missing key / no quota / wrong model is obvious.
 * Step 2  Runs the real rewrite workflow (same code as the website) and prints
 *         every accepted change, every blocked change and the keyword report.
 *
 * Nothing is saved anywhere. Your API key is never printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const { callModel, aiStatus } = await import('../services/careerIntelligence/aiClient.js');
const { parseResumeText, parseResumeFile } = await import('../services/careerIntelligence/resumeParser.js');
const { analyzeCandidate, proposeRewrites } = await import('../services/careerIntelligence/index.js');
const { buildOptimizedResume, keywordReport, summarizeAnalysis } = await import('../services/careerIntelligence/optimizeWorkflow.js');

const ok = (m) => console.log(`  \u2714 ${m}`);
const bad = (m) => console.log(`  \u2716 ${m}`);
const head = (m) => console.log(`\n${m}\n${'-'.repeat(m.length)}`);

/* A small sample with deliberately weak bullets, so improvements are visible. */
const SAMPLE_RESUME = `ASHA SAMPLE

OPERATIONS MANAGER | LOGISTICS | SUPPLY CHAIN

Pune, India   |   +91 9876543210   |   asha@example.com

PROFESSIONAL SUMMARY

Operations professional with 8+ years of experience in logistics and supply chain. Led a team of 25 across 4 warehouses.

CORE COMPETENCIES

Logistics & Supply Chain: Route Planning, Vendor Management, Inventory Control, Cost Reduction

Technology: SAP, Advanced Excel, Power BI, SQL

PROFESSIONAL EXPERIENCE

Operations Manager – Warehousing | Acme Logistics Pvt Ltd, Pune, India March 2022 – Present

Responsible for daily warehouse operations and dispatch planning.

Worked with vendors to renegotiate freight contracts, saving 12% on annual costs.

Helped the team follow safety rules during go-live of the new system.

Operations Executive – Dispatch | Beta Freight Ltd, Mumbai, India June 2018 – February 2022

Handled dispatch of shipments to customers across the west region.

Prepared weekly reports for management on delivery performance.

Supported audits of the warehouse by the compliance team.

EDUCATION

MBA in Operations Management
Pune University

CERTIFICATIONS

Certified Supply Chain Professional (CSCP) • Six Sigma Green Belt

LANGUAGES

English, Hindi
`;

const SAMPLE_JD = `Senior Operations Manager

Requirements:
- 5+ years of experience in warehouse operations and logistics
- Experience with vendor management and freight contract negotiation
- Strong skills in SAP and Power BI reporting
- Kubernetes experience

Preferred:
- Six Sigma certification
`;

const [resumePath, jdPath] = process.argv.slice(2);

/* ---------------------------------------------------------------- */
head('Step 1 - Are the AI providers working?');

const status = aiStatus();
console.log(`  Provider mode: ${status.provider || 'none'}`);

const PING = [{ role: 'user', content: 'Reply with exactly the two letters: OK' }];
const checks = [
  { name: 'gemini', label: 'Gemini', keyVar: 'GEMINI_API_KEY', modelVar: 'GEMINI_MODEL', fallbackModel: 'gemini-2.5-flash' },
  { name: 'openai', label: 'OpenAI', keyVar: 'OPENAI_API_KEY', modelVar: 'OPENAI_MODEL', fallbackModel: 'gpt-4.1-mini' },
];
let anyWorking = false;
for (const c of checks) {
  const model = process.env[c.modelVar] || c.fallbackModel;
  if (!process.env[c.keyVar]) {
    console.log(`  - ${c.label}: no ${c.keyVar} in .env (skipped)`);
    continue;
  }
  try {
    const reply = await callModel(PING, { task: 'resume-rewrite', onlyProviders: [c.name], maxOutputTokens: 200 });
    anyWorking = true;
    ok(`${c.label} (${model}) answered: "${String(reply).trim().slice(0, 40)}"  -> key, model and quota work`);
  } catch (err) {
    bad(`${c.label} (${model}) did not answer: ${err.message}`);
    if (/credit_balance_exhausted|insufficient_quota/.test(err.message)) console.log('    -> No API credit. Add credit at platform.openai.com -> Settings -> Billing.');
    else if (/API key|401|403|key was rejected|HTTP 400/.test(err.message)) console.log(`    -> The key was rejected. Create a new key and update ${c.keyVar} in .env (Gemini keys: https://aistudio.google.com/apikey).`);
    else if (/404|model/i.test(err.message)) console.log(`    -> Check ${c.modelVar} (Gemini: gemini-2.5-flash, gemini-2.5-flash-lite or gemini-3-flash-preview).`);
    else if (/429/.test(err.message)) console.log('    -> Rate limit or quota reached. Wait a minute and try again; see your quota in Google AI Studio.');
  }
}
if (!anyWorking) {
  console.log('    Neither Gemini nor OpenAI answered. Groq/Mistral may still answer in the website, but expect slower runs and rate-limit warnings.');
}

/* ---------------------------------------------------------------- */
head('Step 2 - Real optimization run');

let resume;
let jobDescription;
try {
  if (resumePath) {
    const buffer = fs.readFileSync(resumePath);
    const ext = path.extname(resumePath).toLowerCase();
    const mimetype =
      ext === '.pdf' ? 'application/pdf'
        : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/plain';
    const parsed = await parseResumeFile({ buffer, mimetype, fileName: path.basename(resumePath) });
    resume = parsed.resume || parsed;
    console.log(`  Resume: ${path.basename(resumePath)}`);
  } else {
    resume = parseResumeText(SAMPLE_RESUME);
    console.log('  Resume: built-in sample (weak bullets on purpose). Pass your own file as the first argument.');
  }
  jobDescription = jdPath ? fs.readFileSync(jdPath, 'utf8') : (resumePath ? undefined : SAMPLE_JD);
  console.log(`  Job description: ${jobDescription ? 'yes' : 'none (general optimization)'}`);
} catch (err) {
  bad(`Could not read the input: ${err.message}`);
  process.exit(1);
}

console.log(`  Found: ${resume.experience.length} jobs, ${resume.certifications.length} certifications, headline "${resume.personal.headline || '-'}"`);

const started = Date.now();
const analysis = analyzeCandidate(resume, { jobDescription });
const result = await proposeRewrites(resume, {
  jobIntel: analysis.jobIntel,
  keywordResult: analysis.keywords,
  profile: analysis.profile,
  scope: 'all',
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`  Engine: ${result.engine}   time: ${seconds}s`);
if (result.engine === 'rules') {
  bad(`The AI could not be used (${result.failureReason || 'unknown'}). Only rule-based fixes ran.`);
}
result.warnings?.forEach((w) => console.log(`  ! ${w}`));

const built = buildOptimizedResume(resume, result.proposals, { keywordResult: analysis.keywords });
const after = analyzeCandidate(built.resume, { jobDescription });

head(`Accepted changes (${built.changelog.length})`);
if (!built.changelog.length) console.log('  none - nothing was worth changing, or every suggestion was blocked (see below)');
built.changelog.forEach((c) => {
  console.log(`\n  [${c.id}]`);
  console.log(`   before: ${c.original}`);
  console.log(`   after : ${c.final}`);
  console.log(`   why   : ${c.reason}`);
});

head(`Blocked by the fact check (${result.rejections.length})`);
if (!result.rejections.length) console.log('  none');
result.rejections.forEach((r) => console.log(`  [${r.id}] ${r.problems.join('; ')}`));

head('Scores (from the scoring engine, not the AI)');
const before = summarizeAnalysis(analysis);
const afterScores = summarizeAnalysis(after);
console.log(`  Resume health : ${before.resumeHealth} -> ${afterScores.resumeHealth}`);
if (before.hasJobDescription) {
  console.log(`  Job match     : ${before.jobMatch} -> ${afterScores.jobMatch}`);
  console.log(`  Keyword cover.: ${before.keywordCoverage}% -> ${afterScores.keywordCoverage}%`);
  const report = keywordReport(after);
  console.log(`  Matched       : ${report.matched.map((k) => k.term).join(', ') || '-'}`);
  console.log(`  Missing (req) : ${report.missingRequired.map((k) => k.term).join(', ') || '-'}   <- never added automatically`);
  console.log(`  Missing (pref): ${report.missingPreferred.map((k) => k.term).join(', ') || '-'}`);
}

head('Safety check');
const sameFacts = built.resume.experience.every((r, i) => {
  const o = resume.experience[i];
  return r.company === o.company && r.title === o.title && r.startDate === o.startDate && r.endDate === o.endDate;
});
sameFacts ? ok('Employers, titles and dates are identical to the original') : bad('A fact changed - report this!');
const hyphen = JSON.stringify(built.resume).match(/[\u2010\u2011]/);
hyphen ? bad('A special hyphen character slipped through') : ok('No special hyphen characters');
console.log('\nDone. Nothing was saved.');
process.exit(result.engine === 'rules' || !sameFacts ? 1 : 0);
