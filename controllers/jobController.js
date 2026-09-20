import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { Job, JobApplication } from '../models/index.js';
import * as jobService from '../services/jobService.js';
import { storage } from '../services/storageService.js';
import { getPagination } from '../utils/pagination.js';

export const listJobs = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await jobService.listJobs(req.query);
  sendSuccess(res, { message: 'Jobs', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const getJobFilters = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Job filters', data: await jobService.getJobFacets() });
});

export const getJob = asyncHandler(async (req, res) => {
  const job = await jobService.getJobBySlugOrId(req.params.idOrSlug);
  await Job.updateOne({ _id: job._id }, { $inc: { viewCount: 1 } });

  let hasApplied = false;
  if (req.user) {
    hasApplied = Boolean(await JobApplication.exists({ job: job._id, candidate: req.user._id }));
  }

  const related = await Job.find({
    _id: { $ne: job._id },
    status: 'published',
    category: job.category,
  })
    .limit(3)
    .select('title company location jobType slug salary experience')
    .lean();

  sendSuccess(res, { message: 'Job details', data: { job, related, hasApplied } });
});

export const applyToJob = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach your resume as a PDF or Word file');

  const application = await jobService.applyToJob({
    jobId: req.params.id,
    candidate: req.user,
    resumeKey: storage.keyFromUpload(req.file, 'resumes'),
    resumeName: req.file.originalname,
    coverLetter: req.body.coverLetter,
  });

  sendSuccess(res, {
    statusCode: 201,
    message: 'Application sent',
    data: { id: application._id, status: application.status, appliedAt: application.appliedAt },
  });
});

/* ---------- employer surface ---------- */

export const createJob = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const job = await Job.create({
    ...req.body,
    employer: req.user._id,
    company: req.user.role === 'employer' ? req.user.company?.name || req.body.company : req.body.company,
    // Employer posts enter moderation; admins can publish directly.
    status: isAdmin ? req.body.status || 'draft' : req.body.status === 'published' ? 'pending' : req.body.status || 'draft',
  });
  sendSuccess(res, { statusCode: 201, message: 'Job created', data: job });
});

export const listMyJobs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { employer: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Job.countDocuments(filter),
  ]);
  sendSuccess(res, { message: 'Your jobs', data: items, meta: paginationMeta({ page, limit, total }) });
});

async function findOwnedJob(req) {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');
  if (req.user.role !== 'admin' && job.employer?.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden();
  }
  return job;
}

export const updateJob = asyncHandler(async (req, res) => {
  const job = await findOwnedJob(req);
  Object.assign(job, req.body);
  if (req.user.role !== 'admin' && req.body.status === 'published') job.status = 'pending';
  await job.save();
  sendSuccess(res, { message: 'Job updated', data: job });
});

export const deleteJob = asyncHandler(async (req, res) => {
  const job = await findOwnedJob(req);
  await job.deleteOne();
  await JobApplication.deleteMany({ job: job._id });
  sendSuccess(res, { message: 'Job removed', data: { id: job._id } });
});

export const listJobApplications = asyncHandler(async (req, res) => {
  const job = await findOwnedJob(req);
  const applications = await JobApplication.find({ job: job._id })
    .sort({ appliedAt: -1 })
    .populate('candidate', 'name email phone profile.headline profile.experienceYears')
    .lean();
  sendSuccess(res, { message: 'Applications', data: applications });
});

export const listEmployerApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { employer: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    JobApplication.find(filter)
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('job', 'title company slug')
      .populate('candidate', 'name email profile.headline')
      .lean(),
    JobApplication.countDocuments(filter),
  ]);
  sendSuccess(res, { message: 'Applications', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const setApplicationStatus = asyncHandler(async (req, res) => {
  const application = await jobService.updateApplicationStatus({
    applicationId: req.params.id,
    status: req.body.status,
    note: req.body.note,
    actor: req.user,
  });
  sendSuccess(res, { message: 'Status updated', data: { id: application._id, status: application.status } });
});

/** Streams a candidate resume to the owning employer or an admin. */
export const downloadApplicationResume = asyncHandler(async (req, res) => {
  const application = await JobApplication.findById(req.params.id).select('+resumeKey');
  if (!application) throw ApiError.notFound('Application not found');

  const isOwner = application.employer?.toString() === req.user._id.toString();
  const isCandidate = application.candidate.toString() === req.user._id.toString();
  if (req.user.role !== 'admin' && !isOwner && !isCandidate) throw ApiError.forbidden();

  const stream = await storage.stream(application.resumeKey);
  res.setHeader('Content-Disposition', `attachment; filename="${application.resumeName}"`);
  stream.pipe(res);
});
