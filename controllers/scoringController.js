import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { ScoringConfig } from '../models/index.js';
import { DEFAULT_CONFIG, EDITABLE_WEIGHT_SETS, validateScoringOverride } from '../services/careerIntelligence/scoringConfig.js';

/**
 * Admin management of Resume Health and Job Match weights (spec §37).
 *
 * Configurations are stored as partial overrides and deep-merged over the
 * defaults in code. At most one is active; with none active, the defaults
 * apply. Changing weights changes every score from the next request on,
 * so every change is validated and attributed to the admin who made it.
 */

const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** GET /api/admin/scoring */
export const list = asyncHandler(async (req, res) => {
  const configs = await ScoringConfig.find().sort({ active: -1, updatedAt: -1 }).populate('updatedBy', 'name email').lean();
  sendSuccess(res, {
    message: 'Scoring configurations',
    data: {
      defaults: Object.fromEntries(EDITABLE_WEIGHT_SETS.map(({ path }) => [path.join('.'), getPath(DEFAULT_CONFIG, path)])),
      sets: EDITABLE_WEIGHT_SETS.map(({ path, label }) => ({ key: path.join('.'), label })),
      configs,
      activeId: configs.find((c) => c.active)?._id || null,
    },
  });
});

function checked(body) {
  const { ok, errors, config } = validateScoringOverride(body?.config || {});
  if (!ok) throw ApiError.badRequest(errors.join(' '), errors.map((message) => ({ field: 'config', message })));
  return config;
}

/** POST /api/admin/scoring */
export const create = asyncHandler(async (req, res) => {
  const config = checked(req.body);
  const doc = new ScoringConfig({
    name: req.body.name,
    notes: req.body.notes || '',
    active: Boolean(req.body.active),
    config,
    updatedBy: req.user._id,
  });
  await doc.save();
  sendSuccess(res, { statusCode: 201, message: doc.active ? 'Saved and activated' : 'Saved', data: doc });
});

/** PUT /api/admin/scoring/:id */
export const update = asyncHandler(async (req, res) => {
  const doc = await ScoringConfig.findById(req.params.id);
  if (!doc) throw ApiError.notFound('That configuration does not exist.');
  doc.config = checked(req.body);
  doc.name = req.body.name;
  doc.notes = req.body.notes || '';
  if (typeof req.body.active === 'boolean') doc.active = req.body.active;
  doc.updatedBy = req.user._id;
  doc.markModified('config');
  await doc.save();
  sendSuccess(res, { message: 'Configuration updated', data: doc });
});

/** POST /api/admin/scoring/:id/activate */
export const activate = asyncHandler(async (req, res) => {
  const doc = await ScoringConfig.findById(req.params.id);
  if (!doc) throw ApiError.notFound('That configuration does not exist.');
  doc.active = true;
  doc.updatedBy = req.user._id;
  await doc.save(); // the pre-save hook deactivates every other config
  sendSuccess(res, { message: `“${doc.name}” is now active`, data: doc });
});

/** POST /api/admin/scoring/use-defaults */
export const useDefaults = asyncHandler(async (req, res) => {
  await ScoringConfig.updateMany({ active: true }, { $set: { active: false, updatedBy: req.user._id } });
  sendSuccess(res, { message: 'Default weights are now in use', data: { activeId: null } });
});

/** DELETE /api/admin/scoring/:id */
export const remove = asyncHandler(async (req, res) => {
  const doc = await ScoringConfig.findById(req.params.id);
  if (!doc) throw ApiError.notFound('That configuration does not exist.');
  if (doc.active) throw ApiError.badRequest('Switch to another configuration or the defaults before deleting the active one.');
  await doc.deleteOne();
  sendSuccess(res, { message: 'Configuration deleted', data: { deleted: true } });
});
