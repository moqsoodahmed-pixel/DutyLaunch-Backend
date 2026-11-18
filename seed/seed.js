/* eslint-disable no-console */
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import {
  User, CVPackage, DocumentationService, CourseCategory, Course,
  EducationProgram, FAQ, BlogPost, Job, JobApplication, Consultation,
  ContactMessage, Testimonial,
} from '../models/index.js';
import {
  cvPackages, documentationServices, courseCategories, courses,
  educationPrograms, faqs, blogPosts, demoJobs,
} from './data.js';

const args = process.argv.slice(2);
const DESTROY = args.includes('--destroy');
const WITH_DEMO_JOBS = args.includes('--with-demo-jobs');

const COLLECTIONS = [
  CVPackage, DocumentationService, CourseCategory, Course, EducationProgram,
  FAQ, BlogPost, Job, JobApplication, Consultation, ContactMessage, Testimonial,
];

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || 'admin@dutylaunch.com').toLowerCase().trim();
const PRESERVED_ADMIN_EMAILS = [ADMIN_EMAIL, 'moqsood@launcherdesk.com'];

/**
 * Never fall back to a fixed, guessable password for a seeded admin account.
 * If the env var isn't set, generate a random one for this run only and
 * print it once — the operator must capture and change it, instead of a
 * known string (previously 'ChangeMe123' / 'Moqsood@2026') sitting in
 * source control forever as a standing admin-account credential.
 */
function resolveSeedPassword(envVarName, label) {
  const fromEnv = process.env[envVarName];
  if (fromEnv) return fromEnv;
  const generated = crypto.randomBytes(12).toString('base64url') + 'Aa1!';
  console.warn(
    `⚠ ${envVarName} is not set. Generated a one-time random password for ${label}: ${generated}\n` +
      `  Save it now and set ${envVarName} in your .env for future runs — it will not be shown again.`
  );
  return generated;
}

async function destroy() {
  await Promise.all(COLLECTIONS.map((Model) => Model.deleteMany({})));
  // Goes through the raw driver collection, not the Mongoose model, to avoid a
  // known Mongoose 8.6.x regression where a schema field with `lowercase: true`
  // (User.email) gets its setter mis-applied to the whole `{ $ne: ... }`
  // operator object during query casting, throwing a CastError.
  await User.collection.deleteMany({ email: { $nin: PRESERVED_ADMIN_EMAILS } });
  console.log('✔ Collections cleared (the seed admin accounts were kept)');
}

async function seed() {
  await destroy();

  /* ---- admin ---- */
  const adminEmail = ADMIN_EMAIL;
  const adminPassword = resolveSeedPassword('SEED_ADMIN_PASSWORD', adminEmail);

  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({
      name: 'DutyLaunch Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
    });
    console.log(`✔ Admin created → ${adminEmail}`);
  } else {
    console.log(`• Admin already present → ${adminEmail}`);
  }

  /* ---- super admin moqsood ---- */
  let moqsoodAdmin = await User.findOne({ email: 'moqsood@launcherdesk.com' });
  if (!moqsoodAdmin) {
    moqsoodAdmin = await User.create({
      name: 'Moqsood Ahmed',
      email: 'moqsood@launcherdesk.com',
      password: resolveSeedPassword('MOQSOOD_ADMIN_PASSWORD', 'moqsood@launcherdesk.com'),
      role: 'super_admin',
    });
    console.log(`✔ Super Admin created → moqsood@launcherdesk.com`);
  } else {
    console.log(`• Super Admin already present → moqsood@launcherdesk.com`);
  }

  /* ---- pricing ---- */
  await CVPackage.insertMany(cvPackages);
  console.log(`✔ ${cvPackages.length} CV packages`);

  /* ---- documentation ---- */
  await DocumentationService.insertMany(documentationServices);
  console.log(`✔ ${documentationServices.length} documentation services`);

  /* ---- courses ---- */
  const categories = await CourseCategory.insertMany(courseCategories);
  const categoryByName = Object.fromEntries(categories.map((c) => [c.name, c._id]));
  await Course.create(
    courses.map(({ categoryName, ...course }) => ({
      ...course,
      category: categoryByName[categoryName],
      status: 'published',
    }))
  );
  console.log(`✔ ${categories.length} course categories, ${courses.length} courses`);

  /* ---- education ---- */
  await EducationProgram.create(educationPrograms.map((p) => ({ ...p, status: 'published' })));
  console.log(`✔ ${educationPrograms.length} education programmes`);

  /* ---- faqs ---- */
  await FAQ.insertMany(faqs);
  console.log(`✔ ${faqs.length} FAQs`);

  /* ---- blog ---- */
  await BlogPost.create(
    blogPosts.map((post, i) => ({
      ...post,
      author: admin._id,
      status: 'published',
      publishedAt: new Date(Date.now() - i * 5 * 24 * 60 * 60 * 1000),
      seo: { metaTitle: post.title.slice(0, 70), metaDescription: post.excerpt.slice(0, 170) },
    }))
  );
  console.log(`✔ ${blogPosts.length} blog articles`);

  /* ---- jobs ---- */
  if (WITH_DEMO_JOBS) {
    const employer = await User.findOneAndUpdate(
      { email: 'employer@example.com' },
      {
        $setOnInsert: {
          name: 'Sample Employer',
          email: 'employer@example.com',
          password: 'Employer123',
          role: 'employer',
          company: { name: 'Sample Employer Pvt Ltd', industry: 'Multiple', size: '51-200' },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // findOneAndUpdate bypasses the save hook, so hash on first creation.
    if (employer.password === 'Employer123') {
      employer.password = 'Employer123';
      await employer.save();
    }
    await Job.create(demoJobs.map((job) => ({ ...job, employer: employer._id })));
    console.log(`✔ ${demoJobs.length} DEMO jobs (clearly labelled, remove before launch)`);
  } else {
    console.log('• No jobs seeded. Real listings only. Use --with-demo-jobs for test data.');
  }

  console.log('• No testimonials seeded, add real, consented client quotes in the admin.');
  console.log('\nSeed complete.\n');
}

(async () => {
  await connectDB();
  try {
    if (DESTROY) await destroy();
    else await seed();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
    await mongoose.disconnect().catch(() => {});
  }
})();