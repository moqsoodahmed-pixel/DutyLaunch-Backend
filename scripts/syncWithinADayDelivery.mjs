import mongoose from 'mongoose';
import { CVPackage } from '../models/index.js';

await mongoose.connect('mongodb://127.0.0.1:27017/dutylaunch');

const pkgs = await CVPackage.find();
console.log(`Updating ${pkgs.length} packages in MongoDB...`);

for (const pkg of pkgs) {
  pkg.deliveryDays = 'Within a day';
  pkg.features = pkg.features.map((f) => {
    if (f.label === '2 to 3 day delivery' || f.label.includes('2 to 3')) {
      return { ...f.toObject(), label: 'Within a day delivery' };
    }
    return f;
  });
  await pkg.save();
  console.log(`✔ Updated ${pkg.name}: deliveryDays = "${pkg.deliveryDays}", features =`, pkg.features.map(f => f.label));
}

await mongoose.disconnect();
console.log('Database sync complete!');
