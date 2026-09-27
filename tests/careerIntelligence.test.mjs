import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseResumeText,
  analyzeCandidate,
  analyzeJobDescription,
  deriveTargetedResume,
  renderResume,
  listTemplates,
  runQualityControl,
  validateIntegrity,
  applyDecisions,
  buildAchievementBullet,
  deterministicRewrite,
  MATCH,
  EVIDENCE,
} from '../services/careerIntelligence/index.js';

import * as F from './fixtures/candidates.js';

/**
 * Acceptance tests for the DutyLaunch Career Intelligence engine.
 *
 * Run with: npm test
 *
 * These cover the candidate profiles and edge cases the specification
 * lists in §42 and §50. Everything here runs against the deterministic
 * engine — no network, no database, no model — which is the point: the
 * scoring, parsing, keyword classification and integrity rules have to
 * be verifiable on their own.
 */

const parse = (text, name = 'cv.txt') => parseResumeText(text, { fileName: name, fileType: 'text/plain' });

/* ================================================================== *
 * 1. Parsing (spec §4)
 * ================================================================== */

test('parses contact details, roles and education from a standard CV', () => {
  const r = parse(F.TEN_YEARS_MANAGER);

  assert.equal(r.personal.name, 'Priya Sharma');
  assert.equal(r.personal.email, 'priya.sharma@example.com');
  assert.match(r.personal.phone, /98765/);
  assert.ok(r.personal.linkedin.includes('priyasharma'));

  assert.equal(r.experience.length, 2, 'two roles, not one per date line');
  assert.equal(r.experience[0].title, 'Operations Manager');
  assert.equal(r.experience[0].company, 'PayNext Technologies');
  assert.equal(r.experience[0].startDate, '2019-01');
  assert.equal(r.experience[0].current, true);

  assert.equal(r.experience[1].title, 'Senior Operations Executive');
  assert.equal(r.experience[1].company, 'FinServe Ltd');
  assert.equal(r.experience[1].endDate, '2018-12');

  // Education is split, not dumped whole into both fields.
  assert.equal(r.education[0].degree, 'MBA');
  assert.equal(r.education[0].institution, 'Christ University');
  assert.notEqual(r.education[0].degree, r.education[0].institution);
});

test('separates achievements from responsibilities', () => {
  const r = parse(F.TEN_YEARS_MANAGER);
  const role = r.experience[0];
  assert.ok(role.achievements.some((a) => /20%/.test(a)));
  assert.ok(role.responsibilities.some((a) => /merchant onboarding/i.test(a)));
});

test('keeps the raw source text untouched for later verification', () => {
  const r = parse(F.TEN_YEARS_MANAGER);
  assert.ok(r._source.rawText.includes('PayNext Technologies'));
  assert.equal(r._source.fileName, 'cv.txt');
});

test('never promotes a candidate skill to a stronger claim than they wrote', () => {
  const r = parse(F.TEN_YEARS_MANAGER);
  const all = Object.values(r.skills).flat().map((s) => s.toLowerCase());
  assert.ok(all.includes('excel'), 'keeps the wording the candidate used');
  assert.ok(!all.includes('advanced excel'), 'does not upgrade Excel to Advanced Excel');
});

test('reads a CV with no headings and no bullets', () => {
  const r = parse(F.POORLY_FORMATTED);
  assert.equal(r.personal.email, 'karan.mehta@example.com');
  assert.ok(r.experience.length >= 1, 'prose experience is still recovered');
  const text = JSON.stringify(r.experience).toLowerCase();
  assert.ok(text.includes('speedcart') || text.includes('warehouse'));
});

test('flags missing fields for review instead of inventing them', () => {
  const r = parse(F.MISSING_INFORMATION);
  assert.equal(r.personal.email, '');
  assert.ok(r._needsReview.length > 0, 'unreadable fields are reported');
  // Nothing was guessed to fill the gap.
  assert.equal(r.personal.phone, '');
});

test('a resume with no readable text is rejected, not returned empty', () => {
  // What a scanned CV looks like once the text layer comes back empty.
  assert.throws(() => parse('   \n \n  '), /read|scan|text/i);
  assert.throws(() => parse('image'), /read|scan|text/i);
});

/* ================================================================== *
 * 2. Candidate profile intelligence (spec §6, §7, §8, §9)
 * ================================================================== */

test('fresher: no employment history is not treated as a weakness', () => {
  const r = parse(F.FRESHER);
  const a = analyzeCandidate(r);

  assert.equal(a.profile.strategy, 'fresher');
  assert.ok(a.profile.yearsOfExperience <= 1);
  assert.ok(a.profile.fresherEvidence.projects >= 2, 'projects are counted as evidence');
  assert.ok(a.profile.fresherEvidence.certifications >= 1);

  // The health report must not list "no work experience" as a failure.
  const text = JSON.stringify(a.health).toLowerCase();
  assert.ok(!/no (work )?experience/.test(text), 'freshers are not penalised for having no employment history');
  assert.ok(a.health.score > 0);
});

test('mid-level: five years is read as a senior individual contributor, not a manager', () => {
  const a = analyzeCandidate(parse(F.FIVE_YEARS));
  assert.ok(a.profile.yearsOfExperience >= 5 && a.profile.yearsOfExperience <= 7);
  assert.ok(['mid', 'senior'].includes(a.profile.careerLevel), `unexpected level ${a.profile.careerLevel}`);
  assert.equal(a.profile.strategy, 'standard');
});

test('two-year professional is read as early career', () => {
  const a = analyzeCandidate(parse(F.TWO_YEARS));
  assert.ok(a.profile.yearsOfExperience >= 2 && a.profile.yearsOfExperience < 4);
  assert.ok(['entry', 'junior', 'mid'].includes(a.profile.careerLevel));
});

test('manager: team leadership is detected with a team size', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER));
  assert.ok(a.profile.yearsOfExperience >= 10);
  assert.equal(a.profile.leadership.hasLeadership, true);
  assert.equal(a.profile.leadership.teamSize, 12);
});

test('executive: P&L and scale are detected and the executive strategy is chosen', () => {
  const a = analyzeCandidate(parse(F.EXECUTIVE));
  assert.equal(a.profile.strategy, 'executive');
  assert.equal(a.profile.leadership.hasPnl, true);
  assert.ok(['vp', 'c-suite', 'director'].includes(a.profile.careerLevel), a.profile.careerLevel);
});

test('career changer: transferable skills are surfaced without rewriting job titles', () => {
  const r = parse(F.CAREER_CHANGER);
  const a = analyzeCandidate(r, { jobDescription: 'Customer Success Manager. Required: Customer Success, Renewals, Account Management, Stakeholder Management.' });

  assert.ok(a.profile.transferableSkills.length > 0);
  // The stored titles are the candidate's own, untouched.
  assert.equal(r.experience[0].title, 'Customer Support Team Lead');
  assert.ok(!JSON.stringify(r.experience).includes('Customer Success Manager'));
});

test('employment gaps are detected and reported, not hidden', () => {
  const a = analyzeCandidate(parse(F.EMPLOYMENT_GAP));
  assert.ok(a.profile.employmentGaps.length >= 1, 'the 2023-2024 gap is found');
  const gap = a.profile.employmentGaps[0];
  assert.ok(gap.months >= 12);
});

test('concurrent roles are not double counted in total experience', () => {
  const a = analyzeCandidate(parse(F.CONFLICTING_DATES));
  // Jun 2019 - Dec 2021 overlaps the (malformed) second entry heavily;
  // total tenure must not exceed the real calendar span.
  assert.ok(a.profile.yearsOfExperience <= 3.5, `got ${a.profile.yearsOfExperience}`);
});

/* ================================================================== *
 * 3. Job description intelligence (spec §10, §11, §12)
 * ================================================================== */

test('extracts role, requirements and keyword tiers from a full JD', () => {
  const jd = analyzeJobDescription(F.JD_OPERATIONS_MANAGER);
  assert.match(jd.role.jobTitle.toLowerCase(), /operations manager/);
  assert.equal(jd.quality, 'good');
  assert.ok(jd.keywords.length >= 8);
  assert.ok(jd.keywords.some((k) => k.canonical === 'power bi' && k.required));
  assert.equal(jd.requirements.experience.min, 6);
  assert.equal(jd.requirements.education.level, "bachelor's");
  assert.ok(jd.requirements.certifications.includes('six sigma'));
});

test('a three-word JD is reported as thin rather than analysed confidently', () => {
  const jd = analyzeJobDescription(F.JD_THIN);
  assert.ok(['thin', 'limited'].includes(jd.quality), jd.quality);

  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_THIN });
  assert.ok(a.match.confidence !== 'high', 'match confidence reflects how little the JD said');
});

test('a keyword-stuffed JD still produces a usable, ranked shortlist', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_KEYWORD_STUFFED });
  assert.ok(a.keywords.keywords.length > 20);
  assert.ok(a.keywords.tiers[1].length > 0 && a.keywords.tiers[1].length <= 15, 'Tier 1 stays a shortlist');
  const t1 = a.keywords.tiers[1].map((k) => k.importance);
  assert.ok(Math.min(...t1) >= Math.max(...a.keywords.tiers[3].map((k) => k.importance)), 'tiers are ordered by importance');
});

test('handles a job title with no JD text at all', () => {
  const jd = analyzeJobDescription('', { jobTitle: 'Key Account Manager' });
  assert.match(jd.role.jobTitle.toLowerCase(), /key account manager/);
  assert.equal(jd.quality, 'thin');
});

/* ================================================================== *
 * 4. Keyword and evidence classification (spec §11, §13)
 * ================================================================== */

test('distinguishes exact, related, possible and missing evidence', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_OPERATIONS_MANAGER });
  const by = (term) => a.keywords.keywords.find((k) => k.canonical === term);

  assert.equal(by('vendor management').status, MATCH.EXACT);
  assert.equal(by('power bi').status, MATCH.MISSING, 'a tool never mentioned is missing, not inferred');

  // "turnaround time" is adjacent evidence for SLA management, not the claim itself.
  assert.equal(by('sla management').status, MATCH.POSSIBLE);
  assert.ok(by('sla management').evidence, 'the evidence sentence is shown so the candidate can judge it');
});

test('coverage counts only exact and related matches', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_OPERATIONS_MANAGER });
  const { exact, related, total, coverage } = a.keywords.summary;
  assert.equal(coverage, Math.round(((exact + related) / total) * 100));
});

test('missing Tier 1 keywords become questions, never silent additions', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_OPERATIONS_MANAGER });
  const resumeText = JSON.stringify(a.resume).toLowerCase();
  assert.ok(!resumeText.includes('power bi'), 'a missing skill is never written into the resume');
  assert.ok(a.questions.length > 0, 'the candidate is asked instead');
});

test('a candidate whose skills are absent from the JD is not marked down for them', () => {
  const a = analyzeCandidate(parse(F.FIVE_YEARS), { jobDescription: F.JD_SOFTWARE });
  // Kafka and Docker are on the CV; Kafka is only "preferred" in the JD.
  assert.ok(a.match.overall >= 60, `expected a strong match, got ${a.match.overall}`);
  assert.ok(a.health.categories.skillsCoverage.score >= 50);
});

test('a JD in an unrelated field produces a low match with an explanation, not an error', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_UNRELATED });
  assert.ok(a.match.overall < 55, `expected a weak match, got ${a.match.overall}`);
  assert.ok(a.match.weakestAreas.length > 0);
  assert.ok(a.match.dimensions.skills.reason, 'every dimension explains itself');
});

/* ================================================================== *
 * 5. Resume health and the ATS checklist (spec §18, §19, §38)
 * ================================================================== */

test('health score is explainable and carries the methodology disclaimer', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_OPERATIONS_MANAGER });
  const h = a.health;

  assert.ok(h.score >= 0 && h.score <= 100);
  assert.ok(h.methodology.length > 20);
  assert.match(h.methodology, /not a guarantee/i);

  const weightSum = Object.values(h.categories).reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(weightSum - 100) <= 1, `weights should sum to 100, got ${weightSum}`);

  Object.values(h.categories).forEach((c) => {
    assert.ok(c.score >= 0 && c.score <= 100);
    assert.ok(typeof c.label === 'string' && c.label.length > 0);
  });
});

test('no output anywhere claims guaranteed ATS acceptance or a job', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_OPERATIONS_MANAGER });
  const blob = JSON.stringify(a).toLowerCase();
  ['guaranteed to pass', 'guarantee you a job', 'will get you hired', 'works with every ats', 'guaranteed interview']
    .forEach((phrase) => assert.ok(!blob.includes(phrase), `found forbidden claim: ${phrase}`));
});

test('scoring without a JD drops the categories that need one', () => {
  const withJd = analyzeCandidate(parse(F.TEN_YEARS_MANAGER), { jobDescription: F.JD_OPERATIONS_MANAGER }).health;
  const without = analyzeCandidate(parse(F.TEN_YEARS_MANAGER)).health;

  assert.equal(withJd.scoredAgainstJd, true);
  assert.equal(without.scoredAgainstJd, false);
  assert.ok(!without.categories.keywordAlignment, 'keyword alignment cannot be scored honestly with no target');
  const weightSum = Object.values(without.categories).reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(weightSum - 100) <= 1);
});

test('the ATS checklist reports pass/fail per check with a reason', () => {
  const a = analyzeCandidate(parse(F.TEN_YEARS_MANAGER));
  assert.ok(a.health.checklist.length >= 15);
  a.health.checklist.forEach((c) => {
    assert.equal(typeof c.pass, 'boolean');
    assert.ok(c.label && c.id);
    if (!c.pass) assert.ok(c.detail, `failed check ${c.id} must say why`);
  });
});

test('a CV with no numbers is told so, specifically', () => {
  const a = analyzeCandidate(parse(F.NO_METRICS));
  assert.ok(a.health.categories.achievementStrength.score < 55);
  const quantified = a.health.checklist.find((c) => /quantif/i.test(c.id + c.label));
  assert.equal(quantified.pass, false);
});

test('conflicting dates are caught by the date check', () => {
  const a = analyzeCandidate(parse(F.CONFLICTING_DATES));
  const dateCheck = a.health.checklist.find((c) => /dateConsistency/i.test(c.id));
  assert.equal(dateCheck.pass, false, 'an end date before its start date must fail');
});

/* ================================================================== *
 * 6. Integrity: the rule the product is built on (spec §2, §27, §33)
 * ================================================================== */

test('a fabricated metric is caught and blocks export', () => {
  const baseline = parse(F.TEN_YEARS_MANAGER);
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.experience[0].achievements.push('Increased revenue by 45% year on year');

  const result = validateIntegrity(tampered, baseline, { confirmedFacts: [] });
  assert.equal(result.passed, false);
  assert.equal(result.blocked, true);
  assert.ok(result.findings.some((f) => /45/.test(JSON.stringify(f))));
});

test('a fabricated employer, degree or certification is caught', () => {
  const baseline = parse(F.TEN_YEARS_MANAGER);

  const withEmployer = JSON.parse(JSON.stringify(baseline));
  withEmployer.experience[0].company = 'Goldman Sachs';
  assert.equal(validateIntegrity(withEmployer, baseline).passed, false);

  const withCert = JSON.parse(JSON.stringify(baseline));
  withCert.certifications.push({ name: 'PMP', issuer: '', issueDate: '', expiryDate: '', credentialId: '', link: '' });
  assert.equal(validateIntegrity(withCert, baseline).passed, false);

  const withDegree = JSON.parse(JSON.stringify(baseline));
  withDegree.education[0].degree = 'PhD';
  assert.equal(validateIntegrity(withDegree, baseline).passed, false);
});

test('a confirmed fact makes the same number acceptable', () => {
  const baseline = parse(F.TEN_YEARS_MANAGER);
  const edited = JSON.parse(JSON.stringify(baseline));
  edited.experience[0].achievements.push('Improved first-pass accuracy by 15% across the onboarding queue');

  const blocked = validateIntegrity(edited, baseline, { confirmedFacts: [] });
  assert.equal(blocked.passed, false);

  const allowed = validateIntegrity(edited, baseline, {
    confirmedFacts: [
      {
        questionId: 'q1',
        claim: 'first-pass accuracy',
        field: 'outcome',
        value: '15%',
        confirmed: true,
        confirmedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(allowed.passed, true, 'a candidate-confirmed number is allowed through');
});

test('rewording without changing facts passes the integrity check', () => {
  const baseline = parse(F.TEN_YEARS_MANAGER);
  const reworded = JSON.parse(JSON.stringify(baseline));
  reworded.experience[1].responsibilities = ['Managed customer escalations and issue resolution'];

  const result = validateIntegrity(reworded, baseline);
  assert.equal(result.blocked, false, 'a like-for-like rewrite is not a fabrication');
});

test('quality control runs all ten checks and reports blocking issues', () => {
  const baseline = parse(F.TEN_YEARS_MANAGER);
  const a = analyzeCandidate(baseline, { jobDescription: F.JD_OPERATIONS_MANAGER });

  const qc = runQualityControl(baseline, baseline, {
    health: a.health,
    jobIntel: a.jobIntel,
    keywordResult: a.keywords,
    profile: a.profile,
    confirmedFacts: [],
  });

  assert.equal(qc.checks.length, 10);
  qc.checks.forEach((c) => assert.ok(c.id && c.label && typeof c.passed === 'boolean'));
  assert.equal(typeof qc.exportBlocked, 'boolean');
});

test('keyword stuffing is detected', () => {
  const baseline = parse(F.TEN_YEARS_MANAGER);
  const stuffed = JSON.parse(JSON.stringify(baseline));
  stuffed.summary = 'Vendor management. Vendor management expert with vendor management skills and vendor management experience delivering vendor management outcomes through vendor management.';

  const a = analyzeCandidate(stuffed, { jobDescription: F.JD_OPERATIONS_MANAGER });
  const qc = runQualityControl(stuffed, baseline, {
    health: a.health,
    jobIntel: a.jobIntel,
    keywordResult: a.keywords,
    profile: a.profile,
  });
  const kw = qc.checks.find((c) => c.id === 'keywords');
  assert.equal(kw.passed, false);
});

/* ================================================================== *
 * 7. Achievement builder and rewriting (spec §14, §15, §29, §30)
 * ================================================================== */

test('an achievement bullet is built only from what the candidate answered', () => {
  const full = buildAchievementBullet({
    keyword: 'vendor management',
    answers: { scale: '30', type: 'vendors', method: 'process standardisation', outcome: 'a 20% drop in onboarding time' },
  });
  assert.ok(full.bullet.includes('30 vendors'));
  assert.ok(full.bullet.includes('20%'));
  // Every component traces back to a typed answer.
  full.evidence.forEach((e) => assert.equal(e.confirmed, true));

  // With no outcome the bullet simply ends earlier. It does not acquire one.
  const partial = buildAchievementBullet({
    keyword: 'vendor management',
    answers: { scale: '30', type: 'vendors' },
  });
  assert.ok(partial.bullet.includes('30 vendors'));
  assert.ok(!/\d+\s*%/.test(partial.bullet), 'no invented percentage');
  assert.equal(partial.components.result, null);

  // Nothing confirmed at all produces nothing, not a generic bullet.
  assert.equal(buildAchievementBullet({ keyword: '', answers: {} }), null);
});

test('the deterministic rewriter improves wording without inventing facts', () => {
  const before = 'Responsible for handling operations.';
  const after = deterministicRewrite(before, { keywords: [], seniority: 'manager' });

  assert.notEqual(after.text, before);
  assert.ok(!/responsible for/i.test(after.text), 'weak opener is replaced');
  assert.ok(!/\d/.test(after.text), 'no numbers appear from nowhere');
  assert.ok(after.reasons.length > 0, 'every change explains itself');
});

test('accept, edit and reject each do what they say', () => {
  const resume = parse(F.TEN_YEARS_MANAGER);
  const original = resume.experience[1].responsibilities[0];

  const proposals = [
    {
      id: 'experience.1.responsibilities.0',
      field: 'responsibilities',
      roleIndex: 1,
      index: 0,
      original,
      proposed: 'Managed customer escalations and issue resolution',
      reason: 'aligns with the wording the job description uses',
      evidence: 'VERIFIED',
      status: 'pending',
    },
  ];
  const pid = proposals[0].id;

  const accepted = applyDecisions(resume, [{ id: pid, action: 'accept' }], proposals);
  assert.equal(accepted.resume.experience[1].responsibilities[0], 'Managed customer escalations and issue resolution');
  assert.equal(accepted.changelog.length, 1);

  const rejected = applyDecisions(resume, [{ id: pid, action: 'reject' }], proposals);
  assert.equal(rejected.resume.experience[1].responsibilities[0], original);

  const edited = applyDecisions(resume, [{ id: pid, action: 'edit', text: 'Resolved customer escalations end to end' }], proposals);
  assert.equal(edited.resume.experience[1].responsibilities[0], 'Resolved customer escalations end to end');
});

test('applying changes never touches the original source record', () => {
  const resume = parse(F.TEN_YEARS_MANAGER);
  const rawBefore = resume._source.rawText;

  const proposals = [
    {
      id: 'summary',
      field: 'summary',
      original: resume.summary,
      proposed: 'Operations manager with ten years in payments operations.',
      reason: 'sharper and more specific',
      evidence: 'VERIFIED',
      status: 'pending',
    },
  ];
  const { resume: updated } = applyDecisions(resume, [{ id: 'summary', action: 'accept' }], proposals);

  assert.equal(updated._source.rawText, rawBefore, 'the uploaded CV text is immutable');
});

/* ================================================================== *
 * 8. Targeted versions and the master profile (spec §17, §43, §44)
 * ================================================================== */

test('a targeted version shortens less relevant roles without deleting them', () => {
  const master = parse(F.TEN_YEARS_MANAGER);
  const a = analyzeCandidate(master, { jobDescription: F.JD_OPERATIONS_MANAGER });
  const targeted = deriveTargetedResume(master, { jobIntel: a.jobIntel, keywordResult: a.keywords });

  assert.equal(targeted.experience.length, master.experience.length, 'no role is dropped');
  assert.equal(master.experience[1].responsibilities.length, 2, 'the master is not mutated');

  const masterBullets = master.experience.reduce((n, e) => n + e.responsibilities.length + e.achievements.length, 0);
  const targetedBullets = targeted.experience.reduce((n, e) => n + e.responsibilities.length + e.achievements.length, 0);
  assert.ok(targetedBullets <= masterBullets);
});

/* ================================================================== *
 * 9. Templates (spec §20, §21, §26)
 * ================================================================== */

test('all ten templates render the same resume JSON without duplicated logic', () => {
  const resume = parse(F.TEN_YEARS_MANAGER);
  const templates = listTemplates();
  assert.equal(templates.length, 10);

  templates.forEach((t) => {
    const { html } = renderResume(resume, t.id);
    assert.ok(html.includes('Priya Sharma'), `${t.id} is missing the candidate name`);
    assert.ok(html.includes('PayNext Technologies'), `${t.id} is missing an employer`);
    assert.match(html, /<h[12]/, `${t.id} has no semantic headings`);
  });
});

test('rendered resumes follow the ATS-first rules', () => {
  const resume = parse(F.TEN_YEARS_MANAGER);
  listTemplates().forEach((t) => {
    const { html } = renderResume(resume, t.id);
    assert.ok(!/<img/i.test(html), `${t.id} embeds an image`);
    assert.ok(!/skill-bar|progress|meter/i.test(html), `${t.id} uses a skill bar`);
    assert.ok(/@page/.test(html), `${t.id} has no A4 print geometry`);
  });
});

test('an unknown template id falls back instead of throwing', () => {
  const resume = parse(F.FRESHER);
  const { template, html } = renderResume(resume, 'not-a-template');
  assert.ok(typeof template === 'string' && template.length > 0, 'falls back to a real template');
  assert.ok(listTemplates().some((t) => t.id === template));
  assert.ok(html.includes('Aarav Menon'));
});

/* ================================================================== *
 * 10. End-to-end journeys (spec §42)
 * ================================================================== */

const JOURNEYS = [
  ['fresher', F.FRESHER, F.JD_SOFTWARE],
  ['two-year professional', F.TWO_YEARS, F.JD_OPERATIONS_MANAGER],
  ['five-year professional', F.FIVE_YEARS, F.JD_SOFTWARE],
  ['ten-year manager', F.TEN_YEARS_MANAGER, F.JD_OPERATIONS_MANAGER],
  ['executive', F.EXECUTIVE, F.JD_OPERATIONS_MANAGER],
  ['career changer', F.CAREER_CHANGER, F.JD_OPERATIONS_MANAGER],
  ['employment gap', F.EMPLOYMENT_GAP, F.JD_OPERATIONS_MANAGER],
  ['poorly formatted CV', F.POORLY_FORMATTED, F.JD_OPERATIONS_MANAGER],
  ['conflicting dates', F.CONFLICTING_DATES, F.JD_OPERATIONS_MANAGER],
  ['no metrics', F.NO_METRICS, F.JD_OPERATIONS_MANAGER],
  ['missing information', F.MISSING_INFORMATION, F.JD_THIN],
  ['keyword-stuffed JD', F.TEN_YEARS_MANAGER, F.JD_KEYWORD_STUFFED],
  ['unrelated JD', F.TEN_YEARS_MANAGER, F.JD_UNRELATED],
];

JOURNEYS.forEach(([label, cv, jd]) => {
  test(`journey: ${label} — upload to export produces a complete, explainable result`, () => {
    const resume = parse(cv);
    const a = analyzeCandidate(resume, { jobDescription: jd });

    assert.ok(a.health.score >= 0 && a.health.score <= 100);
    assert.ok(a.health.band.label);
    assert.ok(Array.isArray(a.recommendations) && a.recommendations.length > 0);
    a.recommendations.forEach((r) => {
      assert.ok(r.title, 'every recommendation has a title');
      assert.ok(r.body, 'every recommendation says why it is being suggested');
      assert.ok(r.cta?.to, 'every recommendation goes somewhere');
    });

    assert.ok(a.match.overall >= 0 && a.match.overall <= 100);
    assert.ok(a.suggestedTemplate);

    const { html } = renderResume(resume, a.suggestedTemplate);
    assert.ok(html.length > 500);

    const qc = runQualityControl(resume, resume, {
      health: a.health,
      jobIntel: a.jobIntel,
      keywordResult: a.keywords,
      profile: a.profile,
    });
    assert.equal(qc.checks.length, 10);
  });
});

test('analysis is stable: the same input gives the same score', () => {
  const resume = parse(F.TEN_YEARS_MANAGER);
  const first = analyzeCandidate(resume, { jobDescription: F.JD_OPERATIONS_MANAGER });
  const second = analyzeCandidate(resume, { jobDescription: F.JD_OPERATIONS_MANAGER });
  assert.equal(first.health.score, second.health.score);
  assert.equal(first.match.overall, second.match.overall);
});

test('the evidence vocabulary is the one the spec defines', () => {
  assert.deepEqual(Object.values(EVIDENCE).sort(), ['INFERRED', 'MISSING', 'UNVERIFIED', 'VERIFIED']);
  assert.deepEqual(Object.values(MATCH).sort(), ['EXACT', 'MISSING', 'POSSIBLE', 'RELATED']);
});
