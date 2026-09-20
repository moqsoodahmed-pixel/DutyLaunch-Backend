/**
 * Seed content.
 *
 * Everything here is either (a) DutyLaunch's own published service and pricing
 * information, or (b) original explanatory copy written for this build.
 *
 * Deliberately NOT seeded, because inventing them would be dishonest:
 *   - testimonials and reviews
 *   - client counts, success rates, partner or university names
 *   - real job listings (pass --with-demo-jobs for clearly-labelled test data)
 */

export const cvPackages = [
  {
    name: 'Early Career',
    experienceBand: '0–3 years',
    experienceMin: 0,
    experienceMax: 3,
    price: 599,
    tagline: 'A first CV that actually gets read.',
    bestFor: 'Students, fresh graduates and anyone in their first few roles.',
    deliveryDays: '2–3 days',
    revisionWindow: '1 month of unlimited revisions',
    order: 1,
    features: [
      { label: 'ATS-friendly CV', included: true },
      { label: 'Customised cover letter', included: true },
      { label: 'LinkedIn profile optimisation', included: true },
      { label: '1 month unlimited revisions', included: true },
      { label: '2–3 day delivery', included: true },
      { label: 'Positioning for internships, trainee and entry-level roles', included: true },
    ],
  },
  {
    name: 'Advanced Career',
    experienceBand: '4–7 years',
    experienceMin: 4,
    experienceMax: 7,
    price: 899,
    tagline: 'Turn a list of duties into a record of impact.',
    bestFor: 'Professionals moving into specialist or first-line management roles.',
    deliveryDays: '2–3 days',
    revisionWindow: '1 month of unlimited revisions',
    isPopular: true,
    order: 2,
    features: [
      { label: 'ATS-friendly CV', included: true },
      { label: 'Customised cover letter', included: true },
      { label: 'LinkedIn profile optimisation', included: true },
      { label: '1 month unlimited revisions', included: true },
      { label: '2–3 day delivery', included: true },
      { label: 'Achievement rewriting with measurable outcomes', included: true },
      { label: 'Keyword mapping against your target roles', included: true },
    ],
  },
  {
    name: 'Senior Career',
    experienceBand: '8–14 years',
    experienceMin: 8,
    experienceMax: 14,
    price: 1199,
    tagline: 'A senior profile that reads like a shortlist.',
    bestFor: 'Managers and senior specialists applying for leadership roles.',
    deliveryDays: '2–3 days',
    revisionWindow: '1 month of unlimited revisions',
    order: 3,
    features: [
      { label: 'ATS-friendly CV', included: true },
      { label: 'Customised cover letter', included: true },
      { label: 'LinkedIn profile optimisation', included: true },
      { label: '1 month unlimited revisions', included: true },
      { label: '2–3 day delivery', included: true },
      { label: 'Achievement rewriting with measurable outcomes', included: true },
      { label: 'Keyword mapping against your target roles', included: true },
      { label: 'Leadership and scope-of-responsibility framing', included: true },
    ],
  },
  {
    name: 'Executive Career',
    experienceBand: '15+ years',
    experienceMin: 15,
    experienceMax: null,
    price: 1799,
    tagline: 'Board-level positioning, written for the people who decide.',
    bestFor: 'Heads of function, directors and C-suite candidates.',
    deliveryDays: '2–3 days',
    revisionWindow: '1 month of unlimited revisions',
    order: 4,
    features: [
      { label: 'ATS-friendly CV', included: true },
      { label: 'Customised cover letter', included: true },
      { label: 'LinkedIn profile optimisation', included: true },
      { label: '1 month unlimited revisions', included: true },
      { label: '2–3 day delivery', included: true },
      { label: 'Achievement rewriting with measurable outcomes', included: true },
      { label: 'Keyword mapping against your target roles', included: true },
      { label: 'Leadership and scope-of-responsibility framing', included: true },
      { label: 'Executive summary and board-level narrative', included: true },
    ],
  },
];

export const documentationServices = [
  {
    name: 'Certificate Apostille',
    category: 'Apostille',
    description:
      'Apostille under the Hague Convention for educational, personal and commercial documents going to member countries. We handle the state-level verification and the MEA stamp, and return the document to you.',
    documentsRequired: ['Original certificate', 'Passport copy', 'Signed authorisation letter'],
    steps: ['Document check', 'State-level verification', 'MEA apostille', 'Return delivery'],
    processingTime: 'Varies by issuing state — confirmed before you pay',
    priceOnRequest: true,
    order: 1,
  },
  {
    name: 'Embassy Attestation',
    category: 'Attestation',
    description:
      'Attestation at the destination country embassy for documents going to non-Hague countries, including the UAE and wider GCC. Required before most employment and family visas are issued.',
    documentsRequired: ['Original document', 'Passport copy', 'Visa copy if already issued'],
    steps: ['Notary and state verification', 'MEA attestation', 'Embassy attestation', 'Return delivery'],
    processingTime: 'Varies by embassy — confirmed before you pay',
    priceOnRequest: true,
    order: 2,
  },
  {
    name: 'Educational Certificate Attestation',
    category: 'Attestation',
    description:
      'Degree, diploma and mark sheet attestation for employment and higher study abroad, including university verification where the destination authority asks for it.',
    documentsRequired: ['Original degree or diploma', 'Mark sheets', 'Passport copy'],
    steps: ['University verification', 'State HRD attestation', 'MEA attestation', 'Embassy attestation'],
    processingTime: 'Varies by university and state — confirmed before you pay',
    priceOnRequest: true,
    order: 3,
  },
  {
    name: 'Police Clearance Certificate (PCC)',
    category: 'Certificates',
    description:
      'Guidance and processing support for obtaining a Police Clearance Certificate and getting it attested for visa, immigration and employment use.',
    documentsRequired: ['Passport', 'Address proof', 'Application form'],
    steps: ['Application preparation', 'Police verification follow-up', 'Attestation if required'],
    processingTime: 'Depends on local police verification',
    priceOnRequest: true,
    order: 4,
  },
  {
    name: 'Birth Certificate Attestation',
    category: 'Certificates',
    description:
      'Attestation of birth certificates for family visas, school admissions abroad and residency applications.',
    documentsRequired: ['Original birth certificate', 'Passport copy of applicant or parent'],
    steps: ['Notary and home department attestation', 'MEA attestation', 'Embassy attestation'],
    processingTime: 'Varies by issuing state',
    priceOnRequest: true,
    order: 5,
  },
  {
    name: 'Marriage Certificate Attestation',
    category: 'Certificates',
    description:
      'Attestation of marriage certificates for spouse visas, dependent sponsorship and joint residency applications.',
    documentsRequired: ['Original marriage certificate', 'Passport copies of both spouses'],
    steps: ['Notary and home department attestation', 'MEA attestation', 'Embassy attestation'],
    processingTime: 'Varies by issuing state',
    priceOnRequest: true,
    order: 6,
  },
  {
    name: 'Employment & Experience Certificate Attestation',
    category: 'Certificates',
    description:
      'Attestation of experience letters and employment certificates, often requested during overseas job offers and professional licence applications.',
    documentsRequired: ['Original experience letter on company letterhead', 'Passport copy'],
    steps: ['Chamber of commerce or notary step', 'MEA attestation', 'Embassy attestation'],
    processingTime: 'Varies by document type',
    priceOnRequest: true,
    order: 7,
  },
  {
    name: 'Certified Translation',
    category: 'Translation',
    description:
      'Certified translation of documents into Arabic and other languages where the receiving authority will not accept the original language.',
    documentsRequired: ['Scanned copy of the document', 'Correct spelling of names as per passport'],
    steps: ['Translation', 'Certification', 'Legalisation where required'],
    processingTime: 'Typically a few working days',
    priceOnRequest: true,
    order: 8,
  },
  {
    name: 'Commercial Document Attestation',
    category: 'Commercial',
    description:
      'Attestation of company registration papers, powers of attorney, invoices and board resolutions for overseas trade and branch setup.',
    documentsRequired: ['Original commercial document', 'Company trade licence copy'],
    steps: ['Chamber of commerce attestation', 'MEA attestation', 'Embassy attestation'],
    processingTime: 'Varies by document and destination',
    priceOnRequest: true,
    order: 9,
  },
];

export const courseCategories = [
  { name: 'Data & Analytics', icon: 'BarChart3', order: 1, description: 'Analysis, visualisation and decision-making with data.' },
  { name: 'Digital Marketing', icon: 'Megaphone', order: 2, description: 'Search, social, content and performance marketing.' },
  { name: 'Business & Management', icon: 'Briefcase', order: 3, description: 'Project delivery, operations and people leadership.' },
  { name: 'Technology', icon: 'Code2', order: 4, description: 'Software, cloud and modern engineering practice.' },
  { name: 'Finance & Accounting', icon: 'Calculator', order: 5, description: 'Financial reporting, analysis and compliance.' },
  { name: 'Career Skills', icon: 'Compass', order: 6, description: 'Communication, interviews and workplace effectiveness.' },
];

export const courses = [
  {
    title: 'Data Analytics Foundations',
    categoryName: 'Data & Analytics',
    track: 'professional',
    level: 'Beginner',
    duration: '8 weeks',
    mode: 'Live online',
    priceOnRequest: true,
    summary: 'Learn to clean, analyse and present data using spreadsheets, SQL and a BI tool.',
    description:
      'A practical introduction for people who work with numbers but were never formally trained. You start with spreadsheet discipline, move to SQL for pulling your own data, and finish by building a dashboard you can show in an interview. Each week has one exercise based on a realistic business question.',
    outcomes: [
      'Write SQL queries against a relational database',
      'Clean and reshape messy datasets without losing accuracy',
      'Build a dashboard that answers a specific business question',
      'Explain an analysis to a non-technical audience',
    ],
    modules: [
      { title: 'Spreadsheet discipline', detail: 'Structuring data so it can be analysed at all.' },
      { title: 'SQL for analysts', detail: 'Filtering, joining and aggregating.' },
      { title: 'Statistics you will actually use', detail: 'Averages, distributions and why they mislead.' },
      { title: 'Dashboards', detail: 'Designing for the question, not the data.' },
      { title: 'Capstone', detail: 'One end-to-end analysis, reviewed by a mentor.' },
    ],
  },
  {
    title: 'Digital Marketing Essentials',
    categoryName: 'Digital Marketing',
    track: 'professional',
    level: 'Beginner',
    duration: '6 weeks',
    mode: 'Live online',
    priceOnRequest: true,
    summary: 'Run a full funnel: search, social, content and paid, measured properly.',
    description:
      'Covers the channels a small marketing team is expected to handle, and how to tell which of them is working. You plan a campaign for a real brand brief, run the numbers, and defend the spend.',
    outcomes: [
      'Plan a campaign against a defined audience and budget',
      'Set up and read analytics without guessing',
      'Write ad and landing-page copy that converts',
      'Report performance in terms a business owner cares about',
    ],
    modules: [
      { title: 'Audience and positioning', detail: 'Who you are talking to and why they should care.' },
      { title: 'Search', detail: 'Organic and paid, and how they interact.' },
      { title: 'Social and content', detail: 'Formats, cadence and creative testing.' },
      { title: 'Measurement', detail: 'Attribution, cohorts and the limits of both.' },
    ],
  },
  {
    title: 'Project Management with Agile',
    categoryName: 'Business & Management',
    track: 'professional',
    level: 'Intermediate',
    duration: '6 weeks',
    mode: 'Live online',
    priceOnRequest: true,
    summary: 'Plan, run and rescue projects using agile practice that survives contact with reality.',
    description:
      'For people already delivering work who want the vocabulary and structure to do it deliberately. Sprint planning, estimation, stakeholder management and the honest conversation about scope.',
    outcomes: [
      'Break work down and estimate it defensibly',
      'Run planning, stand-ups and retrospectives that are worth attending',
      'Manage scope change without losing the relationship',
      'Report status in a way senior stakeholders trust',
    ],
    modules: [
      { title: 'Frameworks', detail: 'Scrum, Kanban and choosing between them.' },
      { title: 'Estimation', detail: 'Why it goes wrong and what to do instead.' },
      { title: 'Stakeholders', detail: 'Managing up, sideways and outward.' },
      { title: 'Delivery health', detail: 'Metrics that predict trouble early.' },
    ],
  },
  {
    title: 'Advanced Excel & Financial Modelling',
    categoryName: 'Finance & Accounting',
    track: 'upskill',
    level: 'Intermediate',
    duration: '5 weeks',
    mode: 'Live online',
    priceOnRequest: true,
    summary: 'Build models that other people can audit, from three-statement basics upward.',
    description:
      'A hands-on course for finance and business roles. You build a working three-statement model, add scenarios, and learn the formatting conventions that make a model reviewable.',
    outcomes: [
      'Build a linked three-statement model from scratch',
      'Run scenario and sensitivity analysis',
      'Use lookup, dynamic array and pivot functions fluently',
      'Document a model so someone else can pick it up',
    ],
    modules: [
      { title: 'Model architecture', detail: 'Inputs, calculations, outputs — kept apart.' },
      { title: 'Core formulas', detail: 'Lookups, dynamic arrays, error handling.' },
      { title: 'Three-statement build', detail: 'P&L, balance sheet, cash flow and the circularity problem.' },
      { title: 'Scenarios', detail: 'Switches, data tables and presenting a range.' },
    ],
  },
  {
    title: 'Interview Confidence Intensive',
    categoryName: 'Career Skills',
    track: 'upskill',
    level: 'Beginner',
    duration: '2 weeks',
    mode: 'Live online',
    priceOnRequest: true,
    summary: 'Structure your answers, handle the hard questions, and stop rambling.',
    description:
      'A short, high-intensity course built around mock interviews. You record answers, get them critiqued, and rebuild them. Covers behavioural questions, competency frameworks, salary conversations and the questions you should be asking them.',
    outcomes: [
      'Answer behavioural questions with a clear structure',
      'Talk about failure and gaps without losing credibility',
      'Negotiate an offer with a prepared position',
      'Walk in with researched, specific questions',
    ],
    modules: [
      { title: 'Your story', detail: 'The two-minute answer everything else hangs off.' },
      { title: 'Behavioural questions', detail: 'Structure, evidence and brevity.' },
      { title: 'The hard ones', detail: 'Gaps, dismissals, career changes.' },
      { title: 'The offer', detail: 'Salary, counter-offers and knowing your floor.' },
    ],
  },
  {
    title: 'Cloud Fundamentals & Certification Prep',
    categoryName: 'Technology',
    track: 'certification',
    level: 'Beginner',
    duration: '8 weeks',
    mode: 'Live online',
    priceOnRequest: true,
    summary: 'Core cloud concepts plus structured preparation for an entry-level certification.',
    description:
      'Compute, storage, networking, identity and cost management explained from first principles, with labs. The final two weeks are exam-focused: practice questions, timing and the areas candidates most often lose marks on.',
    outcomes: [
      'Explain the core service categories and when each applies',
      'Deploy and secure a basic workload',
      'Read a cloud bill and identify waste',
      'Sit an entry-level certification exam prepared',
    ],
    modules: [
      { title: 'Core services', detail: 'Compute, storage, networking.' },
      { title: 'Identity and security', detail: 'Least privilege in practice.' },
      { title: 'Cost', detail: 'Pricing models and where money leaks.' },
      { title: 'Exam preparation', detail: 'Practice papers and timing.' },
    ],
  },
];

export const educationPrograms = [
  {
    title: 'Master of Business Administration (MBA)',
    level: 'Postgraduate',
    field: 'Business & Management',
    destinations: ['United Kingdom', 'Germany', 'Canada', 'Australia', 'UAE'],
    duration: '1–2 years',
    intakes: ['January', 'September'],
    summary: 'General management degree for professionals moving toward leadership roles.',
    description:
      'An MBA suits candidates with a few years of work experience who want to move from doing the work to running it. We help you judge whether the degree is worth the cost in your case, shortlist institutions against your budget and target market, and build an application that explains your trajectory rather than just listing it.',
    entryRequirements: [
      'Bachelor degree in any discipline',
      'Work experience — most competitive programmes expect two years or more',
      'English language test, where required by the institution',
    ],
    supportIncluded: [
      'Shortlisting against budget, intake and post-study work rules',
      'Statement of purpose and CV preparation',
      'Application submission and follow-up',
      'Visa documentation guidance',
    ],
  },
  {
    title: 'MSc Computer Science',
    level: 'Postgraduate',
    field: 'Technology',
    destinations: ['United Kingdom', 'Germany', 'Ireland', 'Canada'],
    duration: '1–2 years',
    intakes: ['January', 'September'],
    summary: 'Postgraduate computing for graduates moving into specialist technical work.',
    description:
      'Suitable for computing graduates and for career changers with a strong quantitative background, though conversion routes differ by country. We map the entry requirements honestly before you apply, so you do not spend application fees on programmes you are not eligible for.',
    entryRequirements: [
      'Bachelor degree in computer science or a related quantitative field',
      'Programming background — some programmes test this',
      'English language test, where required',
    ],
    supportIncluded: [
      'Eligibility check against each institution',
      'Statement of purpose and academic CV',
      'Scholarship and funding search',
      'Visa documentation guidance',
    ],
  },
  {
    title: 'MSc Data Science & Analytics',
    level: 'Postgraduate',
    field: 'Data & Analytics',
    destinations: ['United Kingdom', 'Germany', 'Netherlands', 'Australia'],
    duration: '1–2 years',
    intakes: ['September'],
    summary: 'Statistics, machine learning and applied analysis for data careers.',
    description:
      'A strong route into analytics and machine-learning roles. Entry requirements vary widely — some programmes expect a mathematics or statistics background, others accept business graduates with evidence of quantitative work.',
    entryRequirements: [
      'Bachelor degree with demonstrable quantitative content',
      'Mathematics or statistics coursework, depending on the institution',
      'English language test, where required',
    ],
    supportIncluded: ['Programme shortlisting', 'Application and SOP support', 'Funding search', 'Visa documentation guidance'],
  },
  {
    title: 'Bachelor of Business Administration (BBA)',
    level: 'Undergraduate',
    field: 'Business & Management',
    destinations: ['UAE', 'United Kingdom', 'Canada', 'Malaysia'],
    duration: '3–4 years',
    intakes: ['January', 'September'],
    summary: 'Undergraduate business degree with international study options.',
    description:
      'For school leavers planning to study abroad. We work through the trade-off between cost, location and post-study work rights before you commit, and prepare the application and financial documentation.',
    entryRequirements: ['Completed senior secondary education', 'English language test, where required'],
    supportIncluded: ['Country and institution shortlisting', 'Application support', 'Financial documentation guidance', 'Visa documentation guidance'],
  },
  {
    title: 'MSc Nursing & Healthcare Management',
    level: 'Postgraduate',
    field: 'Healthcare',
    destinations: ['United Kingdom', 'Ireland', 'Australia'],
    duration: '1–2 years',
    intakes: ['January', 'September'],
    summary: 'Postgraduate healthcare study with registration pathways to consider alongside.',
    description:
      'Healthcare study abroad is tied closely to professional registration, and the two processes run on different timelines. We set out both before you apply so that the qualification you pay for is the one that lets you practise where you intend to.',
    entryRequirements: ['Relevant bachelor degree', 'Professional registration in your home country', 'English language test'],
    supportIncluded: ['Registration pathway briefing', 'Programme shortlisting', 'Application support', 'Visa documentation guidance'],
  },
  {
    title: 'Postgraduate Diploma in Engineering Management',
    level: 'Diploma',
    field: 'Engineering',
    destinations: ['Canada', 'Australia', 'Germany'],
    duration: '1 year',
    intakes: ['January', 'May', 'September'],
    summary: 'Shorter, lower-cost route for engineers targeting management roles abroad.',
    description:
      'A diploma can be a faster and cheaper entry route than a masters, but post-study work rights differ. We compare both options for your target country before you decide.',
    entryRequirements: ['Engineering bachelor degree or diploma', 'English language test, where required'],
    supportIncluded: ['Diploma vs masters comparison', 'Application support', 'Visa documentation guidance'],
  },
];

export const faqs = [
  { category: 'General', order: 1, question: 'What does DutyLaunch actually do?', answer: 'DutyLaunch supports three connected things: your professional profile and job search, your education and upskilling, and the paperwork involved in moving abroad for work or study. You can use any one of them on its own.' },
  { category: 'General', order: 2, question: 'Is the first consultation free?', answer: 'Yes. The first consultation is free and is a conversation, not a sales call. We will tell you if a service is not right for you.' },
  { category: 'General', order: 3, question: 'How do I get in touch?', answer: 'Book a free consultation or send a message through the contact page. A counsellor responds within one working day.' },
  { category: 'Career Services', order: 1, question: 'What makes a CV "ATS-friendly"?', answer: 'Applicant tracking systems parse your CV into structured fields before a person sees it. A CV that parses cleanly uses a single-column layout, standard section headings, real text rather than text inside images, and the vocabulary of the role you are applying for. We write to those constraints without making the document dull.' },
  { category: 'Career Services', order: 2, question: 'How long does a CV take?', answer: 'Two to three working days from the point where we have your information and have spoken to you about your target roles.' },
  { category: 'Career Services', order: 3, question: 'What if I do not like the first draft?', answer: 'Every CV bundle includes one month of unlimited revisions. Tell us what is wrong and we rewrite it.' },
  { category: 'Career Services', order: 4, question: 'Do you guarantee a job?', answer: 'No, and you should be careful of anyone who does. Hiring decisions depend on the market, the employer and the interview. We can make sure your application is strong and gets seen.' },
  { category: 'Career Services', order: 5, question: 'Do you write cover letters for every application?', answer: 'The bundles include one customised cover letter built around your target role. It is written so you can adapt it per application, and we show you how.' },
  { category: 'Pricing & Payments', order: 1, question: 'How is CV pricing decided?', answer: 'By your years of experience, because a fifteen-year career takes longer to research and position than a first job. The four bands are ₹599 for 0–3 years, ₹899 for 4–7 years, ₹1,199 for 8–14 years and ₹1,799 for 15 or more.' },
  { category: 'Pricing & Payments', order: 2, question: 'Are there any hidden charges?', answer: 'No. The price shown for a CV bundle is the full price. Where a service is quoted on request — documentation and attestation, for example — you get a written quote before any work begins.' },
  { category: 'Pricing & Payments', order: 3, question: 'Can I upgrade after ordering?', answer: 'Yes. If your experience band was misjudged, we adjust it and you pay only the difference.' },
  { category: 'Education', order: 1, question: 'Do you charge students for education counselling?', answer: 'The first counselling session is free. Where a paid service applies, we set out the fee in writing before you commit.' },
  { category: 'Education', order: 2, question: 'Can you guarantee admission or a visa?', answer: 'No. Admission is the institution\'s decision and a visa is the government\'s. What we can do is make sure the application is complete, accurate and submitted on time.' },
  { category: 'Education', order: 3, question: 'How early should I start?', answer: 'For a September intake, start around twelve months ahead. Tests, transcripts, attestation and financial documentation each take longer than people expect.' },
  { category: 'UAE & Global Mobility', order: 1, question: 'What is in the UAE job seeker package?', answer: 'Support for a UAE job search from outside the country: a CV rewritten for the Gulf market, CV distribution, interview preparation, and practical relocation guidance covering visas, accommodation and arrival essentials.' },
  { category: 'UAE & Global Mobility', order: 2, question: 'Do I need my certificates attested for the UAE?', answer: 'In most cases, yes. Employment and family visas usually require attested educational and personal documents. Start this early — it is the step that most often delays a move.' },
  { category: 'UAE & Global Mobility', order: 3, question: 'Can you get me a UAE work visa?', answer: 'A work visa is sponsored by the employer who hires you. We prepare you and your documents so that nothing on your side holds the process up.' },
  { category: 'Documentation', order: 1, question: 'What is the difference between apostille and attestation?', answer: 'An apostille is a single certificate recognised by countries that signed the Hague Convention. Countries outside it, including the UAE, require attestation — a chain of stamps ending at that country\'s embassy. Which one you need depends entirely on the destination.' },
  { category: 'Documentation', order: 2, question: 'How long does attestation take?', answer: 'It depends on the issuing state, the university and the embassy involved. We confirm a realistic timeline for your specific documents before you pay, rather than quoting an average.' },
  { category: 'Documentation', order: 3, question: 'Do you need my original certificates?', answer: 'Usually yes — most authorities stamp the original document. We tell you exactly what is needed at the quote stage and track the documents while they are with us.' },
  { category: 'Jobs & Applications', order: 1, question: 'Does it cost anything to apply for a job here?', answer: 'No. Searching and applying for jobs on DutyLaunch is free for candidates.' },
  { category: 'Jobs & Applications', order: 2, question: 'Can I track my applications?', answer: 'Yes. Every application appears in your dashboard with its current status, and you are notified when an employer moves it forward.' },
  { category: 'Jobs & Applications', order: 3, question: 'How do employers post a job?', answer: 'Create an employer account, complete your company profile and post from the employer dashboard. New listings are reviewed before they go live.' },
];

export const blogPosts = [
  {
    title: 'Why your CV is being rejected before a person reads it',
    category: 'Resume & LinkedIn',
    tags: ['ats', 'cv', 'job search'],
    isFeatured: true,
    excerpt: 'Most applications are filtered by software first. Here is what that software can and cannot read, and how to write for both audiences at once.',
    content: `Most mid-size and large employers run applications through an applicant tracking system before anyone opens them. The system parses your document into fields — name, employer, dates, titles, skills — and stores it as structured data. If it cannot parse a field, that field is empty. An empty field is not a neutral result; it is a missing qualification.

## What breaks parsing

Two-column layouts are the most common problem. A human reads the left column then the right; a parser often reads straight across, interleaving your job titles with your skills list. Text inside images and graphics is invisible. Headers and footers are frequently skipped entirely, which is unfortunate if that is where your phone number lives. Unusual section headings — "My Journey" instead of "Experience" — get classified as unknown.

## What to do instead

Use one column. Use the boring headings: Summary, Experience, Education, Skills. Put your contact details in the body of the document, not the header. Save as a .docx or a text-based PDF, never a scan or an exported image.

## Writing for the second reader

Passing the parser only gets you seen. The person reading next spends very little time on each CV, and they are looking for evidence, not adjectives. "Responsible for social media" says nothing. "Grew the company LinkedIn following and moved two-thirds of inbound enquiries to that channel" says something a hiring manager can picture.

Every bullet should answer one of three questions: what did you change, by how much, and how do you know. If a bullet cannot answer any of them, it is a job description, not an achievement.

## Matching the vocabulary

Read three advertisements for the role you want. Note the nouns they repeat. If they all say "stakeholder management" and your CV says "dealing with clients", you are describing the same skill in a word the system is not looking for. This is not keyword stuffing — it is using the industry's own vocabulary for something you genuinely did.`,
  },
  {
    title: 'The interview answer that fixes most of the others',
    category: 'Interviews',
    tags: ['interviews', 'preparation'],
    excerpt: '"Tell me about yourself" sets the frame for everything that follows. Most candidates waste it.',
    content: `It is the first question in almost every interview, and it is the one people prepare least. The instinct is to narrate a career chronologically from university onward. By the time you reach the present, the interviewer has stopped listening and you have handed them nothing to ask about.

## What the question is actually asking

It means: why are you in this room, and why should the next forty minutes be interesting? A good answer is about ninety seconds, has three parts, and ends somewhere useful.

**Where you are now.** One sentence on your current role and scope. Not your title alone — what you are responsible for.

**How you got here, selectively.** Two or three sentences covering only the steps that explain your fit for this job. A career change is a feature here, not something to apologise for, as long as you say what it gave you.

**Why this role.** One sentence connecting what you have done to what they need. Something specific enough that it could not be said to another company.

## The second benefit

A well-constructed answer plants the follow-up questions. If you mention that you rebuilt a reporting process, a good interviewer will ask about it — and you have now steered the interview toward material you know cold. The alternative is letting them pick, which means answering questions about the weakest parts of your CV.

## Practise out loud

Silently rehearsing does not work. The gap between what you think you will say and what comes out is large, and the only way to close it is to say it aloud, ideally recorded. Listen back once. You will hear the filler immediately.`,
  },
  {
    title: 'Apostille or attestation? Getting this wrong costs months',
    category: 'Documentation',
    tags: ['apostille', 'attestation', 'documents'],
    excerpt: 'Two words that sound interchangeable, aren\'t, and are decided entirely by where your document is going.',
    content: `People often use the two terms as though they mean the same thing. They do not, and choosing the wrong one means paying for a process the destination country will not accept.

## Apostille

The Hague Apostille Convention lets member countries accept each other's documents with a single certificate. If your document is going to a member country, an apostille is usually sufficient: the document is verified at state level and then receives an apostille from the Ministry of External Affairs.

## Attestation

Countries outside the Convention — including the UAE and most of the Gulf — require a chain. Typically: notary or state-level verification, then MEA attestation, then attestation by that country's embassy. Each step depends on the one before it, so an error early on is discovered late.

## What decides it

The destination country, and nothing else. Not the document type, not the purpose, not which is faster. Confirm the destination's current requirement before you start, because countries do join the Convention and requirements change.

## Why timelines vary so much

Educational documents often need verification from the issuing university, and universities work at their own pace. That single step can take longer than every other step combined, and it is outside anyone's control. Anyone quoting you a guaranteed turnaround on university-verified attestation is guessing.

## Start earlier than feels necessary

Attestation is the most common reason a confirmed job offer or admission slips. Begin as soon as the move becomes plausible, not once it is confirmed. Attested documents do not expire in any way that hurts you; a missed joining date does.`,
  },
  {
    title: 'Applying for jobs in the UAE from outside the country',
    category: 'UAE & Gulf Careers',
    tags: ['uae', 'dubai', 'job search', 'relocation'],
    excerpt: 'The market rewards preparation over volume. What to have ready before you start applying.',
    content: `Applying into the UAE from abroad is a different exercise from applying at home. Employers are weighing an extra set of risks — visa sponsorship, notice periods, whether you will actually relocate — and your application has to answer those questions before they are asked.

## Your CV needs to be re-pitched, not just reformatted

Gulf employers commonly expect information that some markets omit: nationality, visa status, and notice period. State plainly whether you require sponsorship. Ambiguity here reads as a complication, and complications get filtered.

Where your experience is in a different regulatory or market context, translate it. A qualification or system that is standard at home may mean nothing to a reader in Dubai unless you say what it is equivalent to.

## Be specific about availability

"Immediately available" from another country is not credible unless you explain how. Give a realistic date and the reason it is realistic — notice served, documents already attested, willing to travel for interview at your own cost.

## Documents before offers

Attestation of your degree and personal certificates takes time and is required for most employment visas. Starting it after you receive an offer adds weeks at exactly the point where an employer is deciding whether you are worth the wait.

## Visibility beats volume

Applying to hundreds of portal listings from outside the country has poor returns. Direct approaches to recruiters working in your sector, a LinkedIn profile that reads as UAE-ready, and CV distribution into the right consultancy networks tend to produce more conversations than volume applications do.

## Plan the trip properly if you make one

A job-search trip works when it is booked around confirmed conversations, not as a hope. Line up interviews before you fly, allow more time than you think for each, and have your documents with you.`,
  },
  {
    title: 'Choosing a course that actually changes your options',
    category: 'Upskilling',
    tags: ['upskilling', 'courses', 'career change'],
    excerpt: 'A certificate is not a strategy. Three questions to ask before you pay for any course.',
    content: `The upskilling market is full of courses that are pleasant to complete and change nothing about your employability. Before enrolling in anything, answer three questions honestly.

## What job does this unlock?

Not "what field does this relate to" — what specific advertisements could you answer after finishing that you cannot answer now? Go and read those advertisements. If the course content does not match what they ask for, the certificate will not close the gap.

## What will you have built?

Employers hiring for practical skills want to see work, not completion. A course that ends in a portfolio piece, a working model, a deployed project, is worth several that end in a PDF. When comparing options, ask what you will have at the end that you can show someone.

## Is the gap actually skills?

This is the uncomfortable one. Sometimes people enrol in a third course when the real obstacle is a CV that does not communicate the skills they already have, or an interview technique that collapses under pressure. Adding qualifications to an application that is not being read does not help.

## When a course is clearly the right answer

Regulated or certified fields, where the credential is a hard requirement. Genuine domain changes, where you need foundations you do not have. And cases where a specific tool or framework appears in every advertisement you want to answer.

In those situations, choose on outcome and assessment quality rather than price or brand, and treat the certificate as a by-product of the work you did.`,
  },
  {
    title: 'What to do in the first ninety days of a job search',
    category: 'Career Advice',
    tags: ['job search', 'planning'],
    excerpt: 'A structure for the search, so effort goes where it compounds instead of where it feels productive.',
    content: `Job searching rewards structure, and most people have none. The default pattern — open a portal, apply to whatever appears, repeat — feels like effort and produces very little. Here is a sequence that works better.

## Weeks one and two: decide what you are looking for

Write down the roles you are targeting, by title, and the three or four things that must be true for you to accept an offer. Salary floor, location, work model, industry. This is not a wish list; it is a filter that stops you wasting weeks on roles you would decline.

## Weeks three and four: fix the assets

Your CV, your LinkedIn profile and your standard cover letter. All three should be written against the target roles you just defined, not against your history in general. This is the highest-leverage fortnight of the whole search, because everything after it depends on these documents.

## Weeks five to eight: apply deliberately

A smaller number of well-targeted applications beats volume. For each one, spend a few minutes adjusting the summary and the top three bullets to the advertisement. Track what you sent and when, because you will not remember.

At the same time, start conversations that are not applications: former colleagues, people doing the job you want, recruiters who specialise in your area. A meaningful share of hiring happens before a role is advertised.

## Weeks nine to twelve: review honestly

Look at your numbers. Applications that produced no response at all point at the CV or the targeting. Interviews that produced no offers point at interview preparation. First-round rejections and final-round rejections are different problems with different fixes.

If nothing is moving, change one variable at a time — the targeting, the documents, or the channel — and give each change enough applications to tell you something.`,
  },
];

export const demoJobs = [
  {
    title: '[DEMO] Business Analyst',
    company: 'Sample Employer Pvt Ltd',
    location: 'Bengaluru, Karnataka',
    country: 'India',
    category: 'Data & Analytics',
    jobType: 'Full-time',
    workMode: 'Hybrid',
    experience: { min: 2, max: 5 },
    salary: { min: 900000, max: 1400000, currency: 'INR', period: 'year', disclosed: true },
    skills: ['SQL', 'Excel', 'Power BI', 'Stakeholder management'],
    description:
      'DEMO RECORD — seeded for development only. Replace with real listings before launch. A business analyst role working with commercial teams to define reporting requirements and deliver analysis.',
    responsibilities: ['Gather and document requirements', 'Build and maintain reporting', 'Present findings to commercial stakeholders'],
    requirements: ['2+ years in an analyst role', 'Strong SQL', 'Comfortable presenting to non-technical audiences'],
    status: 'published',
    isFeatured: true,
  },
  {
    title: '[DEMO] Digital Marketing Executive',
    company: 'Sample Employer Pvt Ltd',
    location: 'Dubai',
    country: 'United Arab Emirates',
    category: 'Digital Marketing',
    jobType: 'Full-time',
    workMode: 'On-site',
    experience: { min: 3, max: 6 },
    salary: { min: 12000, max: 16000, currency: 'AED', period: 'month', disclosed: true },
    skills: ['Paid social', 'Google Ads', 'Analytics', 'Copywriting'],
    description:
      'DEMO RECORD — seeded for development only. Replace with real listings before launch. Campaign planning and execution across paid and organic channels for a regional brand.',
    responsibilities: ['Plan and run paid campaigns', 'Own channel reporting', 'Work with agency partners'],
    requirements: ['3+ years in performance marketing', 'Hands-on with major ad platforms', 'GCC market experience preferred'],
    status: 'published',
  },
  {
    title: '[DEMO] Registered Nurse',
    company: 'Sample Healthcare Group',
    location: 'Abu Dhabi',
    country: 'United Arab Emirates',
    category: 'Healthcare',
    jobType: 'Full-time',
    workMode: 'On-site',
    experience: { min: 2, max: 8 },
    salary: { disclosed: false, currency: 'AED', period: 'month' },
    skills: ['Patient care', 'Clinical documentation'],
    description:
      'DEMO RECORD — seeded for development only. Replace with real listings before launch. Ward-based nursing role with licensing support for overseas candidates.',
    responsibilities: ['Deliver patient care to protocol', 'Maintain clinical records'],
    requirements: ['Nursing degree', 'Home-country registration', 'Attested certificates'],
    status: 'published',
  },
  {
    title: '[DEMO] Software Engineer (Backend)',
    company: 'Sample Tech Labs',
    location: 'Remote — India',
    country: 'India',
    category: 'Technology',
    jobType: 'Remote',
    workMode: 'Remote',
    experience: { min: 3, max: 7 },
    salary: { min: 1800000, max: 2800000, currency: 'INR', period: 'year', disclosed: true },
    skills: ['Node.js', 'MongoDB', 'REST APIs', 'AWS'],
    description:
      'DEMO RECORD — seeded for development only. Replace with real listings before launch. Backend engineering on a distributed services platform.',
    responsibilities: ['Design and ship backend services', 'Own reliability of your services', 'Review peers\' code'],
    requirements: ['3+ years backend experience', 'Strong Node.js and database fundamentals'],
    status: 'published',
    isFeatured: true,
  },
];
