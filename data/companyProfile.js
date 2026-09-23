/**
 * Static DutyLaunch company profile used to ground the AI Career Assistant.
 *
 * This intentionally mirrors DutyLaunch-Frontend/src/data/site.js (the
 * single source of truth for static marketing copy). It is duplicated here
 * — rather than imported — because the backend and frontend are separate
 * deployable projects; if the frontend copy changes, update this file too.
 * Anything editable in the admin (jobs, courses, programmes, documentation
 * services, pricing, FAQs, testimonials) is NOT duplicated here — it is
 * read live from MongoDB by services/aiAssistantService.js (cached for 5 minutes).
 */

export const companyProfile = {
  name: 'DutyLaunch',
  tagline: 'A career, education and global-mobility platform.',
  contact: {
    email: 'hello@dutylaunch.com',
    supportEmail: 'support@dutylaunch.com',
    phone: '+91 84588 45826',
    whatsapp: '+91 84588 45826',
    address: '#63, Office No. 224 & 225, 2nd Floor, The Plazzo Mall, Ibrahim Sahib St, Off Commercial Street, Bangalore – 560001',
    mapUrl: 'https://maps.app.goo.gl/BCNfdV7j5PEBkYrM6',
    hours: 'Monday to Saturday, 10:00 – 19:00 IST',
  },
  pillars: [
    {
      label: 'Career',
      summary: 'Profile, applications and interviews — the work that gets you shortlisted.',
      items: ['Career services (CV, cover letter, LinkedIn, interviews)', 'CV pricing bundles', 'Career counselling', 'Job search assistance'],
    },
    {
      label: 'Education',
      summary: 'Degrees, diplomas and certifications, chosen for what they actually unlock.',
      items: ['Higher education (study abroad)', 'Professional courses', 'Upskilling short courses'],
    },
    {
      label: 'Global mobility',
      summary: 'Working abroad, from the first application to your first week.',
      items: ['UAE / Gulf job seeker package', 'Visa & relocation guidance', 'Documentation (apostille & attestation)'],
    },
    {
      label: 'Documentation',
      summary: 'Apostille, attestation and certified translation, tracked end to end.',
      items: ['Apostille (Hague Convention countries)', 'Embassy attestation (UAE & non-Hague countries)', 'Certified translation'],
    },
    {
      label: 'Jobs',
      summary: 'Search, apply and track — free for candidates.',
      items: ['Browse jobs', 'Apply & track applications', 'Employer job posting'],
    },
    {
      label: 'Career Tools',
      summary: 'AI-assisted tools built around the candidate\'s DutyLaunch profile.',
      items: ['AI Resume / ATS Checker (/ats-resume-checker)', 'LinkedIn Optimizer (/career-tools/linkedin)', 'Cover Letter generator (/career-tools/cover-letter)', 'AI Interview Coach (/career-tools/interview)', 'Career Profile (/profile)'],
    },
  ],
  careerServices: [
    { title: 'ATS resume writing', promise: 'A CV that parses cleanly and reads well.', link: '/pricing' },
    { title: 'Cover letters', promise: 'One strong letter you can adapt, not a template.', link: '/pricing' },
    { title: 'LinkedIn optimisation', promise: 'Get found by the recruiters searching for you.', link: '/pricing' },
    { title: 'Interview preparation', promise: 'Practise under pressure, not in your head.', link: '/contact#consultation' },
    { title: 'Career counselling', promise: 'Decide the direction before you optimise the route.', link: '/contact#consultation' },
    { title: 'Job search assistance', promise: 'Fewer, better-aimed applications.', link: '/jobs' },
  ],
  globalMobilityServices: [
    'Gulf-market job search (target lists, recruiter networks)',
    'CV distribution to recruitment consultancies and employers',
    'Interview support for remote and in-person rounds',
    'Visa guidance (what the employer sponsors vs. what the candidate provides)',
    'Accommodation guidance',
    'Airport pickup on arrival',
    'SIM & essentials (connectivity, banking basics)',
    'Written relocation plan covering sequence, costs and documents',
  ],
  journey: [
    { stage: 'Discover', lead: 'Work out what you are actually aiming at.', link: '/contact#consultation' },
    { stage: 'Prepare', lead: 'Fix the CV, cover letter and LinkedIn before applying.', link: '/pricing' },
    { stage: 'Upskill', lead: 'Close the specific gap that is stopping you.', link: '/courses' },
    { stage: 'Apply', lead: 'Apply deliberately and prepare for interviews.', link: '/jobs' },
    { stage: 'Advance', lead: 'Move up, or move country (UAE / Gulf).', link: '/dubai-job-seeker-package' },
  ],
  sitePages: {
    '/profile': 'Edit your DutyLaunch profile (skills, resume, experience, location)',
    '/dashboard': 'Profile strength and overview',
    '/jobs': 'Browse and search open roles',
    '/applications': 'Track your job applications',
    '/saved-jobs': 'Jobs you have saved',
    '/ats-resume-checker': 'Run your resume through the ATS score checker',
    '/career-tools/linkedin': 'LinkedIn profile optimisation tool',
    '/career-tools/cover-letter': 'Cover letter generator',
    '/career-tools/interview': 'AI mock interview coach',
    '/pricing': 'CV writing bundles and pricing',
    '/cv-builder': 'Build a CV online from a resume template',
    '/cv-templates': 'Browse all resume / CV templates',
    '/courses': 'Full course catalogue',
    '/upskills': 'Short upskilling courses',
    '/professional-courses': 'Structured, mentor-led professional courses',
    '/higher-education': 'Study-abroad degree and diploma programmes',
    '/documentation': 'Apostille, attestation and translation services',
    '/dubai-job-seeker-package': 'UAE / Gulf job seeker package',
    '/faq': 'Frequently asked questions',
    '/contact': 'Contact DutyLaunch / book a free consultation',
    '/employer': 'Post a job as an employer',
  },
};
