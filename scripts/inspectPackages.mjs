import mongoose from 'mongoose';
import { CVPackage } from '../models/index.js';

await mongoose.connect('mongodb://127.0.0.1:27017/dutylaunch');

const pkgs = await CVPackage.find().lean();
console.log('Current packages:');
for (const p of pkgs) {
  console.log(p.name, p.deliveryDays, p.features.map(f => f.label));
}

await mongoose.disconnect();
