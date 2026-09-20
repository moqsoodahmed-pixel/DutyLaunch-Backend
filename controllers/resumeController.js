import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { ResumeAnalysis } from '../models/index.js';
import { analyzeResumeFile } from '../services/resumeAnalysisService.js';
import { getPagination } from '../utils/pagination.js';

export const analyzeResume = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach your resume as a PDF, DOC, or DOCX file.');

  const result = await analyzeResumeFile({
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
  });

  const record = await ResumeAnalysis.create({
    user: req.user?._id,
    fileName: req.file.originalname,
    fileType: req.file.mimetype,
    score: result.score,
    categoryScores: result.categoryScores,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    recommendations: result.recommendations,
  });

  sendSuccess(res, {
    statusCode: 200,
    message: 'Resume analyzed',
    data: {
      id: record._id,
      score: result.score,
      categories: result.categoryScores,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      recommendations: result.recommendations,
      createdAt: record.createdAt,
    },
  });
});

export const getMyResumeHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [items, total] = await Promise.all([
    ResumeAnalysis.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('fileName score categoryScores createdAt')
      .lean(),
    ResumeAnalysis.countDocuments({ user: req.user._id }),
  ]);

  sendSuccess(res, {
    message: 'Resume analysis history',
    data: items,
    meta: paginationMeta({ page, limit, total }),
  });
});
