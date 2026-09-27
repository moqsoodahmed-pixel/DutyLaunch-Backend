/**
 * AGENT 9 — Template Renderer (spec §20, §21).
 *
 * ONE renderer. Ten templates. Every template is a set of design tokens
 * plus a section order — no template contains resume logic, which is what
 * lets a candidate switch template without rewriting a word (spec §20).
 *
 * ATS-first rules baked into the renderer, not left to each template
 * (spec §21):
 *   - semantic headings (h1/h2) with standard section names
 *   - real selectable text; no text inside images, ever
 *   - no skill bars, no percentage meters, no decorative icons
 *   - single-column content flow; the "two column" templates put only
 *     non-critical side content in the second column and still emit it in
 *     a linear reading order in the DOM
 *   - no critical information in headers or footers
 *   - A4 print geometry with real page margins
 */

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

const BASE_SECTIONS = [
  'summary',
  'experience',
  'education',
  'skills',
  'certifications',
  'projects',
  'achievements',
  'awards',
  'languages',
  'volunteering',
  'publications',
  'professionalMemberships',
  'portfolio',
  'custom',
];

export const TEMPLATES = {
  'ats-classic': {
    id: 'ats-classic',
    name: 'ATS Classic',
    description: 'The safest possible structure. Serif headings, single column, nothing a parser can trip over.',
    bestFor: 'Any role where you want zero formatting risk.',
    tokens: {
      fontBody: "'Georgia', 'Times New Roman', serif",
      fontHeading: "'Georgia', 'Times New Roman', serif",
      accent: '#1a1a1a',
      rule: '#333333',
      headingSize: '11.5pt',
      nameSize: '22pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.08em',
      sectionRule: 'solid',
      layout: 'single',
    },
    sections: BASE_SECTIONS,
  },
  'ats-modern': {
    id: 'ats-modern',
    name: 'ATS Modern',
    description: 'Clean sans-serif with a restrained accent colour. Contemporary without being risky.',
    bestFor: 'Most professional roles in most industries.',
    tokens: {
      fontBody: "'Helvetica Neue', Arial, sans-serif",
      fontHeading: "'Helvetica Neue', Arial, sans-serif",
      accent: '#1D5DB8',
      rule: '#D6DCE5',
      headingSize: '11pt',
      nameSize: '24pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.1em',
      sectionRule: 'solid',
      layout: 'single',
    },
    sections: BASE_SECTIONS,
  },
  'ats-executive': {
    id: 'ats-executive',
    name: 'ATS Executive',
    description: 'Generous spacing, prominent name, impact-led. Built for short, consequential content.',
    bestFor: 'Director, VP and C-suite candidates.',
    tokens: {
      fontBody: "'Georgia', 'Times New Roman', serif",
      fontHeading: "'Helvetica Neue', Arial, sans-serif",
      accent: '#0B1F48',
      rule: '#B9C2CF',
      headingSize: '11pt',
      nameSize: '28pt',
      bodySize: '11pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.14em',
      sectionRule: 'double',
      layout: 'single',
    },
    sections: ['summary', 'experience', 'achievements', 'skills', 'education', 'certifications', 'awards', 'professionalMemberships', 'languages', 'custom'],
  },
  'ats-minimal': {
    id: 'ats-minimal',
    name: 'ATS Minimal',
    description: 'No rules, no colour, maximum content density. Every millimetre goes to text.',
    bestFor: 'Long histories that need to fit two pages.',
    tokens: {
      fontBody: "Arial, Helvetica, sans-serif",
      fontHeading: "Arial, Helvetica, sans-serif",
      accent: '#000000',
      rule: 'transparent',
      headingSize: '10.5pt',
      nameSize: '19pt',
      bodySize: '10pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.06em',
      sectionRule: 'none',
      layout: 'single',
    },
    sections: BASE_SECTIONS,
  },
  'ats-fresher': {
    id: 'ats-fresher',
    name: 'ATS Fresher',
    description: 'Education, projects and skills lead. Employment history sits below, not above.',
    bestFor: 'Students, graduates and candidates with under two years of experience.',
    tokens: {
      fontBody: "'Helvetica Neue', Arial, sans-serif",
      fontHeading: "'Helvetica Neue', Arial, sans-serif",
      accent: '#1D5DB8',
      rule: '#D6DCE5',
      headingSize: '11pt',
      nameSize: '23pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.09em',
      sectionRule: 'solid',
      layout: 'single',
    },
    sections: ['summary', 'education', 'projects', 'skills', 'experience', 'certifications', 'achievements', 'volunteering', 'languages', 'portfolio', 'custom'],
  },
  'ats-technology': {
    id: 'ats-technology',
    name: 'ATS Technology',
    description: 'Skills and projects promoted above employment. Monospace accents for technical terms.',
    bestFor: 'Engineers, developers, data and infrastructure roles.',
    tokens: {
      fontBody: "'Helvetica Neue', Arial, sans-serif",
      fontHeading: "'SF Mono', 'Consolas', 'Courier New', monospace",
      accent: '#0F766E',
      rule: '#CBD5E1',
      headingSize: '10.5pt',
      nameSize: '22pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.08em',
      sectionRule: 'solid',
      layout: 'single',
    },
    sections: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'publications', 'portfolio', 'achievements', 'custom'],
  },
  'ats-finance': {
    id: 'ats-finance',
    name: 'ATS Finance',
    description: 'Conservative serif, tabular figures, credentials prominent.',
    bestFor: 'Banking, accounting, audit, FP&A and risk.',
    tokens: {
      fontBody: "'Georgia', 'Times New Roman', serif",
      fontHeading: "'Georgia', 'Times New Roman', serif",
      accent: '#14532D',
      rule: '#94A3B8',
      headingSize: '11pt',
      nameSize: '22pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.1em',
      sectionRule: 'solid',
      layout: 'single',
      tabularFigures: true,
    },
    sections: ['summary', 'experience', 'education', 'certifications', 'skills', 'achievements', 'professionalMemberships', 'languages', 'custom'],
  },
  'ats-sales': {
    id: 'ats-sales',
    name: 'ATS Sales',
    description: 'Achievements pulled out ahead of duties, so numbers land first.',
    bestFor: 'Sales, business development and account management.',
    tokens: {
      fontBody: "'Helvetica Neue', Arial, sans-serif",
      fontHeading: "'Helvetica Neue', Arial, sans-serif",
      accent: '#B45309',
      rule: '#D6DCE5',
      headingSize: '11pt',
      nameSize: '24pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.1em',
      sectionRule: 'solid',
      layout: 'single',
      achievementsFirst: true,
    },
    sections: ['summary', 'achievements', 'experience', 'skills', 'education', 'certifications', 'awards', 'languages', 'custom'],
  },
  'ats-operations': {
    id: 'ats-operations',
    name: 'ATS Operations',
    description: 'Structured for process, scale and metrics. Skills grouped by type.',
    bestFor: 'Operations, supply chain, logistics and process roles.',
    tokens: {
      fontBody: "'Helvetica Neue', Arial, sans-serif",
      fontHeading: "'Helvetica Neue', Arial, sans-serif",
      accent: '#1E4080',
      rule: '#CBD5E1',
      headingSize: '11pt',
      nameSize: '22pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.09em',
      sectionRule: 'solid',
      layout: 'single',
      groupSkills: true,
    },
    sections: ['summary', 'experience', 'skills', 'achievements', 'certifications', 'education', 'projects', 'languages', 'custom'],
  },
  'ats-international': {
    id: 'ats-international',
    name: 'ATS International',
    description: 'Languages and mobility surfaced early; neutral typography that renders anywhere.',
    bestFor: 'UAE, Gulf and other cross-border applications.',
    tokens: {
      fontBody: "Arial, 'Helvetica Neue', sans-serif",
      fontHeading: "Arial, 'Helvetica Neue', sans-serif",
      accent: '#0B1F48',
      rule: '#CBD5E1',
      headingSize: '11pt',
      nameSize: '23pt',
      bodySize: '10.5pt',
      headingTransform: 'uppercase',
      headingLetterSpacing: '0.1em',
      sectionRule: 'solid',
      layout: 'single',
    },
    sections: ['summary', 'experience', 'skills', 'education', 'certifications', 'languages', 'achievements', 'projects', 'portfolio', 'custom'],
  },
};

export function listTemplates() {
  return Object.values(TEMPLATES).map(({ id, name, description, bestFor }) => ({ id, name, description, bestFor }));
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '';
  if (value === 'present') return 'Present';
  const m = String(value).match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTH_NAMES[Number(m[2])]} ${m[1]}`;
  return String(value);
}

function dateRange(role) {
  const start = formatDate(role.startDate);
  const end = role.current ? 'Present' : formatDate(role.endDate);
  if (!start && !end) return '';
  return [start, end].filter(Boolean).join(' – ');
}

const SECTION_TITLES = {
  summary: 'Professional Summary',
  experience: 'Work Experience',
  education: 'Education',
  skills: 'Skills',
  certifications: 'Certifications',
  projects: 'Projects',
  achievements: 'Achievements',
  awards: 'Awards',
  languages: 'Languages',
  volunteering: 'Volunteering',
  publications: 'Publications',
  professionalMemberships: 'Professional Memberships',
  portfolio: 'Portfolio',
};

const SKILL_GROUP_TITLES = {
  technical: 'Technical',
  functional: 'Functional',
  tools: 'Tools',
  soft: 'Soft skills',
  industry: 'Industry',
};

/* ------------------------------------------------------------------ *
 * Section renderers
 * ------------------------------------------------------------------ */

function renderList(items) {
  const clean = (items || []).filter((i) => String(i || '').trim());
  if (!clean.length) return '';
  return `<ul>${clean.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function renderExperience(resume, template) {
  const roles = resume.experience || [];
  if (!roles.length) return '';

  return roles
    .map((role) => {
      const bullets = template.tokens.achievementsFirst
        ? [...(role.achievements || []), ...(role.responsibilities || [])]
        : [...(role.responsibilities || []), ...(role.achievements || [])];

      const meta = [role.location, role.employmentType].filter(Boolean).join(' · ');

      return `<article class="entry">
  <div class="entry-head">
    <div class="entry-main">
      <h3>${esc(role.title || 'Role')}</h3>
      <p class="entry-org">${esc(role.company || '')}${meta ? ` <span class="entry-meta">· ${esc(meta)}</span>` : ''}</p>
    </div>
    <p class="entry-dates">${esc(dateRange(role))}</p>
  </div>
  ${renderList(bullets)}
</article>`;
    })
    .join('');
}

function renderEducation(resume) {
  const items = resume.education || [];
  if (!items.length) return '';

  return items
    .map((e) => {
      const line = [e.degree, e.field].filter(Boolean).join(', ');
      const dates = [formatDate(e.startDate), formatDate(e.endDate)].filter(Boolean).join(' – ');
      return `<article class="entry">
  <div class="entry-head">
    <div class="entry-main">
      <h3>${esc(line || e.institution || 'Qualification')}</h3>
      <p class="entry-org">${esc(e.institution || '')}${e.grade ? ` <span class="entry-meta">· ${esc(e.grade)}</span>` : ''}</p>
    </div>
    <p class="entry-dates">${esc(dates)}</p>
  </div>
  ${renderList(e.highlights)}
</article>`;
    })
    .join('');
}

function renderSkills(resume, template) {
  const skills = resume.skills || {};
  const groups = Object.entries(skills).filter(([, list]) => (list || []).length);
  if (!groups.length) return '';

  // Grouped output is more useful to a human reader; a flat comma list
  // parses marginally more reliably. Templates choose. No skill bars or
  // percentage meters are emitted in either mode (spec §21).
  if (template.tokens.groupSkills) {
    return `<div class="skill-groups">${groups
      .map(
        ([key, list]) =>
          `<p class="skill-group"><span class="skill-label">${esc(SKILL_GROUP_TITLES[key] || key)}:</span> ${esc(list.join(', '))}</p>`
      )
      .join('')}</div>`;
  }

  const flat = groups.flatMap(([, list]) => list);
  return `<p class="skill-flat">${esc(flat.join(' · '))}</p>`;
}

function renderCertifications(resume) {
  const items = (resume.certifications || []).filter((c) => c.name);
  if (!items.length) return '';
  return `<ul>${items
    .map((c) => {
      const meta = [c.issuer, formatDate(c.issueDate)].filter(Boolean).join(', ');
      return `<li>${esc(c.name)}${meta ? ` <span class="entry-meta">— ${esc(meta)}</span>` : ''}</li>`;
    })
    .join('')}</ul>`;
}

function renderProjects(resume) {
  const items = (resume.projects || []).filter((p) => p.name);
  if (!items.length) return '';
  return items
    .map((p) => {
      const dates = [formatDate(p.startDate), formatDate(p.endDate)].filter(Boolean).join(' – ');
      return `<article class="entry">
  <div class="entry-head">
    <div class="entry-main">
      <h3>${esc(p.name)}</h3>
      ${p.technologies?.length ? `<p class="entry-org"><span class="entry-meta">${esc(p.technologies.join(', '))}</span></p>` : ''}
    </div>
    ${dates ? `<p class="entry-dates">${esc(dates)}</p>` : ''}
  </div>
  ${p.description ? `<p>${esc(p.description)}</p>` : ''}
  ${renderList(p.highlights)}
</article>`;
    })
    .join('');
}

function renderLanguages(resume) {
  const items = resume.languages || [];
  if (!items.length) return '';
  const text = items
    .map((l) => (typeof l === 'string' ? l : [l.name, l.proficiency].filter(Boolean).join(' (') + (l.proficiency ? ')' : '')))
    .filter(Boolean)
    .join(' · ');
  return `<p class="skill-flat">${esc(text)}</p>`;
}

function renderSection(key, resume, template) {
  switch (key) {
    case 'summary':
      return resume.summary?.trim() ? `<p>${esc(resume.summary)}</p>` : '';
    case 'experience':
      return renderExperience(resume, template);
    case 'education':
      return renderEducation(resume);
    case 'skills':
      return renderSkills(resume, template);
    case 'certifications':
      return renderCertifications(resume);
    case 'projects':
      return renderProjects(resume);
    case 'languages':
      return renderLanguages(resume);
    case 'achievements':
      return renderList(resume.achievements);
    case 'awards':
      return renderList(resume.awards);
    case 'volunteering':
      return renderList(resume.volunteering);
    case 'publications':
      return renderList(resume.publications);
    case 'professionalMemberships':
      return renderList(resume.professionalMemberships);
    case 'portfolio':
      return renderList(resume.portfolio);
    default:
      return '';
  }
}

/* ------------------------------------------------------------------ *
 * Stylesheet
 * ------------------------------------------------------------------ */

function stylesheet(tokens) {
  const ruleStyle =
    tokens.sectionRule === 'none'
      ? 'border-bottom: none;'
      : tokens.sectionRule === 'double'
        ? `border-bottom: 3px double ${tokens.rule};`
        : `border-bottom: 1px solid ${tokens.rule};`;

  return `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #F1F5F9; }

body {
  font-family: ${tokens.fontBody};
  font-size: ${tokens.bodySize};
  line-height: 1.45;
  color: #111827;
  ${tokens.tabularFigures ? 'font-variant-numeric: tabular-nums;' : ''}
}

/* A4 page geometry. Real margins so nothing sits in a printer's
   unprintable area, and no content in a running header or footer. */
.page {
  width: 210mm;
  min-height: 297mm;
  margin: 12mm auto;
  padding: 16mm 15mm;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15,28,46,0.12), 0 8px 24px rgba(15,28,46,0.08);
}

header.resume-header { margin-bottom: 14px; }
h1 {
  font-family: ${tokens.fontHeading};
  font-size: ${tokens.nameSize};
  line-height: 1.1;
  margin: 0 0 4px;
  color: ${tokens.accent};
  letter-spacing: -0.01em;
}
.headline { margin: 0 0 6px; font-size: ${tokens.bodySize}; font-weight: 600; color: #374151; }
.contact { margin: 0; font-size: 9.5pt; color: #4B5563; }
.contact span + span::before { content: " · "; color: #9CA3AF; }

section { margin-top: 15px; }
h2 {
  font-family: ${tokens.fontHeading};
  font-size: ${tokens.headingSize};
  text-transform: ${tokens.headingTransform};
  letter-spacing: ${tokens.headingLetterSpacing};
  color: ${tokens.accent};
  margin: 0 0 8px;
  padding-bottom: 3px;
  ${ruleStyle}
}

.entry { margin-bottom: 11px; page-break-inside: avoid; }
.entry:last-child { margin-bottom: 0; }
.entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.entry-main { flex: 1; min-width: 0; }
h3 { font-size: ${tokens.bodySize}; font-weight: 700; margin: 0; color: #111827; }
.entry-org { margin: 1px 0 0; font-size: ${tokens.bodySize}; color: #374151; }
.entry-meta { color: #6B7280; font-weight: 400; }
.entry-dates { margin: 0; font-size: 9.5pt; color: #4B5563; white-space: nowrap; }

ul { margin: 5px 0 0; padding-left: 16px; }
li { margin-bottom: 2.5px; }
p { margin: 0 0 4px; }

.skill-flat { line-height: 1.6; }
.skill-group { margin-bottom: 3px; }
.skill-label { font-weight: 700; color: #111827; }

@media print {
  html, body { background: #ffffff; }
  .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  @page { size: A4; margin: 16mm 15mm; }
  h2, h3 { page-break-after: avoid; }
  .entry, li { page-break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}`;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

/**
 * Renders Resume JSON to a complete, self-contained HTML document.
 *
 * @param {object} resume      Resume JSON
 * @param {string} templateId
 * @param {object} [opts]
 * @param {boolean} [opts.fragment]  return only the page body
 */
export function renderResume(resume, templateId = 'ats-modern', opts = {}) {
  const template = TEMPLATES[templateId] || TEMPLATES['ats-modern'];
  const p = resume.personal || {};

  const contactBits = [p.email, p.phone, p.location, p.linkedin, p.website]
    .filter(Boolean)
    .map((bit) => `<span>${esc(bit)}</span>`)
    .join('');

  const sections = template.sections
    .map((key) => {
      if (key === 'custom') {
        return (resume.customSections || [])
          .filter((s) => s.title && (s.items?.length || s.body))
          .map(
            (s) => `<section>
  <h2>${esc(s.title)}</h2>
  ${s.body ? `<p>${esc(s.body)}</p>` : ''}
  ${renderList(s.items)}
</section>`
          )
          .join('');
      }
      const body = renderSection(key, resume, template);
      if (!body) return '';
      return `<section>
  <h2>${esc(SECTION_TITLES[key] || key)}</h2>
  ${body}
</section>`;
    })
    .filter(Boolean)
    .join('\n');

  const page = `<div class="page">
  <header class="resume-header">
    <h1>${esc(p.name || 'Your Name')}</h1>
    ${p.headline ? `<p class="headline">${esc(p.headline)}</p>` : ''}
    ${contactBits ? `<p class="contact">${contactBits}</p>` : ''}
  </header>
${sections}
</div>`;

  if (opts.fragment) return { html: page, css: stylesheet(template.tokens), template: template.id };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name || 'Resume')} — Resume</title>
<style>${stylesheet(template.tokens)}</style>
</head>
<body>
${page}
</body>
</html>`;

  return { html, css: stylesheet(template.tokens), template: template.id };
}

/**
 * Picks a sensible default template for a candidate profile. A suggestion
 * only — the candidate always chooses.
 */
export function suggestTemplate(profile, jobIntel) {
  if (profile?.strategy === 'fresher') return 'ats-fresher';
  if (profile?.strategy === 'executive') return 'ats-executive';

  const family = (profile?.functionalRoles || [])[0];
  const byFamily = {
    technology: 'ats-technology',
    finance: 'ats-finance',
    sales: 'ats-sales',
    operations: 'ats-operations',
  };
  if (byFamily[family]) return byFamily[family];

  const country = jobIntel?.role?.country;
  if (country && country !== 'India') return 'ats-international';

  return 'ats-modern';
}
