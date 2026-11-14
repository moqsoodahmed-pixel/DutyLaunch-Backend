import mongoose from 'mongoose';
import { ResumeBuildOrder, User } from '../models/index.js';

await mongoose.connect('mongodb://127.0.0.1:27017/dutylaunch');

const orders = await ResumeBuildOrder.find().lean();
console.log(`Found ${orders.length} orders in database:`);
for (const o of orders) {
  const user = await User.findById(o.user).lean();
  console.log(`- Order: ${o.orderNumber}, Status: ${o.status}, User: ${user?.email} (${user?.name}), Package: ${o.packageName}, Price: ₹${o.price}`);
}

await mongoose.disconnect();
