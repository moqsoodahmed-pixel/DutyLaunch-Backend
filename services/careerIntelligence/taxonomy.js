/**
 * DutyLaunch taxonomy — skills, synonyms, related concepts, roles, seniority.
 *
 * Deliberately data, not logic. The Keyword Intelligence and Skill Gap agents
 * read from here; nothing in this file knows how a score is computed.
 *
 * EXTENSIBILITY (spec §22): this is a seed taxonomy, not an allow-list. Any
 * term the Job Description agent extracts is analysed whether or not it
 * appears below — the taxonomy only *improves* classification (it turns a
 * MISSING into a RELATED when a synonym is present). Unknown job titles and
 * unknown skills fall through to JD-derived intelligence and still work.
 *
 * Admin note: this file is the default. `ScoringConfig.taxonomyOverrides` in
 * MongoDB is merged over it at runtime, so DutyLaunch staff can add terms
 * without a deploy.
 */

/* ------------------------------------------------------------------ *
 * 1. Synonyms — terms that mean the same thing.
 *    A candidate phrase matching any synonym counts as a SEMANTIC match
 *    for the canonical term (spec §11).
 * ------------------------------------------------------------------ */
export const SYNONYMS = {
  'vendor management': ['supplier management', 'supplier relationship management', 'vendor relations', 'third party management'],
  'stakeholder management': ['stakeholder engagement', 'business partnering', 'cross functional collaboration'],
  'project management': ['programme management', 'program management', 'project delivery', 'project coordination'],
  'people management': ['team management', 'team leadership', 'line management', 'staff management'],
  'process improvement': ['process excellence', 'continuous improvement', 'process optimisation', 'process optimization', 'process redesign', 'kaizen'],
  'customer success': ['client success', 'customer retention', 'account management'],
  'customer support': ['customer service', 'client servicing', 'helpdesk', 'service desk'],
  'business development': ['bd', 'new business', 'revenue growth', 'partnership development'],
  'data analysis': ['data analytics', 'analytics', 'business analysis', 'reporting and analysis'],
  'financial analysis': ['fp&a', 'financial planning and analysis', 'financial modelling', 'financial modeling'],
  'talent acquisition': ['recruitment', 'recruiting', 'hiring', 'sourcing'],
  'supply chain': ['scm', 'supply chain management', 'logistics management'],
  'quality assurance': ['qa', 'quality control', 'quality management'],
  'sla management': ['service level management', 'sla adherence', 'service level agreement'],
  'kpi': ['key performance indicator', 'performance metrics', 'metrics tracking', 'kpis'],
  'p&l': ['profit and loss', 'pnl', 'p and l'],
  'stakeholder communication': ['client communication', 'executive reporting', 'business reporting'],
  'change management': ['organisational change', 'organizational change', 'transformation management'],
  'risk management': ['risk assessment', 'risk mitigation', 'risk control'],
  'compliance': ['regulatory compliance', 'statutory compliance', 'governance'],
  'power bi': ['powerbi', 'microsoft power bi'],
  /* 'excel' and 'advanced excel' are kept apart on purpose. Treating
     them as one term means a CV that lists "Excel" gets reported as
     demonstrating "Advanced Excel", which is a claim the candidate never
     made. Plain Excel is registered below as *related* evidence for
     advanced Excel, so the gap shows as partial rather than met. */
  excel: ['ms excel', 'microsoft excel', 'msexcel'],
  'advanced excel': ['spreadsheet modelling', 'spreadsheet modeling', 'pivot tables', 'vlookup', 'power query', 'excel macros'],
  sql: ['mysql', 'postgresql', 'postgres', 'mssql', 'sql server', 'plsql', 't-sql'],
  javascript: ['js', 'es6', 'ecmascript'],
  typescript: ['ts'],
  react: ['reactjs', 'react.js'],
  'node.js': ['node', 'nodejs'],
  python: ['py'],
  aws: ['amazon web services'],
  gcp: ['google cloud', 'google cloud platform'],
  azure: ['microsoft azure'],
  kubernetes: ['k8s'],
  'ci/cd': ['continuous integration', 'continuous delivery', 'continuous deployment', 'devops pipeline'],
  'machine learning': ['ml', 'predictive modelling', 'predictive modeling'],
  'salesforce': ['sfdc', 'salesforce crm'],
  'sap': ['sap erp', 'sap mm', 'sap sd'],
  'erp': ['enterprise resource planning'],
  'crm': ['customer relationship management'],
  'digital marketing': ['online marketing', 'performance marketing'],
  seo: ['search engine optimisation', 'search engine optimization', 'organic search'],
  sem: ['paid search', 'ppc', 'google ads', 'adwords'],
  'account management': ['key account management', 'client management', 'relationship management'],
  'inventory management': ['stock management', 'inventory control'],
  'budget management': ['budgeting', 'cost control', 'budget ownership'],
  'training and development': ['l&d', 'learning and development', 'capability building'],
  'agile': ['scrum', 'kanban', 'sprint planning', 'agile delivery'],
  'business intelligence': ['bi', 'dashboarding', 'mis reporting'],
  'contract management': ['contract negotiation', 'contract administration'],
  'onboarding': ['induction', 'activation', 'merchant onboarding', 'client onboarding'],
  'escalation management': ['escalation handling', 'complaint resolution', 'issue resolution', 'grievance handling'],
};

/* ------------------------------------------------------------------ *
 * 2. Related concepts — NOT the same thing, but plausible evidence.
 *    Produces a RELATED classification that must be candidate-confirmed
 *    before it can become a factual resume claim (spec §11, §9).
 * ------------------------------------------------------------------ */
export const RELATED_CONCEPTS = {
  'stakeholder management': ['worked with internal teams', 'coordinated with departments', 'liaised with business teams', 'cross functional', 'internal business teams'],
  'vendor management': ['procurement', 'purchase orders', 'sourcing', 'third party', 'outsourcing partners'],
  'people management': ['mentored', 'trained juniors', 'supervised', 'led a team', 'coached'],
  'data analysis': ['reporting', 'dashboards', 'mis', 'excel reports', 'trend analysis'],
  'power bi': ['tableau', 'looker', 'qlik', 'data visualisation', 'data visualization', 'dashboards'],
  'project management': ['coordinated', 'planned delivery', 'managed timelines', 'tracked milestones'],
  'customer success': ['renewals', 'churn', 'client retention', 'upsell', 'customer satisfaction'],
  'process improvement': ['standardisation', 'standardization', 'automation', 'reduced turnaround', 'efficiency'],
  'budget management': ['cost savings', 'reduced cost', 'expense management'],
  'sla management': ['turnaround time', 'tat', 'response time', 'resolution time'],
  'change management': ['migration', 'system rollout', 'new process adoption'],
  'compliance': ['audit', 'policy adherence', 'documentation control'],
  leadership: ['team lead', 'shift in-charge', 'supervisor', 'managed'],
  'machine learning': ['statistics', 'data science', 'model', 'regression'],
  'financial analysis': ['variance analysis', 'forecasting', 'mis', 'reconciliation'],
  'advanced excel': ['excel', 'ms excel', 'microsoft excel', 'spreadsheets'],
};

/* ------------------------------------------------------------------ *
 * 3. Skill categorisation — used to slot a matched term into the
 *    resume JSON `skills` object (spec §3).
 * ------------------------------------------------------------------ */
export const SKILL_CATEGORIES = {
  technical: [
    'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust', 'php', 'ruby', 'swift',
    'kotlin', 'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'spring', '.net',
    'sql', 'mongodb', 'postgresql', 'redis', 'elasticsearch', 'graphql', 'rest api', 'microservices',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git', 'linux',
    'machine learning', 'deep learning', 'nlp', 'computer vision', 'data engineering', 'etl',
    'html', 'css', 'tailwind', 'sass', 'webpack', 'cybersecurity', 'penetration testing', 'siem',
  ],
  tools: [
    'excel', 'advanced excel', 'power bi', 'tableau', 'looker', 'qlik', 'sap', 'oracle', 'salesforce',
    'hubspot', 'zoho', 'jira', 'confluence', 'asana', 'trello', 'monday.com', 'slack', 'notion',
    'figma', 'adobe xd', 'photoshop', 'illustrator', 'canva', 'autocad', 'solidworks', 'revit',
    'quickbooks', 'tally', 'zendesk', 'freshdesk', 'servicenow', 'workday', 'greenhouse',
    'google analytics', 'google ads', 'meta ads', 'mailchimp', 'powerpoint', 'ms office', 'sharepoint',
  ],
  functional: [
    'project management', 'programme management', 'people management', 'vendor management',
    'stakeholder management', 'account management', 'process improvement', 'change management',
    'risk management', 'compliance', 'budget management', 'contract management', 'supply chain',
    'inventory management', 'quality assurance', 'business development', 'talent acquisition',
    'customer success', 'customer support', 'escalation management', 'onboarding', 'sla management',
    'data analysis', 'business intelligence', 'financial analysis', 'forecasting', 'p&l',
    'digital marketing', 'seo', 'sem', 'content marketing', 'brand management', 'crm', 'erp',
    'agile', 'scrum', 'product management', 'training and development', 'operations management',
  ],
  soft: [
    'communication', 'leadership', 'teamwork', 'problem solving', 'analytical thinking',
    'negotiation', 'presentation', 'time management', 'adaptability', 'collaboration',
    'critical thinking', 'decision making', 'conflict resolution', 'mentoring', 'attention to detail',
    'stakeholder communication', 'interpersonal skills', 'ownership', 'initiative',
  ],
  industry: [
    'fintech', 'banking', 'insurance', 'healthcare', 'pharmaceutical', 'biotechnology', 'e-commerce',
    'retail', 'manufacturing', 'logistics', 'telecom', 'edtech', 'saas', 'hospitality', 'aviation',
    'automotive', 'energy', 'renewable energy', 'real estate', 'construction', 'legal', 'public sector',
    'non-profit', 'media', 'consulting', 'professional services', 'agriculture', 'mining',
  ],
};

/** Flat lookup: term -> category. Built once at module load. */
export const SKILL_CATEGORY_INDEX = Object.entries(SKILL_CATEGORIES).reduce((acc, [category, terms]) => {
  terms.forEach((term) => {
    acc[term] = category;
  });
  return acc;
}, {});

/* ------------------------------------------------------------------ *
 * 4. Seniority markers (spec §6, §8).
 * ------------------------------------------------------------------ */
export const SENIORITY_LEVELS = [
  'fresher',
  'entry',
  'associate',
  'mid',
  'senior',
  'lead',
  'manager',
  'senior-manager',
  'director',
  'vp',
  'c-suite',
];

export const SENIORITY_TITLE_MARKERS = {
  'c-suite': ['chief executive', 'ceo', 'chief operating', 'coo', 'chief financial', 'cfo', 'chief technology', 'cto', 'chief marketing', 'cmo', 'chief people', 'chro', 'managing director', 'founder', 'co-founder'],
  vp: ['vice president', 'vp ', 'svp', 'evp', 'executive vice president'],
  director: ['director', 'head of', 'general manager'],
  'senior-manager': ['senior manager', 'sr manager', 'sr. manager', 'group manager', 'associate director'],
  manager: ['manager', 'programme manager', 'program manager', 'project manager'],
  lead: ['lead', 'team lead', 'tech lead', 'principal', 'architect', 'supervisor', 'in-charge'],
  senior: ['senior', 'sr ', 'sr.', 'specialist ii', 'consultant'],
  mid: ['executive', 'analyst', 'engineer', 'officer', 'associate'],
  entry: ['junior', 'jr ', 'jr.', 'trainee', 'graduate', 'assistant'],
  fresher: ['intern', 'internship', 'fresher', 'apprentice', 'student'],
};

/** Years-of-experience band -> seniority, used when titles are ambiguous. */
export const SENIORITY_BY_YEARS = [
  { max: 0.5, level: 'fresher' },
  { max: 2, level: 'entry' },
  { max: 5, level: 'mid' },
  { max: 8, level: 'senior' },
  { max: 12, level: 'manager' },
  { max: 16, level: 'senior-manager' },
  { max: 22, level: 'director' },
  { max: Infinity, level: 'vp' },
];

/* ------------------------------------------------------------------ *
 * 5. Role taxonomy (spec §22) — seed only. Unknown titles are handled
 *    by JD intelligence, never rejected.
 * ------------------------------------------------------------------ */
export const ROLE_FAMILIES = {
  technology: ['software engineer', 'frontend developer', 'backend developer', 'full stack developer', 'devops engineer', 'data analyst', 'data scientist', 'data engineer', 'qa engineer', 'product manager', 'cybersecurity analyst', 'cloud engineer', 'mobile developer', 'solution architect'],
  finance: ['financial analyst', 'accountant', 'fp&a analyst', 'investment banker', 'auditor', 'risk analyst', 'credit analyst', 'finance manager', 'controller', 'treasury analyst'],
  operations: ['operations manager', 'business operations', 'process excellence', 'supply chain manager', 'logistics coordinator', 'warehouse manager', 'procurement manager', 'operations executive'],
  sales: ['sales manager', 'account executive', 'business development manager', 'key account manager', 'inside sales', 'sales director', 'territory manager'],
  marketing: ['performance marketing manager', 'seo specialist', 'content marketer', 'brand manager', 'growth manager', 'digital marketing executive', 'marketing manager'],
  hr: ['recruiter', 'hr business partner', 'talent acquisition specialist', 'l&d manager', 'hr generalist', 'compensation analyst', 'hr manager'],
  healthcare: ['clinical coordinator', 'healthcare administrator', 'healthcare operations manager', 'nurse', 'medical officer', 'pharmacist'],
  legal: ['legal operations manager', 'compliance officer', 'contract manager', 'paralegal', 'legal counsel'],
  customer: ['customer success manager', 'customer support executive', 'service delivery manager', 'client relationship manager'],
  product: ['product manager', 'product owner', 'business analyst', 'product analyst'],
};

/* ------------------------------------------------------------------ *
 * 6. Learning recommendations — skill -> generic learning path.
 *    Used by the Skill Gap agent (spec §15, §16). These are *categories*
 *    of learning, never named third-party courses, so the Upskills
 *    marketplace can resolve them against real partner catalogue entries.
 * ------------------------------------------------------------------ */
export const LEARNING_PATHS = {
  'power bi': { track: 'courses', query: 'Power BI', label: 'Power BI / business intelligence reporting' },
  tableau: { track: 'courses', query: 'Tableau', label: 'Tableau data visualisation' },
  'advanced excel': { track: 'courses', query: 'Excel', label: 'Advanced Excel and financial modelling' },
  sql: { track: 'courses', query: 'SQL', label: 'SQL and database querying' },
  python: { track: 'courses', query: 'Python', label: 'Python programming' },
  'data analysis': { track: 'courses', query: 'Data Analytics', label: 'Data analytics fundamentals' },
  'machine learning': { track: 'courses', query: 'Machine Learning', label: 'Machine learning' },
  aws: { track: 'courses', query: 'AWS', label: 'AWS cloud certification' },
  azure: { track: 'courses', query: 'Azure', label: 'Microsoft Azure certification' },
  'project management': { track: 'courses', query: 'Project Management', label: 'Project management (PMP / PRINCE2)' },
  agile: { track: 'courses', query: 'Agile Scrum', label: 'Agile and Scrum certification' },
  'supply chain': { track: 'courses', query: 'Supply Chain', label: 'Supply chain management' },
  'digital marketing': { track: 'courses', query: 'Digital Marketing', label: 'Digital marketing' },
  seo: { track: 'courses', query: 'SEO', label: 'Search engine optimisation' },
  salesforce: { track: 'courses', query: 'Salesforce', label: 'Salesforce administration' },
  sap: { track: 'courses', query: 'SAP', label: 'SAP modules' },
  'financial analysis': { track: 'courses', query: 'Financial Analysis', label: 'Financial analysis and FP&A' },
  'six sigma': { track: 'courses', query: 'Six Sigma', label: 'Lean Six Sigma' },
  'business intelligence': { track: 'courses', query: 'Business Intelligence', label: 'Business intelligence' },
  cybersecurity: { track: 'courses', query: 'Cyber Security', label: 'Cybersecurity' },
};

/* ------------------------------------------------------------------ *
 * 7. Stop words — stripped before keyword extraction so JD boilerplate
 *    ("the ideal candidate will...") never becomes a "keyword".
 * ------------------------------------------------------------------ */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'to', 'of', 'in', 'on', 'at',
  'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can',
  'this', 'that', 'these', 'those', 'you', 'your', 'we', 'our', 'us', 'they', 'their', 'it', 'its',
  'he', 'she', 'his', 'her', 'who', 'whom', 'which', 'what', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'about', 'into', 'over',
  'candidate', 'candidates', 'role', 'roles', 'job', 'jobs', 'position', 'positions', 'company',
  'team', 'teams', 'work', 'working', 'works', 'ability', 'able', 'strong', 'good', 'excellent',
  'experience', 'experienced', 'years', 'year', 'required', 'requirement', 'requirements',
  'responsibilities', 'responsibility', 'preferred', 'plus', 'etc', 'including', 'include',
  'ideal', 'looking', 'join', 'opportunity', 'please', 'apply', 'applicants', 'must', 'well',
  'new', 'across', 'within', 'using', 'ensure', 'ensuring', 'support', 'help', 'provide',
]);

/** Terms that look like keywords but describe the employer, not the candidate. */
export const NON_SKILL_NOISE = new Set([
  'salary', 'benefits', 'insurance', 'bonus', 'equity', 'holiday', 'leave', 'pension',
  'office', 'remote', 'hybrid', 'onsite', 'location', 'full time', 'part time', 'contract',
  'equal opportunity', 'diversity', 'inclusion', 'culture', 'mission', 'vision', 'values',
]);

/**
 * Every canonical term the taxonomy knows, flattened. Used as the fallback
 * dictionary when a JD is too short to yield useful keywords on its own.
 */
export const ALL_CANONICAL_TERMS = Array.from(
  new Set([
    ...Object.keys(SYNONYMS),
    ...Object.values(SKILL_CATEGORIES).flat(),
  ])
);

/**
 * Resolves any surface form to its canonical taxonomy term.
 * Returns null when the term is unknown — callers must treat unknown terms
 * as first-class keywords anyway (spec §22: no hard-coded allow-list).
 */
export function canonicalise(term) {
  const t = String(term || '').toLowerCase().trim();
  if (!t) return null;
  if (SYNONYMS[t] || SKILL_CATEGORY_INDEX[t]) return t;
  for (const [canonical, variants] of Object.entries(SYNONYMS)) {
    if (variants.includes(t)) return canonical;
  }
  return null;
}

/** Every surface form (canonical + synonyms) for a term. */
export function surfaceForms(term) {
  const t = String(term || '').toLowerCase().trim();
  const canonical = canonicalise(t) || t;
  return Array.from(new Set([canonical, t, ...(SYNONYMS[canonical] || [])])).filter(Boolean);
}

/** Phrases that would count as *related* (not equivalent) evidence. */
export function relatedForms(term) {
  const canonical = canonicalise(term) || String(term || '').toLowerCase().trim();
  return RELATED_CONCEPTS[canonical] || [];
}

/** Which of the five resume skill buckets a term belongs in. */
export function skillCategoryOf(term) {
  const canonical = canonicalise(term) || String(term || '').toLowerCase().trim();
  return SKILL_CATEGORY_INDEX[canonical] || 'functional';
}
