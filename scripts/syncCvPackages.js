import { connectDB, disconnectDB } from '../config/db.js';
import { CVPackage } from '../models/CVPackage.js';
import { cvPackages } from '../seed/data.js';

async function run() {
  await connectDB();
  console.log('Syncing CV Packages with new pricing and experience bands...');

  // Remove existing packages and reinsert updated ones cleanly
  await CVPackage.deleteMany({});
  for (const pkg of cvPackages) {
    await CVPackage.create(pkg);
  }

  const updated = await CVPackage.find({}).sort({ order: 1 });
  console.log(
    'Synced packages successfully:',
    updated.map((p) => ({
      name: p.name,
      experienceBand: p.experienceBand,
      price: p.price,
      order: p.order,
    }))
  );
  await disconnectDB();
}

run().catch((err) => {
  console.error('Failed to sync CV packages:', err);
  process.exit(1);
});
