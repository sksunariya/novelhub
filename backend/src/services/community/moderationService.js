// Moderation record-keeping.
//
// Every enforcement action goes through `record()`. That single funnel is what
// guarantees three things that are otherwise easy to skip under pressure:
//
//   1. A StatementOfReasons exists for every restriction (DSA Article 17).
//   2. The action appears in the space's own moderation log.
//   3. A site admin's action ALSO appears in the site-wide audit trail.
//
// Skipping any of them is not a missing feature, it is a gap in the record that
// cannot be filled in later.

const StatementOfReasons = require('../../models/StatementOfReasons');
const ModAction = require('../../models/ModAction');
const AdminAuditLog = require('../../models/AdminAuditLog');
const Appeal = require('../../models/Appeal');
const jobDispatcher = require('../jobDispatcher');
const { ROLES } = require('../../config/constants');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const APPEAL_WINDOW_DAYS = 90;

const roleOf = (actor, perms) => {
  if (!actor) return 'system';
  if (actor.role === ROLES.ADMIN) return 'admin';
  if (perms && perms.isOwner) return 'owner';
  if (perms && perms.isModerator) return 'moderator';
  return 'user';
};

/**
 * Find the rule text as it reads now, to freeze into the statement.
 *
 * Frozen because rules get edited. A statement citing "rule 3" that later
 * points at different text is worse than no citation.
 */
const ruleTextFor = (space, ruleId) => {
  if (!space || !ruleId) return '';
  const rule = (space.rules || []).find((r) => r.ruleId === ruleId);
  return rule ? `${rule.title}${rule.description ? ` — ${rule.description}` : ''}` : '';
};

/**
 * Record an enforcement action.
 *
 * @returns {{ statement, modAction }}
 */
const record = async ({
  actor,
  perms = null,
  space,
  action,
  targetType,
  target,
  targetUser,
  restrictionType,
  ground = StatementOfReasons.GROUNDS.TERMS_VIOLATION,
  legalBasis = '',
  ruleId = '',
  reason = '',
  note = '',
  explanation = '',
  automated = false,
  automatedDetail = null,
  detectionMethod = StatementOfReasons.DETECTION.MODERATOR,
  contentSnapshot = null,
  changes = [],
  notify = true,
}) => {
  const actorRole = roleOf(actor, perms);

  const statement = await StatementOfReasons.create({
    affectedUser: targetUser,
    targetType,
    target,
    space: space ? space._id : null,
    restrictionType,
    ground,
    legalBasis,
    ruleId,
    ruleText: ruleTextFor(space, ruleId),
    automated,
    automatedDetail: automatedDetail || undefined,
    detectionMethod,
    // What the person actually reads. Falls back to the reason so a statement
    // is never blank — a blank explanation satisfies nothing.
    explanation: explanation || reason,
    contentSnapshot: contentSnapshot || undefined,
    decidedBy: actor ? actor._id : null,
    decidedByRole: actorRole,
    appealable: true,
    appealDeadline: new Date(Date.now() + APPEAL_WINDOW_DAYS * 86400_000),
  });

  const modAction = await ModAction.create({
    space: space ? space._id : null,
    actor: actor ? actor._id : null,
    actorLabel: actor ? actor.username || actor.email || '' : 'system',
    actorRole,
    action,
    targetType,
    target,
    targetUser,
    reason,
    ruleId,
    note,
    changes,
    statement: statement._id,
  });

  // An admin acting inside a space is recorded in BOTH trails. The space sees
  // that it happened; compliance sees it in the immutable site-wide log.
  if (actorRole === 'admin') {
    await AdminAuditLog.create({
      actor: actor._id,
      actorLabel: actor.username || actor.email || '',
      action: `community.${action}`,
      entity: targetType,
      entityId: String(target),
      changes,
      note: reason,
    });
  }

  if (notify && targetUser) {
    jobDispatcher.enqueue('moderation.notifyStatement', {
      statementId: String(statement._id),
      user: String(targetUser),
    });
  }

  return { statement, modAction };
};

/**
 * File an appeal.
 *
 * Open to the content author against a removal, and to a reporter against a
 * dismissal. A mechanism that only hears authors is half a mechanism.
 */
const appeal = async ({ user, statementId = null, reportId = null, reason, role = 'author' }) => {
  if (!String(reason || '').trim()) throw fail('Say why you are appealing', 400);

  let statement = null;
  if (statementId) {
    statement = await StatementOfReasons.findById(statementId);
    if (!statement) throw fail('Not found', 404);
    if (String(statement.affectedUser) !== String(user._id)) {
      throw fail('That decision was not about you', 403);
    }
    if (!statement.appealable) throw fail('This decision cannot be appealed', 409);
    if (statement.appealDeadline && statement.appealDeadline < new Date()) {
      throw fail('The appeal window for this decision has closed', 409);
    }
  }

  const existing = statement
    ? await Appeal.findOne({ statement: statement._id, appellant: user._id })
    : null;
  if (existing) throw fail('You have already appealed this decision', 409);

  return Appeal.create({
    statement: statement ? statement._id : null,
    report: reportId,
    appellant: user._id,
    appellantRole: role,
    targetType: statement ? statement.targetType : 'post',
    target: statement ? statement.target : reportId,
    space: statement ? statement.space : null,
    reason: String(reason).slice(0, 4000),
    originalDecisionBy: statement ? statement.decidedBy : null,
  });
};

/**
 * Resolve an appeal.
 *
 * Requires a human reviewer, and refuses the person who made the original
 * decision. Without that second rule the mechanism is the same person
 * confirming they were right.
 */
const resolveAppeal = async ({ appealId, reviewer, status, explanation = '', note = '' }) => {
  const record$ = await Appeal.findById(appealId);
  if (!record$) throw fail('Not found', 404);
  if (record$.status !== Appeal.STATUS.OPEN) throw fail('This appeal is already resolved', 409);

  if (!record$.canBeReviewedBy(reviewer)) {
    throw fail('You cannot review an appeal against your own decision', 403);
  }
  if (!Object.values(Appeal.STATUS).includes(status) || status === Appeal.STATUS.OPEN) {
    throw fail('Choose an outcome', 400);
  }
  if (!String(explanation || '').trim()) {
    throw fail('Explain the outcome to the person who appealed', 400);
  }

  record$.status = status;
  record$.reviewedBy = reviewer._id;
  record$.reviewedAt = new Date();
  record$.reviewNote = note;
  record$.outcomeExplanation = explanation;
  await record$.save();

  jobDispatcher.enqueue('moderation.notifyAppealOutcome', {
    appealId: String(record$._id),
    user: String(record$.appellant),
    status,
  });

  return record$;
};

/** The mod log for a space. Public view strips private notes. */
const modLog = async ({ space, isModerator = false, limit = 50, cursor = null }) => {
  const filter = { space: space._id };
  if (!isModerator) filter.publiclyVisible = true;
  if (cursor) filter.createdAt = { $lt: new Date(cursor) };

  const entries = await ModAction.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('actor', 'username avatarUrl')
    .lean();

  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;

  return {
    entries: page.map((entry) => ({
      id: entry._id,
      action: entry.action,
      actor: isModerator ? entry.actor : { username: entry.actorRole },
      actorRole: entry.actorRole,
      targetType: entry.targetType,
      reason: entry.reason,
      ruleId: entry.ruleId,
      // The private note never leaves the server for a public viewer.
      ...(isModerator ? { note: entry.note, target: entry.target } : {}),
      createdAt: entry.createdAt,
    })),
    hasMore,
    cursor: hasMore && page.length ? page[page.length - 1].createdAt.toISOString() : null,
  };
};

module.exports = { record, appeal, resolveAppeal, modLog, ruleTextFor, roleOf, APPEAL_WINDOW_DAYS };
