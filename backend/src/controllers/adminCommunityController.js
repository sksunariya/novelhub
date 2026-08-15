// The admin surface for the community.
//
// THE PRINCIPLE: every moderator capability exists here WITHOUT the membership
// requirement, plus the lifecycle and oversight actions nobody else has. That
// is what "admins control every single thing" means concretely.
//
// Two rules hold throughout:
//
//   1. Every destructive action takes a reason and writes to BOTH trails —
//      the space's own ModAction log and the site-wide AdminAuditLog. A space
//      must be able to see that an admin acted in it; opacity there is how
//      trust in moderation dies.
//   2. The child-safety queue is gated on an ELEVATED PERMISSION, not on being
//      an admin. Being an admin is deliberately not sufficient — that is the
//      entire point of a restricted queue.

const mongoose = require('mongoose');
const Space = require('../models/Space');
const SpaceMember = require('../models/SpaceMember');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const Report = require('../models/Report');
const ModAction = require('../models/ModAction');
const Appeal = require('../models/Appeal');
const StatementOfReasons = require('../models/StatementOfReasons');
const ChildSafetyIncident = require('../models/ChildSafetyIncident');
const MediaAsset = require('../models/MediaAsset');
const AdminAuditLog = require('../models/AdminAuditLog');
const spaceService = require('../services/community/spaceService');
const reportService = require('../services/community/reportService');
const moderationService = require('../services/community/moderationService');
const permissions = require('../services/community/spacePermissionService');
const jobDispatcher = require('../services/jobDispatcher');
const { asyncHandler } = require('../middlewares/errorHandler');
const {
  SPACE_STATUS,
  SPACE_MEMBER_ROLES,
  POST_STATUS,
  REPORT_STATUS,
  PAGINATION,
} = require('../config/constants');

const parsePage = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), PAGINATION.MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
};

/** Admin actions always carry a reason, and always land in both trails. */
const audit = async (req, { action, entity, entityId, changes = [], note = '' }) =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email || '',
    action: `community.${action}`,
    entity,
    entityId: String(entityId),
    changes,
    note,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  });

// ------------------------------------------------------------------ spaces

/**
 * Every space, including private, pending, archived and banned.
 *
 * Deliberately unfiltered by visibility — this is the one view that must show
 * what the public directory hides.
 */
const listSpaces = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { search, status, visibility, topic, flag } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (visibility) filter.visibility = visibility;
  if (topic) filter.topics = topic;
  if (flag === 'featured') filter.featured = true;
  if (flag === 'verified') filter.verified = true;
  if (flag === 'nsfw') filter.nsfw = true;
  if (flag === 'locked') filter.locked = true;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } },
    ];
  }

  const sorts = {
    members: { memberCount: -1 },
    posts: { postCount: -1 },
    new: { createdAt: -1 },
    active: { lastPostAt: -1 },
  };

  const [spaces, total] = await Promise.all([
    Space.find(filter)
      .sort(sorts[req.query.sort] || sorts.members)
      .skip(skip)
      .limit(limit)
      .populate('owner', 'username email avatarUrl')
      .lean(),
    Space.countDocuments(filter),
  ]);

  res.json({ spaces, total, page, pages: Math.ceil(total / limit) });
});

/** One space, with the counts an admin needs before acting on it. */
const getSpace = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id).populate('owner', 'username email avatarUrl');
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const [members, moderators, posts, openReports, mediaBytes] = await Promise.all([
    SpaceMember.countDocuments({ space: space._id, status: 'active' }),
    SpaceMember.find({ space: space._id, role: { $ne: SPACE_MEMBER_ROLES.MEMBER } })
      .populate('user', 'username avatarUrl')
      .lean(),
    Post.countDocuments({ space: space._id }),
    Report.countDocuments({ space: space._id, status: REPORT_STATUS.OPEN }),
    MediaAsset.aggregate([
      { $match: { space: space._id } },
      { $group: { _id: null, bytes: { $sum: '$bytes' } } },
    ]),
  ]);

  return res.json({
    space,
    stats: {
      members,
      posts,
      openReports,
      // Storage cost per space — the reason the S3 layout puts spaceId first.
      mediaBytes: mediaBytes.length ? mediaBytes[0].bytes : 0,
    },
    moderators,
  });
});

/**
 * Update any field, including ones a space owner cannot touch.
 *
 * Still an explicit allowlist. "Admin" is not a reason to spread req.body — a
 * typo would silently write a field that shadows a real one.
 */
const ADMIN_FIELDS = [
  'name', 'tagline', 'nsfw', 'visibility', 'joinPolicy', 'topics', 'language',
  'featured', 'verified', 'locked', 'pinnedGlobally', 'excludeFromAll', 'publicModlog',
];

const updateSpace = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id);
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const changes = [];
  for (const field of ADMIN_FIELDS) {
    if (req.body[field] === undefined) continue;
    if (JSON.stringify(space[field]) === JSON.stringify(req.body[field])) continue;
    changes.push({ key: field, before: space[field], after: req.body[field] });
    space[field] = req.body[field];
  }

  if (!changes.length) return res.json({ space, changed: 0 });

  await space.save();
  await audit(req, {
    action: 'space.update',
    entity: 'space',
    entityId: space._id,
    changes,
    note: req.body.reason || '',
  });
  await moderationService.record({
    actor: req.user,
    perms: { isAdmin: true },
    space,
    action: 'space.settings',
    targetType: 'space',
    target: space._id,
    targetUser: space.owner,
    restrictionType: StatementOfReasons.RESTRICTION_TYPES.FEATURE_RESTRICTED,
    reason: req.body.reason || 'Administrative change',
    changes,
    notify: false,
  });

  return res.json({ space, changed: changes.length });
});

/** Force any setting on a space, including keys not `spaceOverridable`. */
const forceOverrides = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id);
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const before = { ...(space.overrides || {}) };
  const updated = await spaceService.setOverrides(space, req.body.overrides || {}, { asAdmin: true });

  await audit(req, {
    action: 'space.overrides',
    entity: 'space',
    entityId: space._id,
    changes: [{ key: 'overrides', before, after: updated.overrides }],
    note: req.body.reason || '',
  });

  return res.json({ overrides: updated.overrides });
});

/**
 * Lifecycle: approve, quarantine, archive, ban, restore.
 *
 * Quarantine exists as the proportionate step before a ban — hidden from every
 * feed and reachable by direct link with an interstitial, rather than gone.
 */
const LIFECYCLE = {
  approve: SPACE_STATUS.ACTIVE,
  reject: SPACE_STATUS.REJECTED,
  quarantine: SPACE_STATUS.QUARANTINED,
  archive: SPACE_STATUS.ARCHIVED,
  ban: SPACE_STATUS.BANNED,
  restore: SPACE_STATUS.ACTIVE,
};

const setLifecycle = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id);
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const next = LIFECYCLE[req.params.action];
  if (!next) return res.status(400).json({ message: 'Unknown action' });

  // A reason is required for anything punitive. Approving does not need one.
  const punitive = ['reject', 'quarantine', 'ban'].includes(req.params.action);
  if (punitive && !String(req.body.reason || '').trim()) {
    return res.status(400).json({ message: 'A reason is required' });
  }

  const before = space.status;
  space.status = next;
  space.statusReason = req.body.reason || '';
  space.statusChangedBy = req.user._id;
  space.statusChangedAt = new Date();
  if (req.params.action === 'approve' || req.params.action === 'reject') {
    space.reviewedBy = req.user._id;
    space.reviewedAt = new Date();
    space.reviewNote = req.body.note || '';
  }
  await space.save();

  await audit(req, {
    action: `space.${req.params.action}`,
    entity: 'space',
    entityId: space._id,
    changes: [{ key: 'status', before, after: next }],
    note: req.body.reason || '',
  });

  await moderationService.record({
    actor: req.user,
    perms: { isAdmin: true },
    space,
    action: `space.${req.params.action}`,
    targetType: 'space',
    target: space._id,
    targetUser: space.owner,
    restrictionType: StatementOfReasons.RESTRICTION_TYPES.SPACE_BANNED,
    ground: StatementOfReasons.GROUNDS.TERMS_VIOLATION,
    reason: req.body.reason || '',
    explanation: req.body.explanation || req.body.reason || '',
    notify: punitive,
  });

  return res.json({ space });
});

/** Transfer ownership. Not a permission a moderator can be granted. */
const transferSpace = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id);
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const result = await spaceService.transferOwnership(space, req.body.userId, { actor: req.user });
  await audit(req, {
    action: 'space.transfer',
    entity: 'space',
    entityId: space._id,
    changes: [{ key: 'owner', before: result.from, after: result.to }],
    note: req.body.reason || '',
  });
  return res.json(result);
});

/** Install or remove a moderator, bypassing the space's own mod permissions. */
const setModerator = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id);
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const { member } = await spaceService.setMemberRole(space, req.body.userId, {
    role: req.body.role,
    permissions: req.body.permissions,
    actor: req.user,
  });

  await audit(req, {
    action: 'space.setModerator',
    entity: 'spaceMember',
    entityId: member._id,
    changes: [{ key: 'role', before: null, after: req.body.role }],
    note: req.body.reason || '',
  });
  return res.json({ member });
});

/** Rebuild every denormalized counter for a space from source. */
const recountSpace = asyncHandler(async (req, res) => {
  const space = await Space.findById(req.params.id);
  if (!space) return res.status(404).json({ message: 'Space not found' });

  const [members, posts] = await Promise.all([
    SpaceMember.countDocuments({ space: space._id, status: 'active' }),
    Post.countDocuments({ space: space._id, status: POST_STATUS.PUBLISHED }),
  ]);

  const changes = [
    { key: 'memberCount', before: space.memberCount, after: members },
    { key: 'postCount', before: space.postCount, after: posts },
  ];

  space.memberCount = members;
  space.postCount = posts;
  await space.save();

  await audit(req, { action: 'space.recount', entity: 'space', entityId: space._id, changes });
  return res.json({ memberCount: members, postCount: posts, changes });
});

// ------------------------------------------------------------------- posts

/** Every post on the site, filterable on everything the queue needs. */
const listPosts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { space, author, type, status, search, minScore, minReports, from, to } = req.query;

  const filter = {};
  if (space && mongoose.isValidObjectId(space)) filter.space = space;
  if (author && mongoose.isValidObjectId(author)) filter.author = author;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (minScore) filter.score = { $gte: Number(minScore) };
  if (minReports) filter.reportCount = { $gte: Number(minReports) };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }
  if (search) filter.$text = { $search: search };

  const [posts, total] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('space', 'slug name')
      .populate('author', 'username avatarUrl')
      .lean(),
    Post.countDocuments(filter),
  ]);

  res.json({ posts, total, page, pages: Math.ceil(total / limit) });
});

/**
 * Bulk actions.
 *
 * Capped, because an unbounded bulk endpoint is one mis-click from actioning
 * the whole site, and the audit entry would be useless.
 */
const BULK_LIMIT = 200;

const bulkPosts = asyncHandler(async (req, res) => {
  const ids = (req.body.ids || []).filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return res.status(400).json({ message: 'Nothing selected' });
  if (ids.length > BULK_LIMIT) {
    return res.status(400).json({ message: `Select at most ${BULK_LIMIT} at a time` });
  }

  const { action, reason = '' } = req.body;
  const punitive = ['remove', 'delete'].includes(action);
  if (punitive && !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required' });
  }

  const updates = {
    remove: {
      status: POST_STATUS.REMOVED,
      'removal.by': req.user._id,
      'removal.byRole': 'admin',
      'removal.reason': reason,
      'removal.at': new Date(),
    },
    restore: { status: POST_STATUS.PUBLISHED },
    approve: { status: POST_STATUS.PUBLISHED },
    lock: { locked: true },
    unlock: { locked: false },
    nsfw: { nsfw: true },
    sfw: { nsfw: false },
    spoiler: { spoiler: true },
    unspoiler: { spoiler: false },
    pinGlobally: { pinnedGlobally: true },
    unpinGlobally: { pinnedGlobally: false },
  };

  if (!updates[action]) return res.status(400).json({ message: 'Unknown action' });

  const result = await Post.updateMany({ _id: { $in: ids } }, { $set: updates[action] });

  await audit(req, {
    action: `posts.bulk.${action}`,
    entity: 'post',
    entityId: `${ids.length} posts`,
    changes: ids.map((id) => ({ key: String(id), before: null, after: action })),
    note: reason,
  });

  return res.json({ matched: result.matchedCount, modified: result.modifiedCount });
});

// ----------------------------------------------------------------- reports

const listReports = asyncHandler(async (req, res) => {
  const grouped = await reportService.groupedQueue({
    space: req.query.space ? { _id: req.query.space } : null,
    limit: Number(req.query.limit) || 50,
  });
  res.json({ items: grouped });
});

const reportDetail = asyncHandler(async (req, res) => {
  const { targetType, target } = req.query;
  if (!mongoose.isValidObjectId(target)) return res.status(400).json({ message: 'Invalid target' });

  const Model = targetType === 'comment' ? PostComment : Post;

  const [reports, content] = await Promise.all([
    Report.find({ targetType, target })
      .sort({ severity: -1, createdAt: -1 })
      .populate('reporter', 'username karma trustedFlagger createdAt')
      .lean(),
    Model.findById(target).populate('author', 'username karma strikes createdAt').lean(),
  ]);

  // The author's history is what a reviewer actually needs, and gathering it
  // per-row in the queue would be an N+1.
  const authorId = content ? content.author && content.author._id : null;
  const [priorRemovals, priorReports, reportsFiled] = authorId
    ? await Promise.all([
        Post.countDocuments({ author: authorId, status: POST_STATUS.REMOVED }),
        Report.countDocuments({ contentAuthor: authorId }),
        // Reports this person has FILED — surfaces report-brigading.
        Report.countDocuments({ reporter: authorId }),
      ])
    : [0, 0, 0];

  return res.json({
    reports,
    content,
    authorHistory: { priorRemovals, priorReports, reportsFiled },
  });
});

// ------------------------------------------------------------------ modlog

const listModActions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.space && mongoose.isValidObjectId(req.query.space)) filter.space = req.query.space;
  if (req.query.actor && mongoose.isValidObjectId(req.query.actor)) filter.actor = req.query.actor;
  if (req.query.action) filter.action = req.query.action;
  // The filter that answers "is a moderator abusing their space".
  if (req.query.actorRole) filter.actorRole = req.query.actorRole;

  const [entries, total] = await Promise.all([
    ModAction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actor', 'username avatarUrl')
      .populate('space', 'slug name')
      .lean(),
    ModAction.countDocuments(filter),
  ]);

  res.json({ entries, total, page, pages: Math.ceil(total / limit) });
});

// ----------------------------------------------------------------- appeals

const listAppeals = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = { status: req.query.status || Appeal.STATUS.OPEN };

  const [appeals, total] = await Promise.all([
    // Oldest first. Someone waiting three weeks should not sit behind someone
    // who appealed this morning.
    Appeal.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('appellant', 'username avatarUrl')
      .populate('statement')
      .lean(),
    Appeal.countDocuments(filter),
  ]);

  res.json({ appeals, total, page, pages: Math.ceil(total / limit) });
});

// ----------------------------------------------------- transparency report

/**
 * The figures a DSA transparency report is built from.
 *
 * Aggregated from StatementOfReasons rather than counted ad hoc, which is the
 * entire reason those are structured records.
 */
const transparencyReport = asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 90 * 86400_000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const range = { createdAt: { $gte: from, $lte: to } };

  const [byGround, byRestriction, byDetection, automated, appeals, medianHours] = await Promise.all([
    StatementOfReasons.aggregate([{ $match: range }, { $group: { _id: '$ground', count: { $sum: 1 } } }]),
    StatementOfReasons.aggregate([{ $match: range }, { $group: { _id: '$restrictionType', count: { $sum: 1 } } }]),
    StatementOfReasons.aggregate([{ $match: range }, { $group: { _id: '$detectionMethod', count: { $sum: 1 } } }]),
    StatementOfReasons.countDocuments({ ...range, automated: true }),
    Appeal.aggregate([{ $match: range }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Report.aggregate([
      { $match: { ...range, handledAt: { $ne: null } } },
      { $project: { hours: { $divide: [{ $subtract: ['$handledAt', '$createdAt'] }, 3600000] } } },
      { $group: { _id: null, avg: { $avg: '$hours' } } },
    ]),
  ]);

  const totalStatements = await StatementOfReasons.countDocuments(range);

  res.json({
    period: { from, to },
    totalRestrictions: totalStatements,
    byGround,
    byRestriction,
    byDetection,
    automatedCount: automated,
    automatedShare: totalStatements ? automated / totalStatements : 0,
    appeals,
    avgResolutionHours: medianHours.length ? Math.round(medianHours[0].avg * 10) / 10 : null,
  });
});

// ----------------------------------------------- child safety (restricted)

/**
 * The restricted queue.
 *
 * Reachable only with the CHILD_SAFETY elevated permission. `requireElevated`
 * enforces that on the route; being an admin is deliberately not sufficient.
 *
 * Content is NEVER returned inline — only metadata and the storage key. A
 * reviewer requests a short-lived presigned URL as a separate, logged action.
 */
const listIncidents = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [incidents, total] = await Promise.all([
    ChildSafetyIncident.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-storageKey')
      .populate('uploader', 'username email createdAt')
      .lean(),
    ChildSafetyIncident.countDocuments(filter),
  ]);

  await audit(req, {
    action: 'safety.queueViewed',
    entity: 'childSafetyIncident',
    entityId: 'queue',
    note: `viewed ${incidents.length} incidents`,
  });

  res.json({ incidents, total, page, pages: Math.ceil(total / limit) });
});

/**
 * Record a review outcome. Never deletes — the record and the material are
 * preserved regardless of the verdict.
 */
const reviewIncident = asyncHandler(async (req, res) => {
  const incident = await ChildSafetyIncident.findById(req.params.id);
  if (!incident) return res.status(404).json({ message: 'Not found' });

  const { status, note = '', reportReference = '' } = req.body;
  if (!Object.values(ChildSafetyIncident.STATUS).includes(status)) {
    return res.status(400).json({ message: 'Unknown status' });
  }

  incident.status = status;
  incident.reviewedBy = req.user._id;
  incident.reviewedAt = new Date();
  incident.reviewNote = note;
  if (status === ChildSafetyIncident.STATUS.REPORTED) {
    incident.reportedAt = new Date();
    incident.reportedBy = req.user._id;
    incident.reportReference = reportReference;
  }
  await incident.save();

  await audit(req, {
    action: 'safety.incidentReviewed',
    entity: 'childSafetyIncident',
    entityId: incident._id,
    changes: [{ key: 'status', before: null, after: status }],
    note,
  });

  return res.json({ incident: { id: incident._id, status: incident.status } });
});

// ------------------------------------------------------------------- users

/** Everything about one user's community activity, for a moderation decision. */
const userDetail = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ message: 'Invalid id' });

  const [posts, comments, owned, moderating, joined, reportsAgainst, reportsFiled, removals, statements] =
    await Promise.all([
      Post.countDocuments({ author: userId }),
      PostComment.countDocuments({ author: userId }),
      Space.find({ owner: userId }).select('slug name status').lean(),
      SpaceMember.find({ user: userId, role: SPACE_MEMBER_ROLES.MODERATOR })
        .populate('space', 'slug name')
        .lean(),
      SpaceMember.countDocuments({ user: userId, status: 'active' }),
      Report.countDocuments({ contentAuthor: userId }),
      Report.countDocuments({ reporter: userId }),
      Post.countDocuments({ author: userId, status: POST_STATUS.REMOVED }),
      StatementOfReasons.find({ affectedUser: userId }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

  return res.json({
    activity: { posts, comments, joined },
    owned,
    moderating: moderating.map((m) => m.space),
    moderation: { reportsAgainst, reportsFiled, removals },
    statements,
  });
});

/** Site-wide community ban. Distinct from suspending the whole account. */
const setCommunityBan = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const { banned, reason = '', durationDays = null } = req.body;
  if (banned && !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required' });
  }

  const before = user.communityBannedUntil;
  user.communityBannedUntil = banned
    ? durationDays
      ? new Date(Date.now() + durationDays * 86400_000)
      : new Date('2999-12-31')
    : null;
  user.communityBanReason = banned ? reason : '';
  await user.save();

  await audit(req, {
    action: banned ? 'user.communityBan' : 'user.communityUnban',
    entity: 'user',
    entityId: user._id,
    changes: [{ key: 'communityBannedUntil', before, after: user.communityBannedUntil }],
    note: reason,
  });

  if (banned) {
    await moderationService.record({
      actor: req.user,
      perms: { isAdmin: true },
      space: null,
      action: 'user.communityBan',
      targetType: 'user',
      target: user._id,
      targetUser: user._id,
      restrictionType: StatementOfReasons.RESTRICTION_TYPES.ACCOUNT_SUSPENDED,
      reason,
      explanation: req.body.explanation || reason,
    });
  }

  return res.json({ communityBannedUntil: user.communityBannedUntil });
});

/** Grant or revoke space-creation rights for one person. */
const setSpaceCreationPolicy = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const { policy, reason = '' } = req.body;
  if (!['default', 'always', 'never'].includes(policy)) {
    return res.status(400).json({ message: 'Unknown policy' });
  }
  if (policy !== 'default' && !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required' });
  }

  const before = user.spaceCreation ? user.spaceCreation.policy : 'default';
  user.spaceCreation = { policy, reason, setBy: req.user._id, setAt: new Date() };
  await user.save();

  await audit(req, {
    action: 'user.spaceCreationPolicy',
    entity: 'user',
    entityId: user._id,
    changes: [{ key: 'spaceCreation.policy', before, after: policy }],
    note: reason,
  });

  return res.json({ spaceCreation: user.spaceCreation });
});

/** Manual karma adjustment, always audited. */
const adjustKarma = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ message: 'Enter an amount' });
  }
  if (!String(req.body.reason || '').trim()) {
    return res.status(400).json({ message: 'A reason is required' });
  }

  const before = user.karma ? user.karma.total : 0;
  user.karma.awarded = (user.karma.awarded || 0) + amount;
  user.karma.total = (user.karma.total || 0) + amount;
  await user.save();

  await audit(req, {
    action: 'user.karmaAdjust',
    entity: 'user',
    entityId: user._id,
    changes: [{ key: 'karma.total', before, after: user.karma.total }],
    note: req.body.reason,
  });

  return res.json({ karma: user.karma });
});

// --------------------------------------------------------------- insights

const insights = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400_000);

  const [spaces, activeSpaces, posts, comments, reports, pendingSpaces, openAppeals, topSpaces] =
    await Promise.all([
      Space.countDocuments({ status: SPACE_STATUS.ACTIVE }),
      Space.countDocuments({ status: SPACE_STATUS.ACTIVE, lastPostAt: { $gte: since } }),
      Post.countDocuments({ createdAt: { $gte: since } }),
      PostComment.countDocuments({ createdAt: { $gte: since } }),
      Report.countDocuments({ status: REPORT_STATUS.OPEN }),
      Space.countDocuments({ status: SPACE_STATUS.PENDING }),
      Appeal.countDocuments({ status: Appeal.STATUS.OPEN }),
      Space.find({ status: SPACE_STATUS.ACTIVE })
        .sort({ memberCount: -1 })
        .limit(10)
        .select('slug name memberCount postCount')
        .lean(),
    ]);

  res.json({
    totals: { spaces, activeSpaces, posts30d: posts, comments30d: comments },
    queues: { openReports: reports, pendingSpaces, openAppeals },
    topSpaces,
  });
});

/** Trigger a rebuild. Exposed so drift is fixable without a shell. */
const rebuild = asyncHandler(async (req, res) => {
  const { target } = req.body;
  const jobs = {
    counters: 'community.recount',
    karma: 'community.karmaRecompute',
    media: 'media.sweepOrphans',
  };
  if (!jobs[target]) return res.status(400).json({ message: 'Unknown rebuild target' });

  await audit(req, { action: `rebuild.${target}`, entity: 'system', entityId: target });
  jobDispatcher.enqueue(jobs[target], {});
  return res.json({ started: true, job: jobs[target] });
});

module.exports = {
  listSpaces,
  getSpace,
  updateSpace,
  forceOverrides,
  setLifecycle,
  transferSpace,
  setModerator,
  recountSpace,
  listPosts,
  bulkPosts,
  listReports,
  reportDetail,
  listModActions,
  listAppeals,
  transparencyReport,
  listIncidents,
  reviewIncident,
  userDetail,
  setCommunityBan,
  setSpaceCreationPolicy,
  adjustKarma,
  insights,
  rebuild,
  ADMIN_FIELDS,
  BULK_LIMIT,
};
