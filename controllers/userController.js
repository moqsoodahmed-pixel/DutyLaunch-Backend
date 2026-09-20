import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { User, Job, JobApplication } from '../models/index.js';
import { storage } from '../services/storageService.js';
import { getPagination } from '../utils/pagination.js';

export const getProfile = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Profile', data: { user: req.user.toPublic() } });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const { name, phone, profile, company } = req.body;

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (profile) user.profile = { ...user.profile.toObject(), ...profile };
  if (company && user.role === 'employer') {
    user.company = { ...(user.company?.toObject?.() || {}), ...company };
  }

  await user.save();
  sendSuccess(res, { message: 'Profile updated', data: { user: user.toPublic() } });
});

export const uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose a PDF or Word file to upload');

  const user = await User.findById(req.user._id).select('+profile.resumeKey');
  const previousKey = user.profile?.resumeKey;

  user.profile.resumeKey = storage.keyFromUpload(req.file, 'resumes');
  user.profile.resumeName = req.file.originalname;
  user.profile.resumeUpdatedAt = new Date();
  await user.save();

  if (previousKey) await storage.remove(previousKey);

  sendSuccess(res, {
    message: 'Resume uploaded',
    data: { resumeName: user.profile.resumeName, resumeUpdatedAt: user.profile.resumeUpdatedAt },
  });
});

/** Streams the signed-in user's own resume. Never served statically. */
export const downloadMyResume = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+profile.resumeKey');
  if (!user.profile?.resumeKey) throw ApiError.notFound('You have not uploaded a resume yet');
  const stream = await storage.stream(user.profile.resumeKey);
  res.setHeader('Content-Disposition', `attachment; filename="${user.profile.resumeName}"`);
  stream.pipe(res);
});

export const getMyApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { candidate: req.user._id };

  const [items, total] = await Promise.all([
    JobApplication.find(filter)
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('job', 'title company location slug jobType status')
      .lean(),
    JobApplication.countDocuments(filter),
  ]);

  sendSuccess(res, { message: 'Your applications', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const withdrawApplication = asyncHandler(async (req, res) => {
  const application = await JobApplication.findOne({ _id: req.params.id, candidate: req.user._id });
  if (!application) throw ApiError.notFound('Application not found');
  if (['offered', 'rejected', 'withdrawn'].includes(application.status)) {
    throw ApiError.badRequest('This application can no longer be withdrawn');
  }
  application.status = 'withdrawn';
  application.statusHistory.push({ status: 'withdrawn' });
  await application.save();
  sendSuccess(res, { message: 'Application withdrawn', data: { id: application._id, status: application.status } });
});

export const getSavedJobs = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'savedJobs',
    match: { status: 'published' },
  });
  sendSuccess(res, { message: 'Saved jobs', data: user.savedJobs });
});

export const toggleSavedJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');

  const user = await User.findById(req.user._id);
  const index = user.savedJobs.findIndex((id) => id.toString() === job._id.toString());
  const saved = index === -1;

  if (saved) user.savedJobs.push(job._id);
  else user.savedJobs.splice(index, 1);

  await user.save({ validateBeforeSave: false });
  sendSuccess(res, { message: saved ? 'Job saved' : 'Job removed', data: { saved } });
});
