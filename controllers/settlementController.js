import { Settlement, FeeConfig, Payment, PartnerInstitute } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { getPagination } from '../utils/pagination.js';

/* ---------- Provider Portal Settlements ---------- */

/** GET /api/settlements/mine — provider views their settlements and payout summary */
export const mySettlements = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findOne({ owner: req.user._id });
  if (!partner) {
    return sendSuccess(res, {
      message: 'Settlement summary',
      data: { settlements: [], summary: { grossPaise: 0, commissionPaise: 0, payablePaise: 0, paidPaise: 0, balancePaise: 0 } },
    });
  }

  const [settlements, paidOrders] = await Promise.all([
    Settlement.find({ partner: partner._id }).sort({ createdAt: -1 }).lean(),
    Payment.find({ partner: partner._id, status: 'paid' }).lean(),
  ]);

  let totalGross = 0;
  let totalCommission = 0;
  let totalPayable = 0;

  paidOrders.forEach((o) => {
    totalGross += o.amount || 0;
    if (o.feeConfigSnapshot) {
      totalCommission += o.feeConfigSnapshot.platformFeePaise || 0;
      totalPayable += o.feeConfigSnapshot.providerPayablePaise || 0;
    } else {
      const comm = Math.round((o.amount || 0) * 0.15);
      totalCommission += comm;
      totalPayable += (o.amount || 0) - comm;
    }
  });

  const totalPaid = settlements
    .filter((s) => s.status === 'paid')
    .reduce((sum, s) => sum + (s.payableAmountPaise || 0), 0);

  const pendingSettlementTotal = settlements
    .filter((s) => ['pending', 'eligible', 'processing'].includes(s.status))
    .reduce((sum, s) => sum + (s.payableAmountPaise || 0), 0);

  const currentUnbatchedBalance = Math.max(0, totalPayable - totalPaid - pendingSettlementTotal);

  sendSuccess(res, {
    message: 'Your settlements',
    data: {
      settlements: settlements.map((s) => ({
        ...s,
        id: s._id,
        grossAmount: Math.round((s.grossAmountPaise || 0) / 100),
        platformCommission: Math.round((s.platformFeePaise || 0) / 100),
        netPayable: Math.round((s.payableAmountPaise || 0) / 100),
      })),
      summary: {
        grossCollected: Math.round((totalGross || 0) / 100),
        platformCommission: Math.round((totalCommission || 0) / 100),
        settledAmount: Math.round((totalPaid || 0) / 100),
        netPayableBalance: Math.round((currentUnbatchedBalance || 0) / 100),
        totalGrossPaise: totalGross,
        totalCommissionPaise: totalCommission,
        totalPayablePaise: totalPayable,
        totalPaidPaise: totalPaid,
        pendingSettlementPaise: pendingSettlementTotal,
        currentUnbatchedBalancePaise: currentUnbatchedBalance,
      },
    },
  });
});

/* ---------- Admin Settlements & Fee Configuration ---------- */

/** GET /api/settlements/admin — admin view of all settlements */
export const adminListSettlements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.partner) filter.partner = req.query.partner;
  if (req.query.status) filter.status = req.query.status;

  const [items, total, totalGrossAgg, totalSettledAgg] = await Promise.all([
    Settlement.find(filter)
      .populate('partner', 'name displayName orgType location')
      .populate('processedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Settlement.countDocuments(filter),
    Payment.aggregate([
      { $match: { status: 'paid', partner: { $ne: null } } },
      { $group: { _id: null, gross: { $sum: '$amount' } } },
    ]),
    Settlement.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, settled: { $sum: '$payableAmountPaise' } } },
    ]),
  ]);

  const grossCollectedPaise = totalGrossAgg[0]?.gross || 0;
  const settledAmountPaise = totalSettledAgg[0]?.settled || 0;

  sendSuccess(res, {
    message: 'All settlements',
    data: items.map((s) => ({
      ...s,
      grossAmount: Math.round((s.grossAmountPaise || 0) / 100),
      platformCommission: Math.round((s.platformFeePaise || 0) / 100),
      netPayable: Math.round((s.payableAmountPaise || 0) / 100),
    })),
    summary: {
      grossCollected: Math.round(grossCollectedPaise / 100),
      settledAmount: Math.round(settledAmountPaise / 100),
      grossCollectedPaise,
      settledAmountPaise,
    },
    meta: paginationMeta({ page, limit, total }),
  });
});

/** POST /api/settlements/generate — generate a settlement batch for a provider */
export const adminGenerateSettlement = asyncHandler(async (req, res) => {
  const { partnerId } = req.body;
  if (!partnerId) throw ApiError.badRequest('Partner ID is required');

  const partner = await PartnerInstitute.findById(partnerId);
  if (!partner) throw ApiError.notFound('Partner organization not found');

  // Find all existing settled payment IDs to avoid duplicate settlement
  const existingSettlements = await Settlement.find({
    partner: partner._id,
    status: { $nin: ['failed', 'reversed'] },
  }).select('payments');

  const settledPaymentIds = new Set(
    existingSettlements.flatMap((s) => (s.payments || []).map(String))
  );

  // Find paid orders for this partner that haven't been settled yet
  const unSettledPayments = await Payment.find({
    partner: partner._id,
    status: 'paid',
    _id: { $nin: Array.from(settledPaymentIds) },
  }).lean();

  if (!unSettledPayments.length) {
    throw ApiError.badRequest('No unsettled paid orders found for this provider');
  }

  let grossAmountPaise = 0;
  let platformFeePaise = 0;
  let payableAmountPaise = 0;

  unSettledPayments.forEach((p) => {
    grossAmountPaise += p.amount || 0;
    if (p.feeConfigSnapshot) {
      platformFeePaise += p.feeConfigSnapshot.platformFeePaise || 0;
      payableAmountPaise += p.feeConfigSnapshot.providerPayablePaise || 0;
    } else {
      const comm = Math.round((p.amount || 0) * 0.15);
      platformFeePaise += comm;
      payableAmountPaise += (p.amount || 0) - comm;
    }
  });

  const batchId = `STL_${Date.now().toString(36).toUpperCase()}_${Math.floor(Math.random() * 1000)}`;

  const settlement = await Settlement.create({
    partner: partner._id,
    periodStart: unSettledPayments[unSettledPayments.length - 1].createdAt,
    periodEnd: unSettledPayments[0].createdAt,
    grossAmountPaise,
    platformFeePaise,
    payableAmountPaise,
    status: 'eligible',
    batchId,
    payments: unSettledPayments.map((p) => p._id),
    processedBy: req.user._id,
  });

  sendSuccess(res, {
    statusCode: 201,
    message: 'Settlement batch generated',
    data: settlement,
  });
});

/** PATCH /api/settlements/:id — admin update status (e.g. mark paid with UTR) */
export const adminUpdateSettlement = asyncHandler(async (req, res) => {
  const settlement = await Settlement.findById(req.params.id);
  if (!settlement) throw ApiError.notFound('Settlement record not found');

  const { status, payoutReference, notes } = req.body;

  if (status) settlement.status = status;
  if (payoutReference !== undefined) settlement.payoutReference = payoutReference;
  if (notes !== undefined) settlement.notes = notes;

  if (status === 'paid' && !settlement.paidAt) {
    settlement.paidAt = new Date();
  }
  settlement.processedBy = req.user._id;

  await settlement.save();

  sendSuccess(res, {
    message: `Settlement updated to ${settlement.status}`,
    data: settlement,
  });
});

/** GET /api/settlements/fees — list fee configurations */
export const listFeeConfigs = asyncHandler(async (req, res) => {
  const configs = await FeeConfig.find()
    .populate('provider', 'name displayName orgType')
    .populate('updatedBy', 'name email')
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();

  sendSuccess(res, { message: 'Fee configurations', data: configs });
});

/** POST /api/settlements/fees — create or update fee configuration */
export const upsertFeeConfig = asyncHandler(async (req, res) => {
  const { provider, itemType, itemId, isDefault, feeType = 'percentage', feeValue, notes, isActive = true } = req.body;

  let config;
  if (isDefault) {
    config = await FeeConfig.findOne({ isDefault: true });
    if (config) {
      config.feeType = feeType;
      config.feeValue = feeValue;
      config.notes = notes;
      config.isActive = isActive;
      config.updatedBy = req.user._id;
      await config.save();
    } else {
      config = await FeeConfig.create({
        isDefault: true,
        feeType,
        feeValue,
        notes,
        isActive,
        updatedBy: req.user._id,
      });
    }
  } else if (itemId) {
    config = await FeeConfig.findOneAndUpdate(
      { itemId },
      { provider, itemType, itemId, feeType, feeValue, notes, isActive, updatedBy: req.user._id },
      { upsert: true, new: true }
    );
  } else if (provider) {
    config = await FeeConfig.findOneAndUpdate(
      { provider, itemId: null },
      { provider, feeType, feeValue, notes, isActive, updatedBy: req.user._id },
      { upsert: true, new: true }
    );
  } else {
    throw ApiError.badRequest('Specify isDefault, provider, or itemId for fee configuration');
  }

  sendSuccess(res, {
    message: 'Fee configuration saved',
    data: config,
  });
});

/** DELETE /api/settlements/fees/:id — remove fee override */
export const deleteFeeConfig = asyncHandler(async (req, res) => {
  const config = await FeeConfig.findById(req.params.id);
  if (!config) throw ApiError.notFound('Fee configuration not found');
  if (config.isDefault) throw ApiError.badRequest('Cannot delete the platform default fee configuration');

  await config.deleteOne();
  sendSuccess(res, { message: 'Fee configuration removed', data: { id: req.params.id } });
});
