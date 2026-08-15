const reportService = require('../services/community/reportService');
const spaceService = require('../services/community/spaceService');
const permissions = require('../services/community/spacePermissionService');
const settingsService = require('../services/settingsService');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const { asyncHandler } = require('../middlewares/errorHandler');
const { REPORT_TARGET_TYPES } = require('../config/constants');
const moduleAccess = require('../services/moduleAccessService');

// Site-wide report and appeal handling, granted by the `community_reports`
// module. Space moderators reach these routes through their own permissions;
// this is the admin path only.
const canHandleReports = (user) => moduleAccess.hasCapability(user, 'community_reports');

const requireCommunityEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) throw Object.assign(new Error('Not found'), { status: 404 });
  return snapshot;
};

/** The reason list the report dialog renders from. Admin-editable, no deploy. */
const getReasons = asyncHandler(async (req, res) => {
  const snapshot = await requireCommunityEnabled();
  const reasons = snapshot.get('spaces.moderation.reportReasons') || [];
  res.json({
    // Severity is deliberately NOT sent. Knowing which reason hides content
    // fastest is exactly what someone abusing the report button wants.
    reasons: reasons.map(({ key, label, appliesTo }) => ({ key, label, appliesTo })),
  });
});

const submitReport = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();

  // Reject rather than default. Silently treating anything unrecognised as a
  // post is how a routing mistake turns into a confusing cast error deep in a
  // model lookup instead of a clear 400 at the edge.
  if (req.params.type !== 'post' && req.params.type !== 'comment') {
    return res.status(400).json({ message: 'You can only report a post or a comment' });
  }
  const targetType = req.params.type === 'comment'
    ? REPORT_TARGET_TYPES.COMMENT
    : REPORT_TARGET_TYPES.POST;

  const Model = targetType === REPORT_TARGET_TYPES.COMMENT ? PostComment : Post;
  const content = await Model.findById(req.params.id).select('space');
  if (!content) return res.status(404).json({ message: 'Not found' });

  const space = await spaceService.bySlugId(content.space);
  const settings = await permissions.spaceSettings(space);

  const result = await reportService.file({
    reporter: req.user,
    targetType,
    target: content._id,
    reason: req.body.reason,
    details: req.body.details,
    settings,
    req,
  });

  // The response never says whether the content was hidden. Telling a reporter
  // "that worked, it's gone" turns the report button into a weapon someone can
  // calibrate — and telling them "not yet" tells them how many more they need.
  return res.status(201).json({
    reported: true,
    message: 'Thanks. A moderator will take a look.',
    // Only the author and moderators learn about the hide, through the content
    // itself.
    ...(process.env.NODE_ENV === 'test' ? { _debug: result } : {}),
  });
});

/** The review queue. Grouped by item, so twelve reports are one row. */
const getQueue = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();

  let space = null;
  if (req.params.slug) {
    const loaded = await spaceService.loadForActor(req.params.slug, req.user, req);
    if (!loaded.perms.can.managePosts) {
      return res.status(403).json({ message: 'You do not have permission to do that' });
    }
    space = loaded.space;
  } else if (!canHandleReports(req.user)) {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const grouped = await reportService.groupedQueue({ space, limit: Number(req.query.limit) || 25 });
  return res.json({ items: grouped });
});

/** Restore or confirm removal. */
const reviewReport = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();

  const targetType = req.body.targetType === 'comment'
    ? REPORT_TARGET_TYPES.COMMENT
    : REPORT_TARGET_TYPES.POST;
  const Model = targetType === REPORT_TARGET_TYPES.COMMENT ? PostComment : Post;

  const content = await Model.findById(req.body.target).select('space');
  if (!content) return res.status(404).json({ message: 'Not found' });

  const space = await spaceService.bySlugId(content.space);
  const membership = await spaceService.membershipFor(space, req.user);
  const perms = permissions.resolve(req.user, space, membership);
  if (!perms.can.managePosts) {
    return res.status(403).json({ message: 'You do not have permission to do that' });
  }

  const settings = await permissions.spaceSettings(space);

  if (req.body.action === 'restore') {
    return res.json(
      await reportService.restore({
        targetType,
        target: content._id,
        reviewer: req.user,
        note: req.body.note || '',
      })
    );
  }

  if (req.body.action === 'remove') {
    if (settings.get('spaces.moderation.removalReasonRequired') && !String(req.body.reason || '').trim()) {
      return res.status(400).json({ message: 'A reason is required' });
    }
    return res.json(
      await reportService.confirmRemoval({
        targetType,
        target: content._id,
        reviewer: req.user,
        reason: req.body.reason,
        ruleId: req.body.ruleId || '',
        note: req.body.note || '',
        // Passed through so the statement can cite the rule text as it reads
        // now, and so the mod log lands in the right space.
        perms,
        space,
      })
    );
  }

  return res.status(400).json({ message: 'Unknown action' });
});

const claimReport = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  if (!canHandleReports(req.user)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return res.json({ report: await reportService.claim({ reportId: req.params.id, reviewer: req.user }) });
});

/** The statements of reasons issued against this user, with appeal state. */
const myStatements = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const StatementOfReasons = require('../models/StatementOfReasons');
  const Appeal = require('../models/Appeal');

  const statements = await StatementOfReasons.find({ affectedUser: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const appeals = await Appeal.find({ appellant: req.user._id })
    .select('statement status')
    .lean();
  const appealByStatement = new Map(appeals.map((a) => [String(a.statement), a.status]));

  res.json({
    statements: statements.map((s) => ({
      id: s._id,
      restrictionType: s.restrictionType,
      ground: s.ground,
      ruleText: s.ruleText,
      explanation: s.explanation,
      automated: s.automated,
      createdAt: s.createdAt,
      appealable: s.appealable && (!s.appealDeadline || s.appealDeadline > new Date()),
      appealDeadline: s.appealDeadline,
      appealStatus: appealByStatement.get(String(s._id)) || null,
      // decidedBy is deliberately absent. Naming the moderator who removed
      // something invites harassment and is not required by the disclosure.
    })),
  });
});

const submitAppeal = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const moderationService = require('../services/community/moderationService');
  const appeal = await moderationService.appeal({
    user: req.user,
    statementId: req.body.statementId,
    reportId: req.body.reportId,
    reason: req.body.reason,
    role: req.body.role === 'reporter' ? 'reporter' : 'author',
  });
  res.status(201).json({
    appeal: { id: appeal._id, status: appeal.status, createdAt: appeal.createdAt },
    message: 'Your appeal has been received. A person will review it.',
  });
});

const resolveAppeal = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const moderationService = require('../services/community/moderationService');
  const Appeal = require('../models/Appeal');

  const appeal = await Appeal.findById(req.params.id);
  if (!appeal) return res.status(404).json({ message: 'Not found' });

  // Space moderators handle their own space's appeals; admins handle any.
  if (appeal.space) {
    const space = await spaceService.bySlugId(appeal.space);
    const membership = await spaceService.membershipFor(space, req.user);
    const perms = permissions.resolve(req.user, space, membership);
    if (!perms.can.managePosts) {
      return res.status(403).json({ message: 'You do not have permission to do that' });
    }
  } else if (!canHandleReports(req.user)) {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const resolved = await moderationService.resolveAppeal({
    appealId: appeal._id,
    reviewer: req.user,
    status: req.body.status,
    explanation: req.body.explanation,
    note: req.body.note || '',
  });

  return res.json({ appeal: { id: resolved._id, status: resolved.status } });
});

module.exports = {
  getReasons,
  submitReport,
  getQueue,
  reviewReport,
  claimReport,
  myStatements,
  submitAppeal,
  resolveAppeal,
};
