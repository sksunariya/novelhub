// Report handling, threshold auto-hide, and review.
//
// THE FLOW:
//
//   report ──→ dedupe by reporter ──→ compute effective weight
//                                       │
//                                       ├─ severity 5 → hide on the FIRST
//                                       │   report, escalate to the restricted
//                                       │   safety queue, notify nobody else
//                                       │
//                                       ├─ weight ≥ threshold → hide, queue for
//                                       │   review
//                                       │
//                                       └─ below threshold → stays visible,
//                                           report sits in the queue
//
//   review ──→ restore (published) or remove (removed), author told either way
//
// WHY DISTINCT REPORTERS AND NOT A COUNT: one person reporting five times must
// not hide anything. The unique index on { targetType, target, reporter } is the
// enforcement; this file just counts what survives it.
//
// WHY SEVERITY WEIGHTS: "off topic" and "content involving a minor" cannot
// share a threshold. For the most severe reasons the delay IS the harm, so
// those hide immediately rather than waiting for a quorum.
//
// WHY HIDDEN RATHER THAN REMOVED: hiding is reversible and honest. The author
// still sees their content with an explanation, the reviewer sees it in
// context, and a false positive costs an hour of visibility rather than a
// permanent deletion and an appeal.

const Report = require('../../models/Report');
const Post = require('../../models/Post');
const PostComment = require('../../models/PostComment');
const counterService = require('../counterService');
const jobDispatcher = require('../jobDispatcher');
const classificationService = require('../classificationService');
const {
  REPORT_TARGET_TYPES,
  REPORT_STATUS,
  REPORT_SOURCES,
  POST_STATUS,
} = require('../../config/constants');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const MODEL_FOR = {
  [REPORT_TARGET_TYPES.POST]: () => Post,
  [REPORT_TARGET_TYPES.COMMENT]: () => PostComment,
};

/**
 * Severity 5 hides on the first report and escalates.
 *
 * The reasons that carry it — minor safety, credible threats — are ones where
 * waiting for a quorum means the content stays up while people see it, and
 * where being wrong costs an hour of one person's visibility rather than real
 * harm. That trade is worth making in one direction only.
 */
const INSTANT_HIDE_SEVERITY = 5;

/** Reasons that go to the restricted safety queue, not ordinary moderation. */
const SAFETY_ESCALATION_REASONS = new Set(['minor_safety', 'sexual_minors']);

const severityFor = (reasonKey, reasons) => {
  const match = (reasons || []).find((r) => r.key === reasonKey);
  return match && match.severity ? Number(match.severity) : 1;
};

/**
 * A reporter's weight.
 *
 * A trusted flagger counts for more, and a user whose reports are routinely
 * dismissed counts for less — otherwise one determined person with several
 * accounts can hide anything, and the honest majority is drowned out.
 * Deliberately bounded: no single reporter can ever cross the threshold alone
 * unless the severity says so.
 */
const reporterWeight = (reporter) => {
  if (!reporter) return 1;
  if (reporter.trustedFlagger) return 3;
  const karma = (reporter.karma && reporter.karma.total) || 0;
  if (karma < 0) return 0.5;
  return 1;
};

/**
 * File a report.
 *
 * Idempotent per reporter: reporting twice updates the existing row rather than
 * creating a second one, so the distinct count cannot be inflated.
 */
const file = async ({ reporter, targetType, target, reason, details = '', settings, req = null }) => {
  const getModel = MODEL_FOR[targetType];
  if (!getModel) throw fail('That cannot be reported', 400);

  const Model = getModel();
  const content = await Model.findById(target);
  if (!content) throw fail('Not found', 404);

  // Reporting your own content is almost always a mistake or a test.
  if (reporter && String(content.author) === String(reporter._id)) {
    throw fail('You cannot report your own content', 400);
  }

  const reasons = settings.get('spaces.moderation.reportReasons');
  const known = (reasons || []).some((r) => r.key === reason);
  if (!known) throw fail('Choose a reason', 400);

  const severity = severityFor(reason, reasons);

  // Snapshot BEFORE anything else. An edit after the report must not leave the
  // reviewer looking at innocuous content and dismissing it.
  const snapshot = {
    title: content.title || '',
    body: content.body || content.bodyText || '',
    mediaUrls: (content.media || []).map((m) => m.url).filter(Boolean),
    capturedAt: new Date(),
  };

  const report = await Report.findOneAndUpdate(
    { targetType, target, reporter: reporter ? reporter._id : null },
    {
      $set: {
        space: content.space,
        contentAuthor: content.author,
        reason,
        severity,
        details: String(details || '').slice(0, 2000),
        status: REPORT_STATUS.OPEN,
        reporterType: reporter && reporter.trustedFlagger ? 'trusted_flagger' : 'user',
        source: REPORT_SOURCES.USER,
        snapshot,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );

  await counterService.increment(
    targetType === REPORT_TARGET_TYPES.POST ? 'post' : 'comment',
    target,
    { reportCount: 1 }
  );

  const evaluation = await evaluate({ targetType, target, content, settings, severity, reason });

  return { report, ...evaluation };
};

/**
 * Decide whether the accumulated reports warrant hiding.
 *
 * Pure decision, separate from filing, so it can be re-run after a report is
 * dismissed — restoring content whose remaining reports no longer meet the
 * threshold.
 */
const evaluate = async ({ targetType, target, content, settings, severity = 1, reason = '' }) => {
  const threshold = settings.get('spaces.moderation.autoHideReports');

  // Severity 5 does not wait for a quorum. For these the delay is the harm.
  if (severity >= INSTANT_HIDE_SEVERITY) {
    await hide({ targetType, target, content, reason: 'severity' });
    const escalated = SAFETY_ESCALATION_REASONS.has(reason);
    if (escalated) {
      jobDispatcher.enqueue('safety.escalate', {
        targetType,
        target: String(target),
        reason,
      });
    }
    return { hidden: true, escalated, trigger: 'severity' };
  }

  if (!threshold) return { hidden: false, trigger: null };

  // Weighted, but counted over DISTINCT reporters.
  const reports = await Report.find({
    targetType,
    target,
    status: REPORT_STATUS.OPEN,
  })
    .populate('reporter', 'trustedFlagger karma')
    .select('reporter severity')
    .lean();

  const seen = new Set();
  let weight = 0;
  for (const report of reports) {
    const key = report.reporter ? String(report.reporter._id) : `anon:${report._id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    weight += reporterWeight(report.reporter);
  }

  if (weight >= threshold) {
    await hide({ targetType, target, content, reason: 'threshold' });
    return { hidden: true, escalated: false, trigger: 'threshold', weight };
  }

  return { hidden: false, trigger: null, weight, threshold };
};

/**
 * Hide content pending review.
 *
 * `hidden` is deliberately NOT `removed`. Hidden is automatic, reversible, and
 * carries no accusation — the author still sees their content with an
 * explanation. Removed is a human decision with a reason attached.
 */
const hide = async ({ targetType, target, content, reason }) => {
  if (content && content.status !== POST_STATUS.PUBLISHED) return { alreadyHidden: true };

  const Model = MODEL_FOR[targetType]();
  await Model.updateOne(
    { _id: target, status: POST_STATUS.PUBLISHED },
    {
      $set: {
        status: POST_STATUS.HIDDEN,
        'removal.reason': reason === 'severity' ? 'auto_hidden_severity' : 'auto_hidden_reports',
        'removal.byRole': 'system',
        'removal.at': new Date(),
      },
    }
  );

  // The author is told immediately, and told it is pending review rather than
  // decided. Silent disappearance is the single biggest driver of "why did my
  // post vanish" support load.
  if (content && content.author) {
    jobDispatcher.enqueue('moderation.notifyHidden', {
      targetType,
      target: String(target),
      author: String(content.author),
      reason,
    });
  }

  return { hidden: true };
};

/**
 * Review outcome: restore.
 *
 * Every open report on the item is dismissed, the content goes back to
 * published, and the author is told. The reports are kept — a pattern of
 * dismissed reports from one person is itself a signal.
 */
const restore = async ({ targetType, target, reviewer, note = '' }) => {
  const Model = MODEL_FOR[targetType]();
  const content = await Model.findById(target);
  if (!content) throw fail('Not found', 404);

  await Model.updateOne(
    { _id: target },
    {
      $set: { status: POST_STATUS.PUBLISHED },
      $unset: { 'removal.reason': '', 'removal.byRole': '', 'removal.at': '' },
    }
  );

  await Report.updateMany(
    { targetType, target, status: REPORT_STATUS.OPEN },
    {
      $set: {
        status: REPORT_STATUS.DISMISSED,
        outcome: 'restored',
        handledBy: reviewer._id,
        handledAt: new Date(),
        resolution: note,
      },
    }
  );

  jobDispatcher.enqueue('moderation.notifyRestored', {
    targetType,
    target: String(target),
    author: String(content.author),
  });

  return { restored: true };
};

/**
 * Review outcome: confirm the removal.
 *
 * Produces a StatementOfReasons and a ModAction before touching the content.
 * That ordering is deliberate — if the record fails to write, the removal does
 * not happen, rather than content disappearing with no documentation of why.
 */
const confirmRemoval = async ({
  targetType, target, reviewer, reason, ruleId = '', note = '', perms = null, space = null,
}) => {
  const Model = MODEL_FOR[targetType]();
  const content = await Model.findById(target);
  if (!content) throw fail('Not found', 404);

  // eslint-disable-next-line global-require
  const moderationService = require('./moderationService');
  // eslint-disable-next-line global-require
  const StatementOfReasons = require('../../models/StatementOfReasons');

  await moderationService.record({
    actor: reviewer,
    perms,
    space,
    action: `${targetType}.remove`,
    targetType,
    target,
    targetUser: content.author,
    restrictionType: StatementOfReasons.RESTRICTION_TYPES.CONTENT_REMOVED,
    ruleId,
    reason,
    note,
    detectionMethod: StatementOfReasons.DETECTION.USER_REPORT,
    contentSnapshot: {
      title: content.title || '',
      body: content.body || content.bodyText || '',
      capturedAt: new Date(),
    },
  });

  await Model.updateOne(
    { _id: target },
    {
      $set: {
        status: POST_STATUS.REMOVED,
        'removal.by': reviewer._id,
        'removal.byRole': reviewer.role === 'admin' ? 'admin' : 'moderator',
        'removal.reason': reason,
        'removal.ruleId': ruleId,
        'removal.note': note,
        'removal.at': new Date(),
      },
    }
  );

  await Report.updateMany(
    { targetType, target, status: REPORT_STATUS.OPEN },
    {
      $set: {
        status: REPORT_STATUS.ACTIONED,
        outcome: 'removed',
        handledBy: reviewer._id,
        handledAt: new Date(),
        resolution: note,
      },
    }
  );

  jobDispatcher.enqueue('moderation.notifyRemoved', {
    targetType,
    target: String(target),
    author: String(content.author),
    reason,
    ruleId,
  });

  return { removed: true };
};

/**
 * Claim a report for review.
 *
 * Two moderators opening the same queue must not both action the same item. The
 * conditional update makes the claim atomic; a stale claim expires so an item
 * cannot be locked forever by someone who closed their tab.
 */
const claim = async ({ reportId, reviewer, staleAfterMinutes = 15 }) => {
  const staleBefore = new Date(Date.now() - staleAfterMinutes * 60000);
  const claimed = await Report.findOneAndUpdate(
    {
      _id: reportId,
      status: REPORT_STATUS.OPEN,
      $or: [{ claimedBy: null }, { claimedAt: { $lt: staleBefore } }, { claimedBy: reviewer._id }],
    },
    { $set: { claimedBy: reviewer._id, claimedAt: new Date() } },
    { new: true }
  );
  if (!claimed) throw fail('Someone else is reviewing this', 409);
  return claimed;
};

/** The review queue for one space, or site-wide for an admin. */
const queue = async ({ space = null, status = REPORT_STATUS.OPEN, limit = 25, cursor = null }) => {
  const filter = { status };
  if (space) filter.space = space._id;
  if (cursor) filter.createdAt = { $lt: new Date(cursor) };

  const reports = await Report.find(filter)
    .sort({ severity: -1, createdAt: -1 })
    .limit(limit + 1)
    .populate('reporter', 'username avatarUrl karma trustedFlagger')
    .populate('contentAuthor', 'username avatarUrl karma strikes')
    .lean();

  const hasMore = reports.length > limit;
  const page = hasMore ? reports.slice(0, limit) : reports;

  return {
    reports: page,
    hasMore,
    cursor: hasMore && page.length ? page[page.length - 1].createdAt.toISOString() : null,
  };
};

/**
 * Group open reports by the item they target.
 *
 * A post with twelve reports should be one row in the queue, not twelve. This
 * is what makes the queue clearable.
 */
const groupedQueue = async ({ space = null, limit = 25 }) => {
  const match = { status: REPORT_STATUS.OPEN };
  if (space) match.space = space._id;

  return Report.aggregate([
    { $match: match },
    {
      $group: {
        _id: { targetType: '$targetType', target: '$target' },
        reportCount: { $sum: 1 },
        peakSeverity: { $max: '$severity' },
        reasons: { $addToSet: '$reason' },
        firstReportedAt: { $min: '$createdAt' },
        lastReportedAt: { $max: '$createdAt' },
        contentAuthor: { $first: '$contentAuthor' },
        space: { $first: '$space' },
        snapshot: { $first: '$snapshot' },
      },
    },
    { $sort: { peakSeverity: -1, reportCount: -1, lastReportedAt: -1 } },
    { $limit: limit },
  ]);
};

/** Run the classifier and attach its scores. Registered as a dispatched job. */
const registerJobs = (dispatcher) => {
  dispatcher.register('report.classify', async ({ reportId }) => {
    const report = await Report.findById(reportId);
    if (!report) return { skipped: true };
    const result = await classificationService.classify(report.snapshot.body || '');
    if (!result.available) return { skipped: true };
    await Report.updateOne({ _id: reportId }, { $set: { classificationScores: result.scores } });
    return { classified: true, action: result.action };
  });
};

module.exports = {
  file,
  evaluate,
  hide,
  restore,
  confirmRemoval,
  claim,
  queue,
  groupedQueue,
  reporterWeight,
  severityFor,
  registerJobs,
  INSTANT_HIDE_SEVERITY,
  SAFETY_ESCALATION_REASONS,
};
