import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeText, parseResumeJson } from '../services/careerIntelligence/index.js';

/**
 * Reading resumes back in — including PDFs downloaded from DutyLaunch's
 * own Resume Builder (text as extracted from the PDF, with its quirks).
 */
const parse = (text) => parseResumeJson(parseResumeText(text, { fileName: 't.pdf' }));

// Exactly what the PDF text layer of a DutyLaunch "ATS Classic" resume gives.
const DUTYLAUNCH_PDF = `Srinivas sutar
web developer
sjsjasss2001@gmail.com | 9538281101 | bengaluru, India 560001 | www.sjsjasss.com | www.sjsjasss.com
PROFESSIONAL SUMMARY
Web developer experienced in building responsive, fast and user-friendly websites. Eager to grow with a team building modern web products.
PROFESSIONAL EXPERIENCE
Web developer2023 – 2025
Skyup digital solutions llpBengaluru
Built responsive websites and web apps using HTML, CSS, JavaScript and React.
Converted Figma designs into pixel-perfect, mobile-friendly pages that work across all major browsers.
Integrated REST APIs and third-party services such as payment gateways and email.
CORE COMPETENCIES & LEADERSHIP CAPABILITIES
HTML5 · CSS3 · JavaScript · React.js · Node.js · MongoDB · Git & GitHub
EDUCATION & ACADEMIC HONORS
Master's degree in Computer science2025
S-vyasa deemed to be university · Bengaluru
CERTIFICATIONS & CREDENTIALS
LANGUAGES
Kannada (Native) · hindi (Full Professional) · English (Full Professional)`;

test('a DutyLaunch resume PDF reads back: contact details', () => {
  const r = parse(DUTYLAUNCH_PDF);
  assert.equal(r.personal.name, 'Srinivas sutar');
  assert.equal(r.personal.headline, 'web developer');
  assert.equal(r.personal.email, 'sjsjasss2001@gmail.com');
  assert.equal(r.personal.phone, '9538281101');
  assert.equal(r.personal.location, 'bengaluru, India 560001');
  assert.equal(r.personal.website, 'www.sjsjasss.com');
});

test('a DutyLaunch resume PDF reads back: job with all bullets, glued dates fixed', () => {
  const r = parse(DUTYLAUNCH_PDF);
  assert.equal(r.experience.length, 1);
  const j = r.experience[0];
  assert.equal(j.title, 'Web developer');
  assert.equal(j.company, 'Skyup digital solutions llp');
  assert.equal(j.location, 'Bengaluru');
  assert.equal(j.startDate, '2023');
  assert.equal(j.endDate, '2025');
  const bullets = [...j.achievements, ...j.responsibilities];
  assert.equal(bullets.length, 3, 'the first duty line is not swallowed by the header');
  assert.ok(!bullets.some((b) => /COMPETENCIES|EDUCATION/.test(b)), 'skills/education headings are not bullets');
});

test('a DutyLaunch resume PDF reads back: one education entry, degree + field + place', () => {
  const r = parse(DUTYLAUNCH_PDF);
  assert.equal(r.education.length, 1, '"deemed to be university" is not a second (B.E.) degree');
  const e = r.education[0];
  assert.equal(e.degree, "Master's degree");
  assert.equal(e.field, 'Computer science');
  assert.equal(e.institution, 'S-vyasa deemed to be university');
  assert.equal(e.location, 'Bengaluru');
  assert.equal(e.endDate, '2025');
});

test('a DutyLaunch resume PDF reads back: skills and languages', () => {
  const r = parse(DUTYLAUNCH_PDF);
  const skills = Object.values(r.skills).flat().map((s) => s.toLowerCase());
  assert.ok(skills.some((s) => s.includes('react')));
  assert.ok(skills.some((s) => s.includes('mongodb')));
  assert.deepEqual(r.languages.map((l) => l.name.toLowerCase()), ['kannada', 'hindi', 'english']);
});

test('ordinary resumes still parse: bullets, +91 phone, B.E. degree, job title with "Experience"', () => {
  const r = parse(`Priya Sharma
Customer Experience Manager
priya2019@gmail.com | +91 98450 12345 | Pune, Maharashtra

EXPERIENCE
Customer Experience Manager
Acme Retail Pvt Ltd, Pune | Jan 2021 – Present
• Led a team of 12 support agents across chat and phone.
• Cut average response time by 30% in six months.

EDUCATION
B.E. in Mechanical Engineering
College of Engineering Pune, 2018`);
  assert.equal(r.personal.name, 'Priya Sharma');
  assert.equal(r.personal.email, 'priya2019@gmail.com', 'years inside emails are not split');
  assert.match(r.personal.phone, /98450\s?12345/);
  assert.equal(r.personal.location, 'Pune, Maharashtra');
  assert.equal(r.experience.length, 1, '"Customer Experience Manager" is a job title, not a heading');
  assert.equal(r.experience[0].achievements.length + r.experience[0].responsibilities.length, 2);
  assert.equal(r.education.length, 1);
  assert.match(r.education[0].degree, /B\.E/);
});

test('section headings do not become skills', () => {
  const skills = Object.values(parse(DUTYLAUNCH_PDF).skills).flat().map((s) => s.toLowerCase());
  assert.ok(!skills.includes('leadership'), '"Core Competencies & Leadership Capabilities" is a heading');
});
