import mongoose from 'mongoose';
import { Job } from '../models/Job.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Update UNEXT job: Title, matching body, salary alignment (Freshers 26k-28k, Experienced up to 35k), remove age limit
  const unextDesc = `Academic Counsellor / Inside Sales Executive – MG Road, Bangalore
We are hiring for Academic Counsellors (Inside Sales / Lead Generation) for UNEXT located in MG Road, Bangalore.

Requirements
Minimum 1 year of experience in Academic Counseling or Inside Sales
Freshers with strong communication skills can also apply
Strong English & Hindi communication skills
Experience in calling, student counseling, and deal pitching
Graduation mandatory (No active backlogs)
Immediate joiners preferred
Bangalore-based candidates preferred

Salary
Experienced Candidates: Up to ₹35,000 / month
Freshers: ₹26,000 – ₹28,000 / month Take Home

Work Details
Location: MG Road, Bangalore
Working Days: Monday to Saturday
Timing: 9:30 AM – 7:30 PM

Interview Process
HR → TL → VH → HRBP`;

  const unextRes = await Job.updateOne(
    { _id: '6aba566a5b86ca0bd04aa027' },
    {
      $set: {
        title: 'Academic Counsellor',
        description: unextDesc,
        'salary.min': 26000,
        'salary.max': 35000,
        'salary.currency': 'INR',
        'salary.period': 'month',
        'salary.disclosed': true
      }
    }
  );
  console.log('UNEXT job updated:', unextRes);

  // 2. Update 24/7 AI job: Title casing to Title Case, remove age limit
  const csJob = await Job.findById('6aba55b45b86ca0bd04a9fac');
  if (csJob) {
    const cleanCsDesc = csJob.description.replace(/Age Limit:[^\n]+\n?/gi, '');
    const csRes = await Job.updateOne(
      { _id: '6aba55b45b86ca0bd04a9fac' },
      {
        $set: {
          title: 'Customer Support Advisor',
          description: cleanCsDesc
        }
      }
    );
    console.log('Customer Support job updated:', csRes);
  }

  // 3. Remove QA audit test records created during audit testing
  const delRes = await Job.deleteMany({
    _id: { $in: ['6aca132d00c03204cee1a933', '6aca1436645a1bd70b9cb23f', '6accb38b1f435c8927ded145'] }
  });
  console.log('Test probe jobs cleaned up:', delRes);

  const remaining = await Job.find({}).lean();
  console.log('Current jobs in DB:');
  remaining.forEach(j => {
    console.log(`- [${j._id}] "${j.title}" (${j.company}) | Salary:`, j.salary);
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
