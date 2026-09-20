/* eslint-disable no-console */
import mongoose from 'mongoose';
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

async function destroy() {
  await Promise.all(COLLECTIONS.map((Model) => Model.deleteMany({})));
  await User.deleteMany({ email: { $ne: process.env.SEED_ADMIN_EMAIL } });
  console.log('✔ Collections cleared (the seed admin account was kept)');
}

async function seed() {
  await destroy();

  /* ---- admin ---- */
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@dutylaunch.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123';

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
    console.log(`✔ ${demoJobs.length} DEMO jobs (clearly labelled — remove before launch)`);
  } else {
    console.log('• No jobs seeded. Real listings only. Use --with-demo-jobs for test data.');
  }

  console.log('• No testimonials seeded — add real, consented client quotes in the admin.');
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
