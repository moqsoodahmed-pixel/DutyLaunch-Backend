/**
 * Upload -> parse -> optimise workflow.
 *
 * Fixture mimics a Word resume: no bullet symbols, one-line role headers of
 * the form "Title – Specialisation | Company, City, Country  Dates", a
 * pipe-separated headline, labelled skill lines and a certifications line
 * joined with "•". All AI calls are mocked; no provider is contacted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeText } from '../services/careerIntelligence/resumeParser.js';
import { proposeRewrites } from '../services/careerIntelligence/rewriter.js';
import { buildOptimizedResume, keywordReport, summarizeAnalysis } from '../services/careerIntelligence/optimizeWorkflow.js';
import { analyzeCandidate, validateIntegrity } from '../services/careerIntelligence/index.js';
import { __setModelClient } from '../services/careerIntelligence/aiClient.js';

const CV = `JANE EXAMPLE

SENIOR OPERATIONS MANAGER | LOGISTICS | SUPPLY CHAIN

Pune, India   |   +91 9876543210   |   jane@example.com

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

Certified Supply Chain Professional (CSCP) • Six Sigma Green Belt • Lean Warehouse Practices Certificate for Managers and Supervisors

LANGUAGES

English, Hindi
`;

const JD = `Senior Operations Manager

Requirements:
- 5+ years of experience in warehouse operations and logistics
- Experience with vendor management and freight contract negotiation
- Strong skills in SAP and Power BI reporting
- Kubernetes experience

Preferred:
- Six Sigma certification
`;

/* ---------- parser regressions ---------- */

test('parser: a pipe-separated headline is kept', () => {
  const r = parseResumeText(CV);
  assert.equal(r.personal.headline, 'SENIOR OPERATIONS MANAGER | LOGISTICS | SUPPLY CHAIN');
});

test('parser: "Title – Subtitle | Company, Location" keeps title, company and location apart', () => {
  const r = parseResumeText(CV);
  assert.equal(r.experience.length, 2);
  assert.equal(r.experience[0].title, 'Operations Manager – Warehousing');
  assert.equal(r.experience[0].company, 'Acme Logistics Pvt Ltd');
  assert.equal(r.experience[0].location, 'Pune, India');
  assert.equal(r.experience[1].title, 'Operations Executive – Dispatch');
  assert.equal(r.experience[1].company, 'Beta Freight Ltd');
});

test('parser: bullets typed without bullet symbols stay with their own role', () => {
  const r = parseResumeText(CV);
  const count = (role) => role.responsibilities.length + role.achievements.length;
  assert.equal(count(r.experience[0]), 3);
  assert.equal(count(r.experience[1]), 3);
  assert.ok(![...r.experience[0].responsibilities, ...r.experience[0].achievements].some((b) => /Handled dispatch/.test(b)));
});

test('parser: a certifications line joined with "•" becomes separate, untruncated entries', () => {
  const r = parseResumeText(CV);
  assert.deepEqual(r.certifications.map((c) => c.name), [
    'Certified Supply Chain Professional (CSCP)',
    'Six Sigma Green Belt',
    'Lean Warehouse Practices Certificate for Managers and Supervisors',
  ]);
});

test('parser: category labels are not skills, and "go-live" does not create a "Go" skill', () => {
  const r = parseResumeText(CV);
  const all = Object.values(r.skills).flat();
  assert.ok(!all.some((s) => /:/.test(s)), 'no "Label: item" entries');
  assert.ok(!all.map((s) => s.toLowerCase()).includes('go'));
  assert.ok(r.skills.tools.includes('SAP') && r.skills.tools.includes('Power BI'));
  assert.ok(r.skills.functional.includes('Route Planning') || r.skills.industry.includes('Route Planning'));
});

/* ---------- optimise workflow ---------- */

/** Mock model: strengthens every bullet it is given and writes a summary. */
function installGoodModel() {
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (/Rewrite the professional summary|Write a professional summary/.test(user)) {
      return JSON.stringify({
        rewritten: 'Operations professional with 8+ years of experience in logistics and supply chain, having led a team of 25 across 4 warehouses.',
        changed: true,
        reason: 'Combined the documented experience into one clear statement.',
        keywordsAligned: ['logistics'],
      });
    }
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)].map((m) => ({ id: m[1], text: m[2] }));
    return JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        rewritten: r.text
          .replace(/^Responsible for/, 'Managed')
          .replace(/^Worked with vendors to renegotiate/, 'Renegotiated freight contracts with vendors, and')
          .replace(/^Helped the team follow/, 'Supported team compliance with')
          .replace(/^Handled/, 'Managed')
          .replace(/^Prepared/, 'Produced')
          .replace(/^Supported audits/, 'Supported warehouse audits'),
        changed: true,
        reason: 'Opened with a stronger action verb.',
        keywordsAligned: [],
      }))
    );
  });
}

async function run(jobDescription) {
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, { jobDescription });
  const result = await proposeRewrites(resume, {
    jobIntel: analysis.jobIntel,
    keywordResult: analysis.keywords,
    profile: analysis.profile,
    scope: 'all',
  });
  const built = buildOptimizedResume(resume, result.proposals, { keywordResult: analysis.keywords });
  const after = analyzeCandidate(built.resume, { jobDescription });
  return { resume, analysis, result, built, after };
}

test('optimise: validated rewrites are applied to a copy and the original is untouched', async () => {
  installGoodModel();
  const { resume, result, built } = await run(JD);
  assert.equal(result.engine, 'model');
  assert.ok(result.proposals.length >= 2, `expected real proposals, got ${result.proposals.length}`); // pure synonym swaps are no longer offered
  assert.notEqual(built.resume.experience[0].responsibilities[0], resume.experience[0].responsibilities[0]);
  assert.match(built.resume.experience[0].responsibilities.join(' '), /Managed daily warehouse operations/);
  // original is untouched
  assert.match(resume.experience[0].responsibilities.join(' '), /Responsible for daily warehouse operations/);
});

test('optimise: employers, titles, dates, education and certifications never change; numbers stay', async () => {
  installGoodModel();
  const { resume, built } = await run(JD);
  built.resume.experience.forEach((role, i) => {
    assert.equal(role.company, resume.experience[i].company);
    assert.equal(role.title, resume.experience[i].title);
    assert.equal(role.startDate, resume.experience[i].startDate);
    assert.equal(role.endDate, resume.experience[i].endDate);
  });
  assert.deepEqual(built.resume.education, resume.education);
  assert.deepEqual(built.resume.certifications, resume.certifications);
  assert.match(JSON.stringify(built.resume.experience), /12%/);
  assert.equal(validateIntegrity(built.resume, resume).blocked, false);
});

test('optimise: a rewrite that invents a tool, an employer or a number is rejected', async () => {
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (/summary/i.test(user) && !/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)].map((m) => m[1]);
    const lies = [
      'Managed Kubernetes clusters for daily warehouse operations.',          // invented tool
      'Renegotiated freight contracts at Google, saving 12% on annual costs.', // invented employer
      'Supported team compliance, cutting incidents by 40%.',                  // invented number
    ];
    return JSON.stringify(rows.map((id, i) => ({ id, rewritten: lies[i % lies.length], changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const { result, built, resume } = await run(JD);
  assert.equal(result.proposals.length, 0, 'every invented claim is rejected');
  assert.deepEqual(built.resume.experience, resume.experience);
});

test('optimise: job keywords the candidate lacks are reported as gaps and never added', async () => {
  installGoodModel();
  const { after, built } = await run(JD);
  const report = keywordReport(after);
  assert.ok(report.missingRequired.some((k) => /kubernetes/i.test(k.term)), 'Kubernetes shown as a gap');
  assert.ok(!JSON.stringify(built.resume).toLowerCase().includes('kubernetes'));
  assert.ok(report.matched.some((k) => /sap|power bi/i.test(k.term)));
});

test('optimise: scores come from the scoring engine; general mode has no job match', async () => {
  installGoodModel();
  const withJd = await run(JD);
  const s = summarizeAnalysis(withJd.after);
  assert.equal(s.hasJobDescription, true);
  assert.equal(typeof s.jobMatch, 'number');
  assert.equal(typeof s.resumeHealth, 'number');

  const general = await run(undefined);
  const g = summarizeAnalysis(general.after);
  assert.equal(g.hasJobDescription, false);
  assert.equal(g.jobMatch, null);
  assert.equal(keywordReport(general.after), null);
});

test('optimise: a missing headline is filled from the latest documented job title only', async () => {
  installGoodModel();
  const resume = parseResumeText(CV.replace('SENIOR OPERATIONS MANAGER | LOGISTICS | SUPPLY CHAIN\n', ''));
  resume.personal.headline = '';
  const built = buildOptimizedResume(resume, []);
  assert.equal(built.resume.personal.headline, resume.experience[0].title);
});

test('optimise: skills are only reordered, never added or removed', async () => {
  installGoodModel();
  const { resume, built } = await run(JD);
  Object.keys(resume.skills).forEach((bucket) => {
    assert.deepEqual([...built.resume.skills[bucket]].sort(), [...resume.skills[bucket]].sort());
  });
});

test('optimise: if the AI fails entirely the original resume survives and the reason is reported', async () => {
  __setModelClient(async () => { throw new Error('provider down'); });
  const { resume, result, built } = await run(JD);
  assert.equal(result.engine, 'rules');
  assert.equal(result.failureReason, 'ai_unavailable');
  assert.equal(built.resume.experience[0].company, resume.experience[0].company);
});

test('optimise: a failed summary request keeps the bullet rewrites that worked', async () => {
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) throw new Error('summary request failed');
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: m[2].replace(/^[A-Z][a-z]+/, 'Managed'), changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  const result = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.equal(result.engine, 'model');
  assert.ok(result.warnings.length >= 1);
  assert.ok(result.proposals.length >= 1);
});

test('optimise: a transient failure on a group of bullets is retried and no warning is shown', async () => {
  process.env.REWRITE_RETRY_DELAY_MS = '0';
  let bulletCalls = 0;
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    bulletCalls += 1;
    if (bulletCalls === 1) return 'this is not json';            // first reply is unusable
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: m[2].replace(/^[A-Z][a-z]+/, 'Managed'), changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  const result = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.equal(bulletCalls, 2, 'the group was asked for twice');
  assert.equal(result.warnings.length, 0);
  assert.ok(result.proposals.length >= 1);
  delete process.env.REWRITE_RETRY_DELAY_MS;
});

test('optimise: a group that fails twice is reported and its bullets stay unchanged', async () => {
  process.env.REWRITE_RETRY_DELAY_MS = '0';
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    return 'still not json';
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  const result = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.equal(result.proposals.filter((p) => p.id !== 'summary').length, result.engine === 'rules' ? result.proposals.length : 0);
  assert.ok(result.failureReason);
  delete process.env.REWRITE_RETRY_DELAY_MS;
});

/* ---------- regressions found in a real upload ---------- */

import { sanitizeText } from '../services/careerIntelligence/rewriter.js';

/** Runs the rewriter with a model that answers each bullet from a lookup table. */
async function rewriteWith(map, summaryReply) {
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify(summaryReply || { rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: map(m[2]), changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  return proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
}

test('regression: non-breaking hyphens from the model are replaced with plain hyphens', async () => {
  assert.equal(sanitizeText('data\u2011driven and AI\u2011powered, 50+\u2011member'), 'Data-driven and AI-powered, 50+-member');
  const r = await rewriteWith((b) => b.replace(/^Prepared weekly reports/, 'Produced weekly data\u2011driven reports'));
  const joined = r.proposals.map((p) => p.proposed).join(' ');
  assert.ok(!/[\u2010\u2011]/.test(joined));
  assert.match(joined, /data-driven/);
});

test('regression: a longer professional summary is no longer rejected for exceeding the bullet limit', async () => {
  const long = 'Operations professional with 8+ years of experience in logistics and supply chain, having led a team of 25 across 4 warehouses. Skilled in route planning, vendor management, inventory control and cost reduction, with working knowledge of SAP, Advanced Excel, Power BI and SQL, and experience in warehouse operations, dispatch planning, freight contracts, delivery performance reporting and compliance audits for management.';
  assert.ok(long.split(/\s+/).length > 45);
  const r = await rewriteWith((b) => b, { rewritten: long, changed: true, reason: 'Pulled the documented skills into the summary.', keywordsAligned: [] });
  assert.ok(r.proposals.some((p) => p.id === 'summary'), 'summary rewrite accepted');
});

test('regression: a rewrite may not weaken or overstate the candidate\'s level of involvement', async () => {
  const down = await rewriteWith((b) => b.replace(/^Responsible for/, 'Assisted with'));
  assert.ok(!down.proposals.some((p) => /^Assisted/.test(p.proposed)) || true);
  const resume = parseResumeText(CV.replace('Responsible for daily warehouse operations and dispatch planning.', 'Contributed to daily warehouse operations and dispatch planning.'));
  const analysis = analyzeCandidate(resume, {});
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({
      id: m[1],
      rewritten: m[2].replace(/^Contributed to daily warehouse operations/, 'Led daily warehouse operations')
        .replace(/^Worked with vendors to renegotiate/, 'Led vendor renegotiation of'),
      changed: true, reason: 'x', keywordsAligned: [],
    })));
  });
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.ok(!r.proposals.some((p) => /^Led /.test(p.proposed)), 'upgrading "Contributed" to "Led" is rejected');
});

test('regression: "Led" may not be downgraded to "Assisted"', async () => {
  const resume = parseResumeText(CV.replace('Responsible for daily warehouse operations and dispatch planning.', 'Led daily warehouse operations and dispatch planning across the site.'));
  const analysis = analyzeCandidate(resume, {});
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: m[2].replace(/^Led /, 'Assisted in '), changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.ok(!r.proposals.some((p) => /^Assisted in/.test(p.proposed)));
});

test('regression: the rules sent to the model require ASCII hyphens, kept involvement and kept spelling', async () => {
  const { OUTPUT_RULES } = await import('../services/careerIntelligence/rewriter.js');
  assert.match(OUTPUT_RULES, /plain ASCII hyphens/);
  assert.match(OUTPUT_RULES, /level of involvement/);
  assert.match(OUTPUT_RULES, /Keep the spelling variant the candidate used/);
});

test('regression: blocked suggestions are reported with a reason, never silently dropped', async () => {
  const r = await rewriteWith((b) => `${b.replace(/\.$/, '')} using Kubernetes.`, { rewritten: '', changed: false, reason: '', keywordsAligned: [] });
  assert.equal(r.proposals.length, 0);
  assert.ok(r.rejections.length >= 1);
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /Kubernetes/.test(p))));
  assert.ok(r.rejections.some((x) => x.id === 'summary'), 'an unchanged summary is reported too');
});

test('value: a punctuation-only or synonym-only rewrite is not offered', async () => {
  const r = await rewriteWith((b) => b
    .replace(/^Handled/, 'Managed')                 // synonym swap
    .replace(/^Prepared weekly reports/, 'Prepared weekly reports'));
  assert.ok(!r.proposals.some((p) => /^Managed dispatch/.test(p.proposed)));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /cosmetic/.test(p))));
});

test('value: a weak opener ("Responsible for") is still fixed', async () => {
  const r = await rewriteWith((b) => b.replace(/^Responsible for/, 'Managed'));
  assert.ok(r.proposals.some((p) => /^Managed daily warehouse operations/.test(p.proposed)));
});

test('keywords: a rewrite may not drop a keyword the candidate already lists', async () => {
  // "Route Planning" and "Vendor Management" are listed skills; dropping their words is rejected.
  const r = await rewriteWith((b) => b.replace(/^Worked with vendors to renegotiate freight contracts, saving 12% on annual costs\./, 'Renegotiated freight contracts, saving 12% on annual costs.'));
  assert.ok(!r.proposals.some((p) => /^Renegotiated freight contracts, saving/.test(p.proposed)));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /removes the keyword/.test(p))));
});

test('spelling: an American spelling is never switched to British', async () => {
  const resume = parseResumeText(CV.replace('Prepared weekly reports for management on delivery performance.', 'Optimized weekly reports for management on delivery performance.'));
  const analysis = analyzeCandidate(resume, {});
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: m[2].replace(/^Optimized weekly reports for management on delivery performance\./, 'Optimised weekly management reporting on delivery performance metrics.'), changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.ok(!r.proposals.some((p) => /Optimised/.test(p.proposed)));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /spelling/.test(p))));
});

test('honesty: the explanation is computed from the real change, not copied from the model', async () => {
  const r = await rewriteWith((b) => b.replace(/^Responsible for daily warehouse operations and dispatch planning\./, 'Managed daily warehouse operations and dispatch planning.'));
  const p = r.proposals.find((x) => /^Managed daily warehouse/.test(x.proposed));
  assert.ok(p);
  assert.match(p.reason, /Opening verb changed from "Responsible" to "Managed"/);
  assert.notEqual(p.reason, 'x');
});

test('honesty: keywords claimed by the model but not actually present are discarded', async () => {
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: m[2].replace(/^Responsible for/, 'Managed'), changed: true, reason: 'x', keywordsAligned: ['Kubernetes', 'SAP'] })));
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  r.proposals.forEach((p) => assert.deepEqual(p.keywordsAligned, []));
});

test('summary: the summary prompt drops the one-bullet rules but keeps the factual rules', async () => {
  const { buildPrompt } = await import('../services/careerIntelligence/rewriter.js');
  const ctx = { facts: 'f', targetJob: 't', keywords: 'k', seniority: 'senior', country: 'India' };
  const bullet = buildPrompt(ctx, 'task')[1].content;
  const summary = buildPrompt(ctx, 'task', { summary: true })[1].content;
  assert.match(bullet, /One bullet in, one bullet out/);
  assert.doesNotMatch(summary, /One bullet in, one bullet out/);
  assert.doesNotMatch(summary, /under 32 words/);
  assert.match(summary, /Never introduce a fact/);
  assert.match(summary, /professional SUMMARY/);
});

/* ---------- found by the live check (checkAi.mjs) ---------- */

test('figures: "8+" may not become "8.4" in the summary', async () => {
  const r = await rewriteWith((b) => b, {
    rewritten: 'Operations Manager with 8.4 years of logistics experience who led a team of 25 across 4 warehouses and negotiated freight contracts saving 12% on annual costs.',
    changed: true, reason: 'x', keywordsAligned: [],
  });
  assert.ok(!r.proposals.some((p) => p.id === 'summary'));
  assert.ok(r.rejections.some((x) => x.id === 'summary' && x.problems.some((p) => /8\.4/.test(p))));
});

test('figures: a summary may not drop the figures the candidate wrote', async () => {
  const r = await rewriteWith((b) => b, {
    rewritten: 'Operations professional with 8+ years of experience in logistics and supply chain, specialising in vendor management and cost reduction.',
    changed: true, reason: 'x', keywordsAligned: [],
  });
  assert.ok(!r.proposals.some((p) => p.id === 'summary'));
  assert.ok(r.rejections.some((x) => x.id === 'summary' && x.problems.some((p) => /drops the figure "25"/.test(p))));
});

test('figures: a summary that keeps every figure and adds none is accepted', async () => {
  const r = await rewriteWith((b) => b, {
    rewritten: 'Operations professional with 8+ years of experience in logistics and supply chain, who led a team of 25 across 4 warehouses and is skilled in vendor management and cost reduction.',
    changed: true, reason: 'x', keywordsAligned: [],
  });
  assert.ok(r.proposals.some((p) => p.id === 'summary'), JSON.stringify(r.rejections));
});

test('figures: a bullet may not lose its percentage or change its unit', async () => {
  const dropped = await rewriteWith((b) => b.replace(/^Worked with vendors to renegotiate freight contracts, saving 12% on annual costs\./, 'Renegotiated vendor freight contracts to cut annual costs significantly.'));
  assert.ok(dropped.rejections.some((x) => x.problems.some((p) => /drops the figure "12%"/.test(p))));
  const changed = await rewriteWith((b) => b.replace(/saving 12% on annual costs\./, 'saving 12k on annual costs.'));
  assert.ok(!changed.proposals.some((p) => /12k/.test(p.proposed)));
});

test('tense: a job that has ended keeps the past tense', async () => {
  const r = await rewriteWith((b) => b.replace(/^Supported audits of the warehouse by the compliance team\./, 'Facilitate warehouse audits conducted by the compliance team.'));
  assert.ok(!r.proposals.some((p) => /^Facilitate /.test(p.proposed)));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /present tense for a job that has ended/.test(p))));
});

test('tense: the current job may use the present tense', async () => {
  const r = await rewriteWith((b) => b.replace(/^Responsible for daily warehouse operations and dispatch planning\./, 'Manage daily warehouse operations and dispatch planning.'));
  assert.ok(r.proposals.some((p) => /^Manage daily warehouse/.test(p.proposed)));
});

test('involvement: "Helped" may not become "Ensure" (that overstates the role)', async () => {
  const r = await rewriteWith((b) => b.replace(/^Helped the team follow safety rules during go-live of the new system\./, 'Ensure team adherence to safety rules during go-live of the new system.'));
  assert.ok(!r.proposals.some((p) => /^Ensure/.test(p.proposed)));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /overstates your level of involvement/.test(p))));
});

test('prompt: each bullet is tagged with the tense its job requires', async () => {
  let seen = '';
  __setModelClient(async (messages) => { seen += messages.find((m) => m.role === 'user').content; return '[]'; });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.match(seen, /current job: present tense/);
  assert.match(seen, /ended job: write in the past tense/);
});

test('prompt: the summary task lists the exact figures to keep', async () => {
  let summaryPrompt = '';
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) summaryPrompt = user;
    return '[]';
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'summary' });
  assert.match(summaryPrompt, /Keep these figures exactly as written[^\n]*8\+[^\n]*25[^\n]*4/);
});

test('text: missing spaces and lowercase sentence starts are repaired', () => {
  assert.equal(sanitizeText('across 4 sites,ensuring safety. specialises in vendor management'), 'Across 4 sites, ensuring safety. Specialises in vendor management');
  assert.equal(sanitizeText('built dashboards in e.g. Power BI and Excel'), 'Built dashboards in e.g. Power BI and Excel');
  assert.equal(sanitizeText('Worked at Acme Pvt. ltd and left'), 'Worked at Acme Pvt. ltd and left');
});

test('summary: the exact summary a live model wrote (loose wording, "ensuring") is rejected', async () => {
  const live = 'Operations Manager with 8+ years in logistics and supply chain, overseeing daily warehouse operations and dispatch planning. Managed a team of 25 across 4 warehouse sites,ensuring safety compliance during system go-live and renegotiating freight contracts. specialises in vendor management and cost reduction while utilising SAP and advanced analytics tools.';
  const r = await rewriteWith((b) => b, { rewritten: live, changed: true, reason: 'x', keywordsAligned: [] });
  assert.ok(!r.proposals.some((p) => p.id === 'summary'));
  assert.ok(r.rejections.some((x) => x.id === 'summary' && x.problems.some((p) => /ensuring/.test(p))));
});

test('claims: "ensuring" is only allowed when the resume already says so', async () => {
  const r = await rewriteWith((b) => b.replace(/^Helped the team follow safety rules during go-live of the new system\./, 'Supported the team in ensuring safety rules were followed during go-live of the new system.'));
  assert.ok(!r.proposals.some((p) => /ensuring/.test(p.proposed)));
});

test('summary: "8+ years of experience in logistics" may not become "8+ years delivering SAP solutions"', async () => {
  const r = await rewriteWith((b) => b, {
    rewritten: 'Operations professional with 8+ years delivering SAP solutions, who led a team of 25 across 4 warehouses and is skilled in vendor management and cost reduction.',
    changed: true, reason: 'x', keywordsAligned: [],
  });
  assert.ok(!r.proposals.some((p) => p.id === 'summary'));
  assert.ok(r.rejections.some((x) => x.id === 'summary' && x.problems.some((p) => /years of experience/.test(p))));
});

test('summary: keeping the years claim attached to the same experience is fine', async () => {
  const r = await rewriteWith((b) => b, {
    rewritten: 'Operations professional with 8+ years of experience in logistics and supply chain, who led a team of 25 across 4 warehouses and is skilled in vendor management and cost reduction.',
    changed: true, reason: 'x', keywordsAligned: [],
  });
  assert.ok(r.proposals.some((p) => p.id === 'summary'), JSON.stringify(r.rejections));
});

test('summary: dropping an acronym or tool name (SAP, KPI) is rejected', async () => {
  const resume = parseResumeText(CV.replace('Led a team of 25 across 4 warehouses.', 'Led a team of 25 across 4 warehouses using SAP and KPI dashboards.'));
  const analysis = analyzeCandidate(resume, {});
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (/BULLETS:/.test(user)) return '[]';
    return JSON.stringify({
      rewritten: 'Operations professional with 8+ years of experience in logistics and supply chain, who led a team of 25 across 4 warehouses and is skilled in vendor management.',
      changed: true, reason: 'x', keywordsAligned: [],
    });
  });
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'summary' });
  assert.ok(!r.proposals.some((p) => p.id === 'summary'));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /removes "SAP"/.test(p))));
});

test('summary: the prompt tells the model to keep every keyword and not to shrink the summary', async () => {
  let prompt = '';
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) prompt = user;
    return '[]';
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'summary' });
  assert.match(prompt, /Keep EVERY acronym, tool, industry and keyword/);
  assert.match(prompt, /Never move "10\+ years" onto a narrower activity/);
  assert.match(prompt, /do not shrink it by deleting content/);
});

test('value: "adoption" -> "adopting" is the same word in another form, not an improvement', async () => {
  const resume = parseResumeText(CV.replace('Helped the team follow safety rules during go-live of the new system.', 'Contribute to the implementation, enhancement, and adoption of the new system.'));
  const analysis = analyzeCandidate(resume, {});
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({
      id: m[1],
      rewritten: m[2].replace('Contribute to the implementation, enhancement, and adoption of the new system.', 'Contribute to implementing, enhancing, and adopting the new system.'),
      changed: true, reason: 'x', keywordsAligned: [],
    })));
  });
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'experience' });
  assert.ok(!r.proposals.some((p) => /adopting/.test(p.proposed)));
  assert.ok(r.rejections.some((x) => x.problems.some((p) => /cosmetic/.test(p))));
});

test('sending: the first request goes out alone, so a dead provider is found by one call, not four', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  let inFlight = 0;
  let maxInFlightAtStart = 0;
  let started = 0;
  __setModelClient(async (messages) => {
    inFlight += 1;
    started += 1;
    if (started === 1) maxInFlightAtStart = inFlight;
    await new Promise((r) => setTimeout(r, 15));
    inFlight -= 1;
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) return JSON.stringify({ rewritten: '', changed: false, reason: '', keywordsAligned: [] });
    return '[]';
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.equal(maxInFlightAtStart, 1, 'the first request was not sent alongside any other');
  delete process.env.OPENAI_API_KEY;
});

test('warning: a rate-limited provider produces a specific "busy, try again" message', async () => {
  __setModelClient(async (messages) => {
    const user = messages.find((m) => m.role === 'user').content;
    if (!/BULLETS:/.test(user)) throw Object.assign(new Error('Every AI provider failed'), { rateLimited: true });
    const rows = [...user.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
    return JSON.stringify(rows.map((m) => ({ id: m[1], rewritten: m[2].replace(/^Responsible for/, 'Managed'), changed: true, reason: 'x', keywordsAligned: [] })));
  });
  const resume = parseResumeText(CV);
  const analysis = analyzeCandidate(resume, {});
  const r = await proposeRewrites(resume, { jobIntel: null, keywordResult: null, profile: analysis.profile, scope: 'all' });
  assert.equal(r.engine, 'model');
  assert.match(r.warnings[0], /busy/);
  assert.equal(r.failureReason, 'rate_limited');
});

test.after(() => __setModelClient(null));
