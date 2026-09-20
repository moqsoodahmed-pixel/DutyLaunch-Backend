import { Job } from '../models/Job.js';
import { JobApplication } from '../models/JobApplication.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex, getPagination } from '../utils/pagination.js';

function buildJobFilter(query, { publicOnly = true } = {}) {
  const filter = {};
  if (publicOnly) {
    filter.status = 'published';
    filter.$or = [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gte: new Date() } }];
  } else if (query.status) {
    filter.status = query.status;
  }

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const search = [{ title: rx }, { company: rx }, { skills: rx }];
    filter.$and = [...(filter.$and || []), { $or: search }];
  }
  if (query.category) filter.category = query.category;
  if (query.jobType) filter.jobType = query.jobType;
  if (query.workMode) filter.workMode = query.workMode;
  if (query.country) filter.country = query.country;
  if (query.location) filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.minExperience) filter['experience.max'] = { $gte: Number(query.minExperience) };
  if (query.maxExperience) filter['experience.min'] = { $lte: Number(query.maxExperience) };
  if (query.featured === 'true') filter.isFeatured = true;
  return filter;
}

const SORTS = {
  recent: { publishedAt: -1, createdAt: -1 },
  oldest: { publishedAt: 1 },
  'salary-high': { 'salary.max': -1 },
  relevance: { isFeatured: -1, publishedAt: -1 },
};

export async function listJobs(query, options = {}) {
  const { page, limit, skip } = getPagination(query);
  const filter = buildJobFilter(query, options);
  const sort = SORTS[query.sort] || SORTS.relevance;

  const [items, total] = await Promise.all([
    Job.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Job.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

export async function getJobBySlugOrId(idOrSlug, { publicOnly = true } = {}) {
  const byId = /^[a-f\d]{24}$/i.test(idOrSlug);
  const filter = byId ? { _id: idOrSlug } : { slug: idOrSlug };
  if (publicOnly) filter.status = 'published';

  const job = await Job.findOne(filter);
  if (!job) throw ApiError.notFound('That job is no longer listed');
  return job;
}

export async function getJobFacets() {
  const [categories, locations, types] = await Promise.all([
    Job.distinct('category', { status: 'published' }),
    Job.distinct('location', { status: 'published' }),
    Job.distinct('jobType', { status: 'published' }),
  ]);
  return { categories: categories.sort(), locations: locations.sort(), jobTypes: types.sort() };
}

export async function applyToJob({ jobId, candidate, resumeKey, resumeName, coverLetter }) {
  const job = await Job.findOne({ _id: jobId, status: 'published' });
  if (!job) throw ApiError.notFound('That job is no longer accepting applications');
  if (job.expiresAt && job.expiresAt < new Date()) {
    throw ApiError.badRequest('Applications for this job have closed');
  }

  const already = await JobApplication.exists({ job: job._id, candidate: candidate._id });
  if (already) throw ApiError.conflict('You have already applied to this job');

  const application = await JobApplication.create({
    job: job._id,
    candidate: candidate._id,
    employer: job.employer,
    resumeKey,
    resumeName,
    coverLetter,
    statusHistory: [{ status: 'submitted' }],
  });

  await Job.updateOne({ _id: job._id }, { $inc: { applicationCount: 1 } });
  return application;
}

export async function updateApplicationStatus({ applicationId, status, note, actor }) {
  const application = await JobApplication.findById(applicationId).populate('job', 'employer title');
  if (!application) throw ApiError.notFound('Application not found');

  const isOwner = application.employer?.toString() === actor._id.toString();
  if (actor.role !== 'admin' && !isOwner) throw ApiError.forbidden();

  application.status = status;
  application.statusHistory.push({ status, note });
  await application.save();
  return application;
}
