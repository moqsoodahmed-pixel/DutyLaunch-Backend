import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { User, Job, JobApplication } from '../models/index.js';
import { getDashboardStats } from '../services/statsService.js';
import { getPagination, escapeRegex } from '../utils/pagination.js';
import * as jobService from '../services/jobService.js';

export const dashboard = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Dashboard', data: await getDashboardStats() });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  sendSuccess(res, {
    message: 'Users',
    data: users.map((u) => u.toPublic()),
    meta: paginationMeta({ page, limit, total }),
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString() && req.body.role && req.body.role !== 'admin') {
    throw ApiError.badRequest('You cannot remove your own admin access');
  }
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  if (req.body.role) user.role = req.body.role;
  if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, { message: 'User updated', data: user.toPublic() });
});

export const listAllJobs = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await jobService.listJobs(req.query, { publicOnly: false });
  sendSuccess(res, { message: 'All jobs', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const listAllApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    JobApplication.find(filter)
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('job', 'title company slug')
      .populate('candidate', 'name email')
      .lean(),
    JobApplication.countDocuments(filter),
  ]);
  sendSuccess(res, { message: 'All applications', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const moderateJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');
  job.status = req.body.status;
  await job.save();
  sendSuccess(res, { message: `Job ${job.status}`, data: job });
});
