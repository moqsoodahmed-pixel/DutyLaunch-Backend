/**
 * Scoring configuration (spec §18, §37).
 *
 * Every weight and threshold the Resume Health, Job Match and Skill Gap
 * engines use lives here — nothing is a magic number buried in a formula.
 * The admin dashboard can override any of this at runtime via the
 * ScoringConfig collection, which is why `resolveConfig` deep-merges rather
 * than replaces.
 *
 * The score must stay explainable (spec §18, §38): each weight below maps
 * to exactly one visible line in the candidate's breakdown.
 */

export const DEFAULT_CONFIG = {
  version: 1,

  /* --- Resume Health (spec §5, §18) ----------------------------- *
     Two weight sets. Without a target JD, keyword alignment and
     experience relevance cannot be measured honestly, so their weight is
     redistributed rather than scored against nothing. */
  health: {
    weightsWithJd: {
      atsStructure: 0.2,
      keywordAlignment: 0.18,
      experienceRelevance: 0.16,
      achievementStrength: 0.15,
      skillsCoverage: 0.12,
      readability: 0.1,
      completeness: 0.09,
    },
    weightsWithoutJd: {
      atsStructure: 0.27,
      achievementStrength: 0.22,
      skillsCoverage: 0.17,
      readability: 0.17,
      completeness: 0.17,
    },
    bands: [
      { min: 85, label: 'Strong', tone: 'success' },
      { min: 70, label: 'Good', tone: 'azure' },
      { min: 50, label: 'Needs work', tone: 'amber' },
      { min: 0, label: 'Weak', tone: 'danger' },
    ],
  },

  /* --- Job Match (spec §7) --------------------------------------- */
  match: {
    weights: {
      skills: 0.32,
      keywords: 0.22,
      experience: 0.2,
      seniority: 0.12,
      education: 0.09,
      location: 0.05,
    },
  },

  /* --- Length guidance by seniority (spec §19, §23) -------------- *
     Word counts, not page counts — pages depend on the template. */
  length: {
    fresher: { min: 220, ideal: [300, 550], max: 750 },
    entry: { min: 250, ideal: [320, 600], max: 800 },
    mid: { min: 300, ideal: [400, 750], max: 950 },
    senior: { min: 350, ideal: [450, 850], max: 1100 },
    manager: { min: 380, ideal: [500, 900], max: 1200 },
    'senior-manager': { min: 400, ideal: [500, 950], max: 1300 },
    director: { min: 400, ideal: [500, 1000], max: 1400 },
    vp: { min: 400, ideal: [500, 1000], max: 1500 },
    'c-suite': { min: 400, ideal: [500, 1000], max: 1500 },
  },

  /* --- Country conventions (spec §23) ---------------------------- *
     Presentation guidance only. No legal or recruitment claims are made,
     and nothing here changes a candidate's facts. */
  countries: {
    India: {
      label: 'India',
      photo: 'not expected',
      lengthNote: 'One to two pages is standard; two pages is normal beyond five years of experience.',
      contactNote: 'Include city and mobile number. A photo, date of birth and marital status are not required and are increasingly omitted.',
      dateFormat: 'DD/MM/YYYY',
      spelling: 'British',
    },
    UAE: {
      label: 'United Arab Emirates',
      photo: 'commonly included',
      lengthNote: 'Two pages is widely accepted.',
      contactNote: 'Candidates commonly include nationality and visa status. Both are optional — include them only if you choose to.',
      dateFormat: 'DD/MM/YYYY',
      spelling: 'British',
    },
    UK: {
      label: 'United Kingdom',
      photo: 'not expected',
      lengthNote: 'Two pages maximum is the norm.',
      contactNote: 'No photo, date of birth or marital status. City and county are enough for location.',
      dateFormat: 'DD/MM/YYYY',
      spelling: 'British',
    },
    USA: {
      label: 'United States',
      photo: 'not expected',
      lengthNote: 'One page under ten years of experience; two pages beyond it.',
      contactNote: 'No photo, date of birth, marital status or nationality. City and state are enough.',
      dateFormat: 'MM/DD/YYYY',
      spelling: 'American',
    },
    Canada: {
      label: 'Canada',
      photo: 'not expected',
      lengthNote: 'One to two pages.',
      contactNote: 'No photo or personal details beyond city and province.',
      dateFormat: 'MM/DD/YYYY',
      spelling: 'Canadian (mixed British/American)',
    },
    Australia: {
      label: 'Australia',
      photo: 'not expected',
      lengthNote: 'Two to three pages is accepted and common.',
      contactNote: 'No photo. Note your work rights if you are not a citizen or permanent resident.',
      dateFormat: 'DD/MM/YYYY',
      spelling: 'Australian (British-based)',
    },
    Singapore: {
      label: 'Singapore',
      photo: 'optional',
      lengthNote: 'Two pages maximum.',
      contactNote: 'Nationality and work-pass status are commonly stated.',
      dateFormat: 'DD/MM/YYYY',
      spelling: 'British',
    },
    Other: {
      label: 'Other',
      photo: 'optional',
      lengthNote: 'Two pages is a safe default.',
      contactNote: 'Include city, country, email and phone with the international dialling code.',
      dateFormat: 'DD/MM/YYYY',
      spelling: 'British',
    },
  },

  /* --- Integrity (spec §27, §33) --------------------------------- */
  integrity: {
    /* Findings at or above this severity block export until the candidate
       confirms or corrects them. */
    blockingSeverity: 'high',
    /* A generated number not present in the source is always high. */
    numberDriftSeverity: 'high',
  },
};

/** Deep merge, arrays replaced wholesale. */
function merge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object') {
      out[key] = merge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  });
  return out;
}

/** Applies an admin override document over the defaults. */
export function resolveConfig(override) {
  return merge(DEFAULT_CONFIG, override);
}

export function bandFor(score, config = DEFAULT_CONFIG) {
  return config.health.bands.find((b) => score >= b.min) || config.health.bands[config.health.bands.length - 1];
}

export function lengthGuidance(seniority, config = DEFAULT_CONFIG) {
  return config.length[seniority] || config.length.mid;
}

export function countryGuidance(country, config = DEFAULT_CONFIG) {
  return config.countries[country] || config.countries.Other;
}
