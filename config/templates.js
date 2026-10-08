/**
 * Resume Builder templates: which are free and which must be bought.
 *
 * Keep in sync with the frontend's src/data/resumeTemplates.js (ids) and
 * getTemplatePricing() in src/components/cv/TemplateGallery.jsx. Older
 * "ats-…" alias ids map to the same template.
 *
 * Price per paid template, in rupees before GST: TEMPLATE_PRICE (default 199).
 */
export const TEMPLATES = {
  'dl-elite': { name: 'ATS Classic', free: true, aliases: ['ats-classic'] },
  'ats-minimal': { name: 'ATS Minimal', free: true, aliases: [] },
  'ats-fresher': { name: 'ATS Fresher', free: true, aliases: [] },
  'dl-tech': { name: 'ATS Technology', free: false, aliases: ['ats-technology'] },
  'dl-professional': { name: 'ATS Professional', free: false, aliases: ['ats-sales'] },
  'dl-executive': { name: 'ATS Executive', free: false, aliases: ['ats-executive'] },
  'dl-modern': { name: 'ATS Modern', free: false, aliases: ['ats-modern'] },
  'dl-finance': { name: 'ATS Finance', free: false, aliases: ['ats-finance'] },
  'dl-creative': { name: 'ATS Creative', free: false, aliases: ['ats-international'] },
};

const ALIAS = Object.fromEntries(
  Object.entries(TEMPLATES).flatMap(([id, t]) => [[id, id], ...t.aliases.map((a) => [a, id])])
);

/** Canonical template id, or null if unknown. */
export function canonicalTemplateId(id) {
  return ALIAS[String(id || '').trim()] || null;
}

export function templateInfo(id) {
  const key = canonicalTemplateId(id);
  return key ? { id: key, ...TEMPLATES[key] } : null;
}

export const FREE_TEMPLATE_IDS = Object.keys(TEMPLATES).filter((id) => TEMPLATES[id].free);
export const PAID_TEMPLATE_IDS = Object.keys(TEMPLATES).filter((id) => !TEMPLATES[id].free);

export function templatePrice() {
  const n = Number(process.env.TEMPLATE_PRICE ?? 199);
  return Number.isFinite(n) && n > 0 ? n : 199;
}
