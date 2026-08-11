const GrantCampaign = require('../models/GrantCampaign');
const AdminAuditLog = require('../models/AdminAuditLog');
const grantService = require('../services/grantService');
const audienceResolver = require('../services/audienceResolver');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');

const audit = (req, action, campaign, changes = [], note = '') =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email,
    action,
    entity: 'grantCampaign',
    entityId: String(campaign._id),
    changes,
    note,
    ip: req.ip,
  });

const load = async (id) => {
  const campaign = await GrantCampaign.findById(id);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  return campaign;
};

// GET /api/admin/monetization/grants
const listCampaigns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = req.query.status ? { status: req.query.status } : {};
  const [campaigns, total] = await Promise.all([
    GrantCampaign.find(filter)
      .populate({ path: 'createdBy', select: 'username', options: { withDeleted: true } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    GrantCampaign.countDocuments(filter),
  ]);
  res.json({ campaigns, total, page, pages: Math.ceil(total / limit) });
});

const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  const targeted = await audienceResolver.count(campaign.audience);
  res.json({ campaign, currentTargetCount: targeted });
});

const createCampaign = asyncHandler(async (req, res) => {
  const { name, amount } = req.body || {};
  if (!name || amount === undefined) {
    return res.status(400).json({ message: 'name and amount are required' });
  }
  const campaign = await GrantCampaign.create({
    ...req.body,
    amount: Number(amount),
    status: 'draft',
    createdBy: req.user._id,
  });
  await audit(req, 'grant.create', campaign, [{ key: 'name', before: null, after: campaign.name }]);
  res.status(201).json({ campaign });
});

const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  if (['running', 'completed', 'reversed'].includes(campaign.status)) {
    return res.status(409).json({ message: `A ${campaign.status} campaign cannot be edited` });
  }
  const editable = ['name', 'internalNote', 'amount', 'amountMode', 'maxPerUser', 'audience', 'schedule', 'expiryDays', 'notify'];
  for (const field of editable) {
    if (req.body[field] !== undefined) campaign[field] = req.body[field];
  }
  // Any change invalidates the previous dry run — the numbers no longer apply.
  campaign.lastDryRunAt = null;
  await campaign.save();
  await audit(req, 'grant.update', campaign);
  res.json({ campaign });
});

const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  if (campaign.status === 'running') {
    return res.status(409).json({ message: 'Cannot delete a running campaign' });
  }
  if (campaign.stats.granted > 0) {
    return res.status(409).json({ message: 'This campaign has issued credits and is kept for the audit trail' });
  }
  await GrantCampaign.deleteOne({ _id: campaign._id });
  await audit(req, 'grant.delete', campaign);
  res.json({ message: 'Campaign deleted' });
});

/**
 * POST /api/admin/monetization/grants/preview
 *
 * Called live as the audience form is edited, so the admin sees "this will
 * target 12,483 users" before committing to anything. No side effects.
 */
const previewAudience = asyncHandler(async (req, res) => {
  const audience = (req.body && req.body.audience) || req.body;
  if (!audience || !audience.mode) return res.status(400).json({ message: 'An audience rule is required' });
  res.json(await grantService.previewAudience(audience));
});

// POST /api/admin/monetization/grants/:id/dry-run
const dryRun = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  const result = await grantService.dryRun(campaign);
  await audit(req, 'grant.dryRun', campaign, [], JSON.stringify(result));
  res.json(result);
});

// POST /api/admin/monetization/grants/:id/execute
const execute = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  try {
    const stats = await grantService.execute(campaign, { actor: req.user });
    await audit(req, 'grant.execute', campaign, [], JSON.stringify(stats));
    res.json({ status: campaign.status, stats });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

// POST /api/admin/monetization/grants/:id/approve
const approve = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  if (campaign.createdBy && String(campaign.createdBy) === String(req.user._id)) {
    // Two-person rule: an approver who is also the author is not a second pair
    // of eyes.
    return res.status(403).json({ message: 'A campaign must be approved by someone other than its author' });
  }
  campaign.approvedBy = req.user._id;
  await campaign.save();
  await audit(req, 'grant.approve', campaign);
  res.json({ campaign });
});

// POST /api/admin/monetization/grants/:id/cancel
const cancel = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  campaign.status = 'cancelled';
  await campaign.save();
  await audit(req, 'grant.cancel', campaign);
  res.json({ campaign });
});

// POST /api/admin/monetization/grants/:id/reverse
const reverse = asyncHandler(async (req, res) => {
  const campaign = await load(req.params.id);
  const result = await grantService.reverse(campaign, { actor: req.user });
  await audit(req, 'grant.reverse', campaign, [], JSON.stringify(result));
  res.json(result);
});

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  previewAudience,
  dryRun,
  execute,
  approve,
  cancel,
  reverse,
};
