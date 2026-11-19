import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { CmsPricingItem } from '../models/CmsPricingItem.js';
import { CmsGlobalConfig } from '../models/CmsGlobalConfig.js';
import { CVPackage } from '../models/CVPackage.js';

const SEED_CMS_ITEMS = [
  // 1. Bundle Packages
  {
    key: 'early-career-bundle',
    category: 'bundle',
    name: 'Early Career Bundle',
    experienceBand: '0 to 2 years',
    experienceMin: 0,
    experienceMax: 2,
    price: 399,
    originalPrice: 899,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹500',
    tagline: 'Handcrafted resume for graduates and entry-level professionals.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    isPopular: false,
    order: 1,
    status: 'published',
    affectsSurfaces: ['/resume-service', '/pricing', '/resume-builder', 'Package Checkout Modal'],
    deliverables: [
      { id: 'd1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'd2', label: 'Customised cover letter', included: true },
      { id: 'd3', label: 'LinkedIn profile optimisation', included: true },
      { id: 'd4', label: '1 month unlimited revisions', included: true },
      { id: 'd5', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'd6', label: 'Positioning for internships, trainee and entry-level roles', included: true },
    ],
  },
  {
    key: 'mid-level-bundle',
    category: 'bundle',
    name: 'Mid-Level Professional',
    experienceBand: '3 to 5 years',
    experienceMin: 3,
    experienceMax: 5,
    price: 799,
    originalPrice: 1499,
    hasStrikeThrough: true,
    currency: 'INR',
    isPopular: true,
    saveText: 'Save ₹700',
    tagline: 'Turn your achievements and projects into high career impact.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 2,
    status: 'published',
    affectsSurfaces: ['/resume-service', '/pricing', '/resume-builder', 'Package Checkout Modal'],
    deliverables: [
      { id: 'd1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'd2', label: 'Customised cover letter', included: true },
      { id: 'd3', label: 'LinkedIn profile optimisation', included: true },
      { id: 'd4', label: '1 month unlimited revisions', included: true },
      { id: 'd5', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'd6', label: 'Achievement rewriting with measurable outcomes', included: true },
      { id: 'd7', label: 'Keyword mapping against your target roles', included: true },
    ],
  },
  {
    key: 'senior-bundle',
    category: 'bundle',
    name: 'Senior Professional',
    experienceBand: '6 to 8 years',
    experienceMin: 6,
    experienceMax: 8,
    price: 999,
    originalPrice: 1799,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹800',
    tagline: 'A strategic profile that positions you as a clear team leader.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 3,
    status: 'published',
    affectsSurfaces: ['/resume-service', '/pricing', '/resume-builder', 'Package Checkout Modal'],
    deliverables: [
      { id: 'd1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'd2', label: 'Customised cover letter', included: true },
      { id: 'd3', label: 'LinkedIn profile optimisation', included: true },
      { id: 'd4', label: '1 month unlimited revisions', included: true },
      { id: 'd5', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'd6', label: 'Achievement rewriting with measurable outcomes', included: true },
      { id: 'd7', label: 'Keyword mapping against your target roles', included: true },
      { id: 'd8', label: 'Leadership and scope-of-responsibility framing', included: true },
    ],
  },
  {
    key: 'executive-bundle',
    category: 'bundle',
    name: 'Leadership & Executive',
    experienceBand: '9+ years',
    experienceMin: 9,
    experienceMax: null,
    price: 1199,
    originalPrice: 2199,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹1,000',
    tagline: 'Board-level narrative and portfolio written for decision makers.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 4,
    status: 'published',
    affectsSurfaces: ['/resume-service', '/pricing', '/resume-builder', 'Package Checkout Modal'],
    deliverables: [
      { id: 'd1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'd2', label: 'Customised cover letter', included: true },
      { id: 'd3', label: 'LinkedIn profile optimisation', included: true },
      { id: 'd4', label: '1 month unlimited revisions', included: true },
      { id: 'd5', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'd6', label: 'Achievement rewriting with measurable outcomes', included: true },
      { id: 'd7', label: 'Keyword mapping against your target roles', included: true },
      { id: 'd8', label: 'Leadership and scope-of-responsibility framing', included: true },
      { id: 'd9', label: 'Executive summary and board-level narrative', included: true },
    ],
  },

  // 2. CV Only Packages
  {
    key: 'early-career-cv',
    category: 'cv_only',
    name: 'Early Career CV',
    experienceBand: '0 to 2 years',
    price: 299,
    originalPrice: 699,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹400',
    tagline: 'Precision ATS resume crafted for internships, fresh graduates and entry roles.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 1,
    status: 'published',
    affectsSurfaces: ['/resume-service (CV Only Tab)', 'Package Checkout Modal'],
    deliverables: [
      { id: 'c1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'c2', label: 'Keyword mapping against target entry-level roles', included: true },
      { id: 'c3', label: '1 month unlimited revisions', included: true },
      { id: 'c4', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'c5', label: 'Clean PDF + editable DOCX delivery', included: true },
    ],
  },
  {
    key: 'mid-level-cv',
    category: 'cv_only',
    name: 'Mid-Level Professional CV',
    experienceBand: '3 to 5 years',
    price: 549,
    originalPrice: 1199,
    hasStrikeThrough: true,
    currency: 'INR',
    isPopular: true,
    saveText: 'Save ₹650',
    tagline: 'Highlight measurable achievements and core technical competencies.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 2,
    status: 'published',
    affectsSurfaces: ['/resume-service (CV Only Tab)', 'Package Checkout Modal'],
    deliverables: [
      { id: 'c1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'c2', label: 'Achievement rewriting with measurable outcomes', included: true },
      { id: 'c3', label: 'Keyword mapping against your target roles', included: true },
      { id: 'c4', label: '1 month unlimited revisions', included: true },
      { id: 'c5', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'c6', label: 'Clean PDF + editable DOCX delivery', included: true },
    ],
  },
  {
    key: 'senior-cv',
    category: 'cv_only',
    name: 'Senior Professional CV',
    experienceBand: '6 to 8 years',
    price: 749,
    originalPrice: 1399,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹650',
    tagline: 'Structured profile emphasizing leadership and team management.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 3,
    status: 'published',
    affectsSurfaces: ['/resume-service (CV Only Tab)', 'Package Checkout Modal'],
    deliverables: [
      { id: 'c1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'c2', label: 'Achievement rewriting with measurable outcomes', included: true },
      { id: 'c3', label: 'Leadership and scope-of-responsibility framing', included: true },
      { id: 'c4', label: 'Keyword mapping against your target roles', included: true },
      { id: 'c5', label: '1 month unlimited revisions', included: true },
      { id: 'c6', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'c7', label: 'Clean PDF + editable DOCX delivery', included: true },
    ],
  },
  {
    key: 'executive-cv',
    category: 'cv_only',
    name: 'Leadership & Executive CV',
    experienceBand: '9+ years',
    price: 899,
    originalPrice: 1699,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹800',
    tagline: 'Strategic board-level narrative for directors and senior leaders.',
    deliveryDays: 'Delivery in 2–3 Days *',
    revisionWindow: '1 month unlimited revisions',
    order: 4,
    status: 'published',
    affectsSurfaces: ['/resume-service (CV Only Tab)', 'Package Checkout Modal'],
    deliverables: [
      { id: 'c1', label: 'ATS-friendly CV crafted manually by expert writers', included: true },
      { id: 'c2', label: 'Executive summary and board-level narrative', included: true },
      { id: 'c3', label: 'Strategic impact & P&L metrics highlight', included: true },
      { id: 'c4', label: 'Keyword mapping against your target roles', included: true },
      { id: 'c5', label: '1 month unlimited revisions', included: true },
      { id: 'c6', label: 'Delivery in 2–3 Days *', included: true },
      { id: 'c7', label: 'Clean PDF + editable DOCX delivery', included: true },
    ],
  },

  // 3. Executive Portfolios & Add-ons
  {
    key: 'addon-visual-portfolio',
    category: 'addon',
    name: 'Visual Executive Portfolio',
    experienceBand: 'All Experience Levels',
    price: 999,
    originalPrice: 2999,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹2,000',
    tagline: 'A single comprehensive presentation document showcasing key projects, deliverables, and measurable career outcomes.',
    deliveryDays: 'Delivery in 2–3 Days *',
    order: 1,
    status: 'published',
    affectsSurfaces: ['/resume-service (Career Add-ons)', 'Package Checkout Modal (Checkbox)', 'Admin Order Management'],
    deliverables: [
      { id: 'a1', label: 'Executive case study layouts with metric highlights', included: true },
      { id: 'a2', label: 'High-res PDF ready to attach to job applications', included: true },
      { id: 'a3', label: 'Turnaround: Delivered in 2–3 Days *', included: true },
    ],
  },
  {
    key: 'addon-web-portfolio',
    category: 'addon',
    name: 'Live Personal Web Portfolio',
    experienceBand: 'All Experience Levels',
    price: 1999,
    originalPrice: 3999,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹2,000',
    tagline: 'Your own responsive, custom-built personal portfolio website hosted with a shareable URL for LinkedIn & CV headers.',
    deliveryDays: 'Delivery in 2–3 Days *',
    order: 2,
    status: 'published',
    affectsSurfaces: ['/resume-service (Career Add-ons)', 'Package Checkout Modal (Checkbox)', 'Admin Order Management'],
    deliverables: [
      { id: 'a4', label: 'Custom responsive web portfolio with modern design', included: true },
      { id: 'a5', label: 'Dedicated shareable URL for your CV & LinkedIn bio', included: true },
      { id: 'a6', label: 'Fast delivery in 2–3 Days *', included: true },
    ],
  },
  {
    key: 'addon-mock-interview',
    category: 'addon',
    name: '1-on-1 Mock Interview',
    experienceBand: 'All Experience Levels',
    price: 699,
    originalPrice: 1499,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save ₹800',
    tagline: 'Personalized 30-min interview coaching session with senior industry interviewers tailored to your target job posting.',
    deliveryDays: 'Scheduled at candidate convenience',
    order: 3,
    status: 'published',
    affectsSurfaces: ['/resume-service (Career Add-ons)', 'Package Checkout Modal (Checkbox)', 'Admin Order Management'],
    deliverables: [
      { id: 'a7', label: 'Role-specific behavioral & technical scenario questions', included: true },
      { id: 'a8', label: 'Detailed feedback scorecard & salary conversation tips', included: true },
      { id: 'a9', label: 'Scheduled at candidate convenience', included: true },
    ],
  },

  // 4. Subscriptions
  {
    key: 'sub-monthly',
    category: 'subscription',
    name: 'Premium — Monthly',
    experienceBand: 'Subscription',
    price: 199,
    originalPrice: 399,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Billed monthly',
    tagline: 'Unlimited PDF downloads, public shareable links, and job tracking.',
    order: 1,
    status: 'published',
    affectsSurfaces: ['/pricing (Detailed Feature Comparison)'],
    deliverables: [
      { id: 's1', label: 'Unlimited PDF downloads (PDF-only)', included: true },
      { id: 's2', label: 'Public shareable resume links', included: true },
      { id: 's3', label: 'Unlimited AI resumes & cover letters', included: true },
      { id: 's4', label: 'Priority support', included: true },
    ],
  },
  {
    key: 'sub-annual',
    category: 'subscription',
    name: 'Premium — Annual',
    experienceBand: 'Subscription',
    price: 1699,
    originalPrice: 2388,
    hasStrikeThrough: true,
    currency: 'INR',
    saveText: 'Save 30%',
    tagline: 'Best value for year-round career advancement and job search.',
    isPopular: true,
    order: 2,
    status: 'published',
    affectsSurfaces: ['/pricing (Detailed Feature Comparison)'],
    deliverables: [
      { id: 's5', label: 'Full year unlimited access to all AI tools', included: true },
      { id: 's6', label: 'All 7 ATS resume templates', included: true },
      { id: 's7', label: 'Virtual Interview Simulator access', included: true },
      { id: 's8', label: 'Dedicated priority career support', included: true },
    ],
  },
];

async function ensureSeeded() {
  const count = await CmsPricingItem.countDocuments();
  if (count === 0) {
    try {
      await CmsPricingItem.insertMany(SEED_CMS_ITEMS, { ordered: false });
    } catch (err) {
      // Two requests can both see count===0 and race to seed at once
      // (e.g. right after a fresh deploy) — a duplicate-key error here just
      // means the other request won, not a real failure.
      if (err?.code !== 11000) throw err;
    }
  }
  let config = await CmsGlobalConfig.findOne();
  if (!config) {
    try {
      config = await CmsGlobalConfig.create({});
    } catch (err) {
      if (err?.code === 11000) {
        config = await CmsGlobalConfig.findOne();
      } else {
        throw err;
      }
    }
  }
  return config;
}

/**
 * Public Endpoint: GET /api/cms/pricing
 * Consumed by /resume-service, /pricing, and checkout modals
 */
export const getPublicPricing = asyncHandler(async (req, res) => {
  await ensureSeeded();

  const [items, config] = await Promise.all([
    CmsPricingItem.find({ status: 'published' }).sort({ category: 1, order: 1 }).lean(),
    CmsGlobalConfig.findOne().lean(),
  ]);

  const bundles = items.filter((i) => i.category === 'bundle');
  const cvOnly = items.filter((i) => i.category === 'cv_only');
  const addons = items.filter((i) => i.category === 'addon');
  const subscriptions = items.filter((i) => i.category === 'subscription');
  const services = items.filter((i) => i.category === 'service');

  sendSuccess(res, {
    message: 'Active pricing items',
    data: {
      bundles,
      cvOnly,
      addons,
      subscriptions,
      services,
      allItems: items,
      config: config || { gstPercentage: 18, turnaroundDisclaimer: 'Delivery in 2–3 Days *' },
    },
  });
});

/**
 * Admin Endpoint: GET /api/cms/admin/pricing
 * Returns all items, drafts, surfaces, and global statistics
 */
export const getAllAdminPricing = asyncHandler(async (req, res) => {
  await ensureSeeded();

  const [items, config] = await Promise.all([
    CmsPricingItem.find().sort({ category: 1, order: 1 }).lean(),
    CmsGlobalConfig.findOne().lean(),
  ]);

  const stats = {
    totalItems: items.length,
    publishedItems: items.filter((i) => i.status === 'published').length,
    draftItems: items.filter((i) => i.status === 'draft').length,
    bundlesCount: items.filter((i) => i.category === 'bundle').length,
    cvOnlyCount: items.filter((i) => i.category === 'cv_only').length,
    addonsCount: items.filter((i) => i.category === 'addon').length,
    subscriptionsCount: items.filter((i) => i.category === 'subscription').length,
    averagePrice: Math.round(items.reduce((acc, i) => acc + (i.price || 0), 0) / (items.length || 1)),
  };

  sendSuccess(res, {
    message: 'CMS Pricing Hub Data',
    data: {
      items,
      config: config || {},
      stats,
    },
  });
});

/**
 * Admin Endpoint: POST /api/cms/admin/pricing
 * Creates a brand new package or add-on
 */
export const createPricingItem = asyncHandler(async (req, res) => {
  const { name, category, price } = req.body;
  if (!name || !category || price == null) {
    throw ApiError.badRequest('Name, category, and price are required.');
  }

  const key = req.body.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const existing = await CmsPricingItem.findOne({ key });
  if (existing) {
    throw ApiError.conflict(`An item with key "${key}" already exists.`);
  }

  const item = await CmsPricingItem.create({
    ...req.body,
    key,
  });

  // If it is a bundle, also sync or update CVPackage collection to maintain backwards compatibility
  if (category === 'bundle') {
    try {
      await CVPackage.findOneAndUpdate(
        { slug: key },
        {
          name: item.name,
          price: item.price,
          experienceBand: item.experienceBand,
          experienceMin: item.experienceMin || 0,
          experienceMax: item.experienceMax || null,
          tagline: item.tagline,
          isPopular: item.isPopular,
          deliveryDays: item.deliveryDays,
          revisionWindow: item.revisionWindow,
        },
        { upsert: true, new: true }
      );
    } catch {
      // non-blocking
    }
  }

  sendSuccess(res, {
    statusCode: 201,
    message: `Created "${item.name}" successfully`,
    data: item,
  });
});

/**
 * Admin Endpoint: PUT /api/cms/admin/pricing/:id
 * Updates package, prices, strikethrough, deliverables, etc.
 */
export const updatePricingItem = asyncHandler(async (req, res) => {
  const item = await CmsPricingItem.findById(req.params.id);
  if (!item) {
    throw ApiError.notFound('Pricing item not found.');
  }

  // Calculate saveText automatically if prices changed and user did not specify custom save text
  if (req.body.price != null || req.body.originalPrice != null) {
    const newPrice = req.body.price ?? item.price;
    const newOriginal = req.body.originalPrice ?? item.originalPrice;
    if (newOriginal > newPrice && !req.body.saveText) {
      req.body.saveText = `Save ₹${(newOriginal - newPrice).toLocaleString('en-IN')}`;
    }
  }

  Object.assign(item, req.body);
  await item.save();

  // Backward compatibility: sync to CVPackage if bundle
  if (item.category === 'bundle') {
    try {
      await CVPackage.findOneAndUpdate(
        { $or: [{ slug: item.key }, { name: item.name }] },
        {
          name: item.name,
          price: item.price,
          experienceBand: item.experienceBand,
          experienceMin: item.experienceMin,
          experienceMax: item.experienceMax,
          tagline: item.tagline,
          isPopular: item.isPopular,
          deliveryDays: item.deliveryDays,
          revisionWindow: item.revisionWindow,
          features: item.deliverables?.map((d) => ({ label: d.label, included: d.included })),
        }
      );
    } catch {
      // non-blocking
    }
  }

  sendSuccess(res, {
    message: `Updated "${item.name}" successfully`,
    data: item,
  });
});

/**
 * Admin Endpoint: DELETE /api/cms/admin/pricing/:id
 */
export const deletePricingItem = asyncHandler(async (req, res) => {
  const item = await CmsPricingItem.findById(req.params.id);
  if (!item) {
    throw ApiError.notFound('Pricing item not found.');
  }

  await CmsPricingItem.findByIdAndDelete(req.params.id);

  sendSuccess(res, {
    message: `Deleted "${item.name}" from CMS`,
    data: { id: req.params.id },
  });
});

/**
 * Admin Endpoint: PUT /api/cms/admin/config
 * Updates global GST percentage, SLA disclaimer, announcement banner
 */
export const updateGlobalConfig = asyncHandler(async (req, res) => {
  let config = await CmsGlobalConfig.findOne();
  if (!config) {
    config = new CmsGlobalConfig();
  }

  Object.assign(config, req.body);
  config.updatedBy = req.user?.email || 'admin';
  await config.save();

  sendSuccess(res, {
    message: 'Global CMS configurations updated successfully',
    data: config,
  });
});

/**
 * Admin Endpoint: POST /api/cms/admin/reset-defaults
 */
export const resetToDefaults = asyncHandler(async (req, res) => {
  await CmsPricingItem.deleteMany({});
  await CmsPricingItem.insertMany(SEED_CMS_ITEMS);
  const config = await CmsGlobalConfig.findOneAndUpdate(
    {},
    {
      gstPercentage: 18,
      turnaroundDisclaimer:
        '* Delivery Turnaround Guarantee: Delivery turnaround begins after candidate submits current CV and target career preferences.',
      allowDiscounts: true,
      updatedBy: req.user?.email || 'admin',
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, {
    message: 'Reset all pricing items and settings to published DutyLaunch defaults',
    data: { count: SEED_CMS_ITEMS.length, config },
  });
});
