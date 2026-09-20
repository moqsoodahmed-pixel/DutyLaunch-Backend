import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { CVPackage } from '../models/index.js';
import { findOneOrFail } from '../services/contentService.js';

export const listPackages = asyncHandler(async (req, res) => {
  const items = await CVPackage.find({ status: 'published' }).sort({ order: 1 }).lean();
  sendSuccess(res, { message: 'CV packages', data: items });
});

export const listAllPackages = asyncHandler(async (req, res) => {
  const items = await CVPackage.find().sort({ order: 1 }).lean();
  sendSuccess(res, { message: 'All CV packages', data: items });
});

export const updatePackage = asyncHandler(async (req, res) => {
  const pkg = await findOneOrFail(CVPackage, { _id: req.params.id }, { message: 'Package not found' });
  Object.assign(pkg, req.body);
  await pkg.save();
  sendSuccess(res, { message: 'Package updated', data: pkg });
});
