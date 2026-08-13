const mongoose = require('mongoose');
const GrantCampaign = require('../models/GrantCampaign');
const AdminAuditLog = require('../models/AdminAuditLog');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
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

/**
 * GET /api/admin/monetization/grants/user-search?q=
 *
 * Feeds the "specific users" picker. Deliberately its own endpoint rather than
 * reusing /admin/users: that one returns whole user documents for the user
 * table, and this runs on every keystroke. Balance rides along because the one
 * thing an admin wants to see before gifting credits is what someone already
 * has.
 */
const searchUsers = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 10, 25);
  if (q.length < 2) return res.json({ users: [] });

  // Escaped: an admin typing "a+b" should search for it, not blow up the regex.
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = { $regex: safe, $options: 'i' };

  // Banned and deleted users are excluded here for the same reason the audience
  // resolver drops them — offering someone the picker cannot actually pay is
  // worse than not listing them.
  const users = await User.find({
    banned: false,
    $or: [{ username: rx }, { email: rx }, { fullName: rx }],
  })
    .select('username email fullName avatar')
    .sort({ username: 1 })
    .limit(limit)
    .lean();

  const wallets = await Wallet.find({ user: { $in: users.map((u) => u._id) } })
    .select('user balance')
    .lean();
  const balances = new Map(wallets.map((w) => [String(w.user), w.balance]));

  res.json({
    users: users.map((user) => ({
      id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      avatar: user.avatar,
      balance: balances.get(String(user._id)) || 0,
    })),
  });
});

/**
 * POST /api/admin/monetization/grants/quick-send
 *
 * One-off gift to named users: create, dry run and execute in a single call.
 *
 * The dry run is not skipped — it is what makes `grants.maxCreditsPerCampaign`
 * and the approval threshold apply here exactly as they do to a full campaign.
 * A shortcut that bypassed those guards would be a hole in them.
 */
const quickSend = asyncHandler(async (req, res) => {
  const { userIds, amount, reason, expiryDays = 0, notify = true } = req.body || {};

  const ids = (Array.isArray(userIds) ? userIds : []).filter((id) =>
    mongoose.Types.ObjectId.isValid(String(id))
  );
  if (!ids.length) return res.status(400).json({ message: 'Pick at least one user' });

  const credits = Number(amount);
  if (!Number.isFinite(credits) || credits <= 0) {
    return res.status(400).json({ message: 'amount must be a positive number of credits' });
  }

  // A rejected id is almost always a stale picker entry, and silently paying a
  // subset of who the admin selected is the wrong failure.
  const found = await User.find({ _id: { $in: ids }, banned: false }).select('_id username').lean();
  if (found.length !== ids.length) {
    return res.status(400).json({
      message: 'Some selected users no longer exist or are banned',
      resolved: found.length,
      requested: ids.length,
    });
  }

  const label =
    String(reason || '').trim() ||
    (found.length === 1 ? `Credits for ${found[0].username}` : `Credits for ${found.length} users`);

  const campaign = await GrantCampaign.create({
    name: label,
    internalNote: 'Sent from the quick-send panel',
    amount: credits,
    amountMode: 'fixed',
    audience: { mode: 'specific', userIds: ids },
    expiryDays: Number(expiryDays) || 0,
    notify: { enabled: notify !== false, channels: ['in_app'], message: String(reason || '').trim() },
    status: 'draft',
    createdBy: req.user._id,
  });

  await audit(req, 'grant.create', campaign, [{ key: 'quickSend', before: null, after: label }]);

  try {
    const preview = await grantService.dryRun(campaign);
    const stats = await grantService.execute(campaign, { actor: req.user });
    await audit(req, 'grant.execute', campaign, [], JSON.stringify(stats));
    return res.json({ campaign, preview, stats });
  } catch (error) {
    // The campaign row stays as a draft so the failure is visible and the admin
    // can approve or retry it from the campaign list rather than losing the work.
    if (error.status) return res.status(error.status).json({ message: error.message, campaignId: campaign._id });
    throw error;
  }
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
  searchUsers,
  quickSend,
  dryRun,
  execute,
  approve,
  cancel,
  reverse,
};
