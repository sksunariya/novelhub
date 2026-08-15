const Space = require('../models/Space');
const SpaceMember = require('../models/SpaceMember');
const spaceService = require('../services/community/spaceService');
const permissions = require('../services/community/spacePermissionService');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');
const {
  PAGINATION,
  SPACE_STATUS,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_STATUS,
  PUBLIC_USER_FIELDS,
} = require('../config/constants');

// Serializers, not raw documents. Returning a Mongoose document exposes every
// field added to the model by default — which here would leak a space's
// `overrides`, its moderation `bannedWords`, and the `purpose` text written for
// admin review. Same reasoning as utils/serializers.js.

const serializeSpace = (space, perms = null) => ({
  id: space._id,
  slug: space.slug,
  name: space.name,
  tagline: space.tagline,
  description: space.description,
  iconUrl: space.iconUrl,
  bannerUrl: space.bannerUrl,
  theme: { primary: space.theme?.primary || '', banner: space.theme?.banner || 'gradient',
           prefersDarkText: Boolean(space.theme?.prefersDarkText) },
  visibility: space.visibility,
  joinPolicy: space.joinPolicy,
  status: space.status,
  nsfw: space.nsfw,
  topics: space.topics,
  language: space.language,
  linkedRefs: space.linkedRefs,
  rules: space.rules,
  allowedPostTypes: space.allowedPostTypes,
  featured: space.featured,
  verified: space.verified,
  locked: space.locked,
  publicModlog: space.publicModlog,
  memberCount: space.memberCount,
  postCount: space.postCount,
  lastPostAt: space.lastPostAt,
  createdAt: space.createdAt,
  ...(perms ? { viewer: { ...perms.can, isMember: perms.isMember, isModerator: perms.isModerator,
                          isOwner: perms.isOwner, isBanned: perms.isBanned, reason: perms.reason } } : {}),
});

const serializeSpaceCard = (space) => ({
  id: space._id,
  slug: space.slug,
  name: space.name,
  tagline: space.tagline,
  iconUrl: space.iconUrl,
  nsfw: space.nsfw,
  topics: space.topics,
  memberCount: space.memberCount,
  verified: space.verified,
});

const serializeMember = (member) => ({
  user: member.user && member.user._id ? {
    id: member.user._id,
    username: member.user.username,
    avatarUrl: member.user.avatarUrl,
  } : member.user,
  role: member.role,
  status: member.status,
  permissions: member.permissions,
  flairText: member.flairText,
  karma: member.karma,
  joinedAt: member.joinedAt,
  ...(member.status === SPACE_MEMBER_STATUS.BANNED
    ? { bannedUntil: member.bannedUntil, banReason: member.banReason }
    : {}),
});

const parsePagination = (query, maxLimit = PAGINATION.MAX_LIMIT) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

const requireCommunityEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) {
    throw Object.assign(new Error('Not found'), { status: 404 });
  }
  return snapshot;
};

const deny = (perms, permission) => {
  if (!perms.can[permission]) {
    throw Object.assign(new Error(perms.reason === 'banned' ? 'You are banned from this space'
      : 'You do not have permission to do that'), { status: 403 });
  }
};

// ------------------------------------------------------------------ browse

const listSpaces = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { search, topic, sort = 'popular' } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  // Only ever public, active spaces from this endpoint. Private and pending
  // spaces are reachable by slug for those entitled, never by listing.
  const filter = { status: SPACE_STATUS.ACTIVE, visibility: { $ne: 'private' } };
  if (topic) filter.topics = topic;
  if (search) filter.$text = { $search: search };

  const sorts = {
    popular: { memberCount: -1, _id: -1 },
    new: { createdAt: -1, _id: -1 },
    active: { lastPostAt: -1, _id: -1 },
  };

  const [spaces, total] = await Promise.all([
    Space.find(filter).sort(sorts[sort] || sorts.popular).skip(skip).limit(limit).lean(),
    Space.countDocuments(filter),
  ]);

  res.json({
    spaces: spaces.map(serializeSpaceCard),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

const getSpace = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  res.json({ space: serializeSpace(space, perms) });
});

const getCreationEligibility = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const [ownedCount, totalSpaces, lastOwned] = await Promise.all([
    Space.countDocuments({ owner: req.user._id }),
    Space.estimatedDocumentCount(),
    Space.findOne({ owner: req.user._id }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);
  const gate = await permissions.canCreateSpace(req.user, {
    ownedCount,
    totalSpaces,
    lastCreatedAt: lastOwned ? lastOwned.createdAt : null,
  });
  res.json(gate);
});

const createSpace = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, requiresApproval } = await spaceService.create(req.user, req.body);
  res.status(201).json({
    space: serializeSpace(space),
    requiresApproval,
    message: requiresApproval
      ? 'Your space has been submitted for review'
      : 'Space created',
  });
});

const updateSpace = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageSettings');
  const updated = await spaceService.update(space, req.body, { asAdmin: perms.isAdmin });
  res.json({ space: serializeSpace(updated, perms) });
});

// ---------------------------------------------------------------- settings

const getSpaceSettings = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageSettings');

  const resolved = await permissions.spaceSettings(space);
  const fields = permissions.overridableKeys().map((def) => ({
    ...def,
    value: resolved.get(def.key),
    globalValue: resolved.global(def.key),
    isOverridden: resolved.isOverridden(def.key),
  }));

  res.json({ settings: fields });
});

const updateSpaceSettings = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageSettings');
  const updated = await spaceService.setOverrides(space, req.body, { asAdmin: perms.isAdmin });
  res.json({ overrides: updated.overrides });
});

// -------------------------------------------------------------- membership

const joinSpace = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  if (perms.isBanned) {
    return res.status(403).json({ message: 'You are banned from this space' });
  }
  const member = await spaceService.join(space, req.user);
  return res.json({
    status: member.status,
    pending: member.status === SPACE_MEMBER_STATUS.PENDING,
  });
});

const leaveSpace = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space } = await spaceService.loadForActor(req.params.slug, req.user, req);
  const result = await spaceService.leave(space, req.user);
  res.json(result);
});

const listMembers = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  const { page, limit, skip } = parsePagination(req.query);

  const role = req.query.role;
  const status = req.query.status;

  // The full member list, and anything about bans, is moderator-only. A public
  // member list is a harassment-target list.
  if ((status && status !== SPACE_MEMBER_STATUS.ACTIVE) || role === SPACE_MEMBER_ROLES.MEMBER) {
    deny(perms, 'manageMembers');
  }

  const filter = { space: space._id };
  if (role) filter.role = role;
  filter.status = status || SPACE_MEMBER_STATUS.ACTIVE;

  const [members, total] = await Promise.all([
    SpaceMember.find(filter)
      .populate('user', PUBLIC_USER_FIELDS)
      .sort({ role: 1, joinedAt: 1 })
      .skip(skip)
      .limit(limit),
    SpaceMember.countDocuments(filter),
  ]);

  res.json({ members: members.map(serializeMember), total, page, pages: Math.ceil(total / limit) });
});

const updateMember = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);

  const { action } = req.body;

  if (action === 'ban' || action === 'unban' || action === 'mute') {
    deny(perms, 'manageMembers');
  } else if (action === 'role') {
    deny(perms, 'manageMods');
  } else {
    deny(perms, 'manageMembers');
  }

  const targetId = req.params.userId;

  // A moderator must not be able to act on another moderator — that is how one
  // mod removes the rest and takes a space. Only the owner and admins can.
  const target = await SpaceMember.findOne({ space: space._id, user: targetId });
  if (target && target.isModerator && target.isModerator() && !perms.isOwner && !perms.isAdmin) {
    return res.status(403).json({ message: 'Only the owner can act on another moderator' });
  }

  if (action === 'ban') {
    const member = await spaceService.banMember(space, targetId, {
      reason: req.body.reason,
      durationHours: req.body.durationHours ? Number(req.body.durationHours) : null,
      actor: req.user,
    });
    return res.json({ member: serializeMember(member) });
  }

  if (action === 'unban') {
    return res.json(await spaceService.unbanMember(space, targetId));
  }

  if (action === 'role') {
    const { member } = await spaceService.setMemberRole(space, targetId, {
      role: req.body.role,
      permissions: req.body.permissions,
      actor: req.user,
    });
    return res.json({ member: serializeMember(member) });
  }

  if (action === 'approve') {
    const member = await SpaceMember.findOneAndUpdate(
      { space: space._id, user: targetId, status: SPACE_MEMBER_STATUS.PENDING },
      { $set: { status: SPACE_MEMBER_STATUS.ACTIVE } },
      { new: true }
    );
    if (!member) return res.status(404).json({ message: 'No pending request' });
    return res.json({ member: serializeMember(member) });
  }

  return res.status(400).json({ message: 'Unknown action' });
});

const transferOwnership = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  // Only the owner or an admin. Not a permission a moderator can be granted.
  if (!perms.isOwner && !perms.isAdmin) {
    return res.status(403).json({ message: 'Only the owner can transfer a space' });
  }
  const result = await spaceService.transferOwnership(space, req.body.userId, { actor: req.user });
  return res.json(result);
});

// ------------------------------------------------------------------- rules

const listRules = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space } = await spaceService.loadForActor(req.params.slug, req.user, req);
  res.json({ rules: space.rules });
});

const createRule = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageRules');
  res.status(201).json({ rule: await spaceService.addRule(space, req.body) });
});

const updateRule = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageRules');
  res.json({ rule: await spaceService.updateRule(space, req.params.ruleId, req.body) });
});

const deleteRule = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageRules');
  res.json(await spaceService.removeRule(space, req.params.ruleId));
});

const reorderRules = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageRules');
  res.json({ rules: await spaceService.reorderRules(space, req.body.ruleIds || []) });
});

// ------------------------------------------------------------------ flairs

/**
 * The PUBLIC moderation log.
 *
 * Opt-in per space (`space.publicModlog`, default off) and 404 otherwise —
 * a space that has not chosen to publish its moderation must not leak it
 * through a URL somebody guessed.
 *
 * THREE THINGS ARE WITHHELD, and each for its own reason:
 *
 *   - `note`   — the mod team's internal note. The model already says it is
 *                never rendered in a public log.
 *   - `actor`  — the moderator's identity. Only the ROLE is published. Naming
 *                the person who removed something invites exactly the
 *                harassment a mod log is meant to reduce, and the same
 *                reasoning already governs the Article 17 statements.
 *   - `targetUser` — publishing who was actioned turns a transparency record
 *                into a pillory. The action and the reason are the disclosure;
 *                the person is not.
 */
const listPublicModlog = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const ModAction = require('../models/ModAction');
  const { space } = await spaceService.loadForActor(req.params.slug, req.user, req);

  if (!space.publicModlog) {
    return res.status(404).json({ message: 'This space does not publish a moderation log' });
  }

  const { limit, skip } = parsePagination(req.query, 100);
  const filter = { space: space._id, publiclyVisible: true };

  const [entries, total] = await Promise.all([
    ModAction.find(filter)
      .select('action targetType targetLabel reason ruleId actorRole createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ModAction.countDocuments(filter),
  ]);

  return res.json({
    entries: entries.map((entry) => ({
      id: entry._id,
      action: entry.action,
      targetType: entry.targetType,
      targetLabel: entry.targetLabel,
      reason: entry.reason,
      ruleId: entry.ruleId,
      actorRole: entry.actorRole,
      createdAt: entry.createdAt,
    })),
    total,
  });
});

const listFlairs = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space } = await spaceService.loadForActor(req.params.slug, req.user, req);
  const flairs = await spaceService.listFlairs(space, req.query.kind);
  res.json({ flairs });
});

const createFlair = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  deny(perms, 'manageFlair');
  res.status(201).json({ flair: await spaceService.createFlair(space, req.body) });
});

module.exports = {
  listSpaces,
  getSpace,
  getCreationEligibility,
  createSpace,
  updateSpace,
  getSpaceSettings,
  updateSpaceSettings,
  joinSpace,
  leaveSpace,
  listMembers,
  updateMember,
  transferOwnership,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  listPublicModlog,
  listFlairs,
  createFlair,
  serializeSpace,
  serializeSpaceCard,
};
