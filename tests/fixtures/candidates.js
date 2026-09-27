/**
 * Candidate and job-description fixtures for the acceptance tests the
 * specification asks for (§42, §50).
 *
 * These are deliberately awkward rather than tidy. A parser that only
 * ever sees well-formed CVs is not tested at all — the interesting
 * failures are the scanned file, the conflicting dates, the CV with no
 * section headings and the JD that is three lines long.
 */

export const FRESHER = `Aarav Menon
Kochi, Kerala | aarav.menon@example.com | +91 90000 11111 | github.com/aaravmenon

OBJECTIVE
Final-year computer science student looking for a software engineering role.

EDUCATION
B.Tech, Computer Science, Cochin University of Science and Technology, 2022 - 2026
CGPA: 8.4

PROJECTS
Campus Marketplace
- Built a React and Node.js marketplace used by 400 students on campus
- Implemented JWT authentication and a MongoDB data layer

Traffic Sign Classifier
- Trained a convolutional neural network in Python reaching 94% test accuracy

INTERNSHIPS
Software Engineering Intern, Zentro Labs
Kochi | Jun 2025 - Aug 2025
- Built REST endpoints in Node.js for an internal reporting tool
- Wrote unit tests with Jest

CERTIFICATIONS
AWS Certified Cloud Practitioner, 2025

SKILLS
JavaScript, React, Node.js, Python, MongoDB, Git, SQL

ACHIEVEMENTS
Runner-up, CUSAT Hackathon 2025
`;

export const TWO_YEARS = `Neha Gupta
Pune | neha.gupta@example.com | +91 98111 22222

EXPERIENCE
Digital Marketing Executive, BrightReach Media
Pune | Aug 2023 - Present
- Managed Google Ads and Meta Ads campaigns for six retail clients
- Increased lead volume by 35% for the largest client
- Produced weekly performance reports

EDUCATION
BBA, Marketing, Symbiosis Institute, 2023

SKILLS
Google Ads, Meta Ads, SEO, Google Analytics, Content Marketing, Excel
`;

export const FIVE_YEARS = `Rahul Iyer
Chennai, India | rahul.iyer@example.com | +91 99887 76655 | linkedin.com/in/rahuliyer

SUMMARY
Software engineer with five years building backend services.

EXPERIENCE
Senior Software Engineer, Cloudline Systems
Chennai | Mar 2023 - Present
- Designed and shipped a payments reconciliation service in Java and Spring
- Cut nightly batch runtime from 4 hours to 50 minutes
- Mentored three junior engineers

Software Engineer, Nexbyte
Chennai | Jul 2020 - Feb 2023
- Built REST APIs in Python and Django
- Migrated a monolith module to AWS

EDUCATION
B.E., Computer Science, Anna University, 2020

SKILLS
Java, Spring, Python, Django, AWS, Docker, Kubernetes, PostgreSQL, Kafka
`;

export const TEN_YEARS_MANAGER = `Priya Sharma
Bengaluru, India | priya.sharma@example.com | +91 98765 43210 | linkedin.com/in/priyasharma

SUMMARY
Operations professional with experience in merchant onboarding and vendor management.

WORK EXPERIENCE
Operations Manager, PayNext Technologies
Bengaluru | Jan 2019 - Present
- Managed end-to-end merchant onboarding for 30 vendors
- Reduced onboarding turnaround time by 20% through process standardization
- Led a team of 12 operations associates across two shifts

Senior Operations Executive, FinServe Ltd
Bengaluru | Jun 2015 - Dec 2018
- Handled customer complaints and escalations
- Responsible for daily reporting

EDUCATION
MBA, Operations, Christ University, 2015
B.Com, Bangalore University, 2013

SKILLS
Excel, SQL, Vendor Management, Process Improvement, Stakeholder Management

CERTIFICATIONS
Lean Six Sigma Green Belt
`;

export const EXECUTIVE = `Sanjay Rao
Mumbai, India | sanjay.rao@example.com | +91 98200 12345

PROFILE
Commercial leader across South Asia markets.

EXPERIENCE
Vice President, Commercial Operations, Meridian Industries
Mumbai | Apr 2018 - Present
- Owned a P&L of INR 480 crore across three business units
- Led an organisation of 240 people across India, Sri Lanka and Bangladesh
- Delivered 18% revenue growth through a channel restructuring programme
- Sponsored an ERP transformation across 14 sites

Director, Regional Sales, Halcyon Group
Mumbai | Jan 2012 - Mar 2018
- Grew regional revenue from INR 90 crore to INR 210 crore
- Built and led a sales organisation of 60

EDUCATION
MBA, Finance, Indian Institute of Management Bangalore, 2006
B.Tech, Mechanical Engineering, VJTI, 2002

SKILLS
P&L, Strategic Planning, Channel Management, Business Transformation, Leadership
`;

/** Customer support → customer success, the §9 / §14 case. */
export const CAREER_CHANGER = `Divya Nair
Hyderabad | divya.nair@example.com | +91 91234 56789

EXPERIENCE
Customer Support Team Lead, Helpdesk Solutions
Hyderabad | Feb 2021 - Present
- Led a team of 9 support agents handling 400 tickets per week
- Worked with internal business teams to resolve recurring product issues
- Reduced average resolution time from 26 hours to 11 hours
- Ran quarterly business reviews with three enterprise accounts

Customer Support Executive, Helpdesk Solutions
Hyderabad | Mar 2018 - Jan 2021
- Resolved customer queries over email and phone

EDUCATION
B.A., English Literature, Osmania University, 2017

SKILLS
Customer Support, Zendesk, Escalation Management, Team Leadership, Reporting
`;

/** A 20-month gap between roles, plus a return-to-work period. */
export const EMPLOYMENT_GAP = `Meera Krishnan
Coimbatore | meera.k@example.com | +91 90404 50505

EXPERIENCE
HR Business Partner, Trelis Technologies
Coimbatore | Sep 2024 - Present
- Partner with three engineering teams on hiring and performance cycles

HR Generalist, Auralink
Coimbatore | Jan 2019 - Dec 2022
- Ran end-to-end recruitment for technical roles
- Managed onboarding and induction

EDUCATION
MBA, Human Resources, Bharathiar University, 2018

SKILLS
Recruitment, Onboarding, Employee Relations, HRIS, Performance Management
`;

/** No headings, no bullets, inconsistent spacing — the §50 "poorly formatted" case. */
export const POORLY_FORMATTED = `karan mehta karan.mehta@example.com 9812345678 delhi
worked at Speedcart as warehouse supervisor from march 2019 to till date. handling inbound and outbound shipments, managing a team of 14 people, doing stock reconciliation daily and coordinating with transport vendors.
before that i was at Delhivery as operations associate 2017 to 2019 where i did order sorting and dispatch tracking.
education b.com delhi university 2017
skills - excel, inventory management, team handling
`;

/** Start date after end date, and overlapping roles. */
export const CONFLICTING_DATES = `Imran Qureshi
Lucknow | imran.q@example.com | +91 90000 22222

EXPERIENCE
Project Manager, Vertex Infra
Lucknow | Jan 2022 - Mar 2020
- Managed site delivery for three commercial projects

Assistant Project Manager, Vertex Infra
Lucknow | Jun 2019 - Dec 2021
- Coordinated contractors and material schedules

EDUCATION
B.Tech, Civil Engineering, AKTU, 2019

SKILLS
Project Management, AutoCAD, Primavera, Contractor Management
`;

/** Duties only, not a single number anywhere. */
export const NO_METRICS = `Sneha Patil
Nagpur | sneha.patil@example.com | +91 98989 78787

EXPERIENCE
Accounts Executive, Suraj Enterprises
Nagpur | Apr 2021 - Present
- Responsible for accounts payable and receivable
- Handling monthly bank reconciliation
- Assisting with GST filings
- Maintaining vendor ledgers

EDUCATION
B.Com, RTM Nagpur University, 2021

SKILLS
Tally, Excel, GST, Accounts Payable, Bank Reconciliation
`;

/** Contact details and dates largely absent — the §5 confirmation path. */
export const MISSING_INFORMATION = `Consultant

EXPERIENCE
Independent Consultant
- Advised small businesses on process setup
- Delivered training workshops

SKILLS
Consulting, Training
`;

/* ------------------------------------------------------------------ *
 * Job descriptions
 * ------------------------------------------------------------------ */

export const JD_OPERATIONS_MANAGER = `Operations Manager — Bengaluru

About the role
We are looking for an Operations Manager to lead service delivery for our merchant business.

Required skills
- Vendor Management
- SLA Management
- Power BI
- Advanced Excel
- Team Leadership
- Process Improvement
- Stakeholder Management

Responsibilities
- Manage vendor relationships and commercial terms
- Track KPIs and SLAs across the onboarding funnel
- Build Power BI dashboards for the leadership team
- Lead a team of operations associates
- Drive process improvement initiatives

Preferred qualifications
- Lean Six Sigma certification
- Experience in fintech or payments

Experience
- 6+ years in operations, including 2+ years managing a team

Education
- Bachelor's degree required, MBA preferred
`;

/** The §50 "JD with very few keywords" case. */
export const JD_THIN = `Operations Manager needed. Apply now.`;

/** The §50 "JD with hundreds of keywords" case. */
export const JD_KEYWORD_STUFFED = `Senior Operations Manager

Required: ${[
  'Vendor Management', 'SLA Management', 'Power BI', 'Advanced Excel', 'Team Leadership',
  'Process Improvement', 'Stakeholder Management', 'Six Lean Sigma', 'Project Management',
  'Budget Management', 'Change Management', 'Risk Management', 'Compliance', 'Supply Chain',
  'Logistics', 'Procurement', 'Inventory Management', 'Quality Assurance', 'Data Analysis',
  'SQL', 'Python', 'Tableau', 'Salesforce', 'SAP', 'Oracle', 'Jira', 'Confluence', 'Agile',
  'Scrum', 'Kanban', 'Lean', 'Kaizen', 'Root Cause Analysis', 'Capacity Planning',
  'Workforce Management', 'Customer Success', 'Escalation Management', 'Contract Negotiation',
  'P&L', 'Forecasting', 'Financial Analysis', 'Business Intelligence', 'Automation',
  'Process Mapping', 'Standard Operating Procedures', 'Training', 'Coaching', 'Recruitment',
  'Performance Management', 'Stakeholder Communication',
].join(', ')}

Responsibilities: own operations end to end.
`;

/** Asks for skills the operations candidate plainly does not have. */
export const JD_UNRELATED = `Clinical Research Associate

Required skills
- Good Clinical Practice
- Clinical trial monitoring
- Pharmacovigilance
- Regulatory submissions
- Protocol deviation management

Responsibilities
- Monitor clinical trial sites
- Review case report forms
- Ensure regulatory compliance

Experience
- 3+ years in clinical research
`;

export const JD_SOFTWARE = `Backend Engineer

Required skills
- Java
- Spring Boot
- AWS
- Kubernetes
- PostgreSQL
- Microservices

Responsibilities
- Build and operate backend microservices
- Own service reliability and on-call

Preferred
- Kafka
- Terraform

Experience
- 4+ years backend engineering
`;
