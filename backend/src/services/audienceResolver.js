// Audience resolution.
//
// Turns a declarative rule into a Mongo pipeline. `count` is deliberately
// separate from `stream` so the admin form can show "this will target 12,483
// users" live as it is edited, without loading any of them.
//
// Every rule is a JSON document, so new targeting options are a field here plus
// a control in the portal — not a code path per campaign.

const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const ChapterRead = require('../models/ChapterRead');
const ChapterAccess = require('../models/ChapterAccess');
const Comment = require('../models/Comment');
const Review = require('../models/Review');
const CreditTransaction = require('../models/CreditTransaction');

const oid = (value) => new mongoose.Types.ObjectId(String(value));
const oids = (values) => (values || []).map(oid);

const AUDIENCE_MODES = {
  ALL: 'all',
  ROLE: 'role',
  SPECIFIC: 'specific',
  CSV_EMAILS: 'csv_emails',
  QUERY: 'query',
};

const ORDER_BY = {
  createdAt: { createdAt: -1 },
  lastActive: { lastActiveAt: -1 },
  lifetimeSpend: { _spend: -1 },
  random: null, // handled with $sample
};

/**
 * Which of these filters need a join?
 *
 * Checked up front so a simple "everyone" campaign stays a plain find and only
 * pays for the lookups it actually uses.
 */
const needsWallet = (q, rule = {}) =>
  q.balanceAbove !== undefined ||
  q.balanceBelow !== undefined ||
  q.minLifetimeSpendUsdCents !== undefined ||
  q.maxLifetimeSpendUsdCents !== undefined ||
  q.hasEverPurchased !== undefined ||
  // Sorting by spend needs the same join, even with no wallet filter applied.
  rule.orderBy === 'lifetimeSpend';

const buildBaseMatch = (rule) => {
  // Banned and deleted users are excluded unconditionally — never a rule option.
  const match = { banned: false, deletedAt: null };

  if (rule.mode === AUDIENCE_MODES.ROLE && rule.role) match.role = rule.role;
  if (rule.mode === AUDIENCE_MODES.SPECIFIC) match._id = { $in: oids(rule.userIds) };
  if (rule.mode === AUDIENCE_MODES.CSV_EMAILS) {
    match.email = { $in: (rule.emails || []).map((email) => String(email).toLowerCase().trim()) };
  }
  if (rule.excludeUserIds && rule.excludeUserIds.length) {
    match._id = { ...(match._id || {}), $nin: oids(rule.excludeUserIds) };
  }

  const q = rule.query || {};
  if (rule.mode === AUDIENCE_MODES.QUERY) {
    if (q.registeredAfter) match.createdAt = { ...(match.createdAt || {}), $gte: new Date(q.registeredAfter) };
    if (q.registeredBefore) match.createdAt = { ...(match.createdAt || {}), $lte: new Date(q.registeredBefore) };
    if (q.lastActiveAfter) match.lastActiveAt = { ...(match.lastActiveAt || {}), $gte: new Date(q.lastActiveAfter) };
    if (q.lastActiveBefore) match.lastActiveAt = { ...(match.lastActiveAt || {}), $lte: new Date(q.lastActiveBefore) };
    if (q.inactiveForDays) {
      // Win-back: nothing since this date, including never-active accounts.
      const cutoff = new Date(Date.now() - q.inactiveForDays * 24 * 3600 * 1000);
      match.$or = [{ lastActiveAt: { $lte: cutoff } }, { lastActiveAt: null }];
    }
    if (q.country && q.country.length) match.country = { $in: q.country };
    if (q.emailVerified !== undefined) match.emailVerified = q.emailVerified;
  }

  return match;
};

/** Ids that satisfy the filters needing their own collection. */
const relatedIdFilters = async (q) => {
  const constraints = [];

  if (q.hasNovelInLibrary && q.hasNovelInLibrary.length) {
    const ids = await User.find({ library: { $in: oids(q.hasNovelInLibrary) } }).distinct('_id');
    constraints.push(ids);
  }

  if (q.hasReadNovel && q.hasReadNovel.length) {
    const ids = await ChapterRead.find({ novel: { $in: oids(q.hasReadNovel) }, user: { $ne: null } }).distinct('user');
    constraints.push(ids);
  }

  if (q.minChaptersRead) {
    const rows = await ChapterRead.aggregate([
      { $match: { user: { $ne: null } } },
      { $group: { _id: '$user', chapters: { $sum: 1 } } },
      { $match: { chapters: { $gte: q.minChaptersRead } } },
    ]);
    constraints.push(rows.map((row) => row._id));
  }

  if (q.minChaptersUnlocked) {
    const rows = await ChapterAccess.aggregate([
      { $group: { _id: '$user', unlocks: { $sum: 1 } } },
      { $match: { unlocks: { $gte: q.minChaptersUnlocked } } },
    ]);
    constraints.push(rows.map((row) => row._id));
  }

  if (q.minCommentCount) {
    const rows = await Comment.aggregate([
      { $group: { _id: '$user', n: { $sum: 1 } } },
      { $match: { n: { $gte: q.minCommentCount } } },
    ]);
    constraints.push(rows.map((row) => row._id));
  }

  if (q.minReviewCount) {
    const rows = await Review.aggregate([
      { $group: { _id: '$user', n: { $sum: 1 } } },
      { $match: { n: { $gte: q.minReviewCount } } },
    ]);
    constraints.push(rows.map((row) => row._id));
  }

  if (q.receivedGrantCampaign) {
    const ids = await CreditTransaction.find({
      refType: 'grant_campaign',
      refId: oid(q.receivedGrantCampaign),
    }).distinct('user');
    constraints.push(ids);
  }

  return constraints;
};

/** Users who must be excluded — currently the "did not receive X" filter. */
const excludedIds = async (q) => {
  if (!q.notReceivedGrantCampaign) return [];
  // What makes re-running a campaign for stragglers safe.
  return CreditTransaction.find({
    refType: 'grant_campaign',
    refId: oid(q.notReceivedGrantCampaign),
  }).distinct('user');
};

/** Assemble the full pipeline for a rule. */
const buildPipeline = async (rule, { forCount = false } = {}) => {
  const q = rule.query || {};
  const pipeline = [{ $match: buildBaseMatch(rule) }];

  if (rule.mode === AUDIENCE_MODES.QUERY) {
    const constraints = await relatedIdFilters(q);
    for (const ids of constraints) {
      pipeline.push({ $match: { _id: { $in: ids } } });
    }
    const excluded = await excludedIds(q);
    if (excluded.length) pipeline.push({ $match: { _id: { $nin: excluded } } });

    if (needsWallet(q, rule)) {
      pipeline.push(
        { $lookup: { from: 'wallets', localField: '_id', foreignField: 'user', as: 'wallet' } },
        { $unwind: { path: '$wallet', preserveNullAndEmptyArrays: true } },
        // Project the wallet figures with explicit zero defaults. Matching on
        // `wallet.balance` directly would silently drop every user who has no
        // wallet row yet — exactly the people a "balance below X" campaign is
        // trying to reach.
        {
          $addFields: {
            _balance: { $ifNull: ['$wallet.balance', 0] },
            _spend: { $ifNull: ['$wallet.lifetimeSpendUsdCents', 0] },
            _purchased: { $ifNull: ['$wallet.lifetimePurchased', 0] },
          },
        }
      );

      const walletMatch = {};
      if (q.balanceAbove !== undefined) walletMatch._balance = { $gte: q.balanceAbove };
      if (q.balanceBelow !== undefined) {
        walletMatch._balance = { ...(walletMatch._balance || {}), $lte: q.balanceBelow };
      }
      if (q.minLifetimeSpendUsdCents !== undefined) walletMatch._spend = { $gte: q.minLifetimeSpendUsdCents };
      if (q.maxLifetimeSpendUsdCents !== undefined) {
        walletMatch._spend = { ...(walletMatch._spend || {}), $lte: q.maxLifetimeSpendUsdCents };
      }
      if (q.hasEverPurchased !== undefined) {
        walletMatch._purchased = q.hasEverPurchased ? { $gt: 0 } : { $lte: 0 };
      }
      if (Object.keys(walletMatch).length) pipeline.push({ $match: walletMatch });
    }
  }

  if (forCount) {
    // A limited audience still counts as at most `limit`.
    if (rule.limit) pipeline.push({ $limit: rule.limit });
    pipeline.push({ $count: 'total' });
    return pipeline;
  }

  if (rule.orderBy === 'random') {
    pipeline.push({ $sample: { size: rule.limit || 100000 } });
  } else {
    const sort = ORDER_BY[rule.orderBy] || ORDER_BY.createdAt;
    if (sort) pipeline.push({ $sort: sort });
    if (rule.limit) pipeline.push({ $limit: rule.limit });
  }

  pipeline.push({ $project: { _id: 1, username: 1, email: 1, notificationPreferences: 1, banned: 1 } });
  return pipeline;
};

/** How many users this rule targets. Cheap enough to call on every keystroke. */
const count = async (rule) => {
  if (!rule || !rule.mode) return 0;
  const pipeline = await buildPipeline(rule, { forCount: true });
  const [row] = await User.aggregate(pipeline);
  return row ? row.total : 0;
};

/** A sample of matched users, so an admin can sanity-check before sending. */
const preview = async (rule, limit = 10) => {
  const pipeline = await buildPipeline(rule);
  pipeline.push({ $limit: limit });
  const users = await User.aggregate(pipeline);
  return users.map((user) => ({ id: user._id, username: user.username, email: user.email }));
};

/**
 * Matched users after a cursor, in batches.
 *
 * Cursor-based rather than skip-based so a campaign can resume after a crash
 * without re-paying anyone or skipping the tail.
 */
/**
 * Can this rule be walked with an _id cursor?
 *
 * Only when the whole matching set is wanted in a natural order. A rule with a
 * `limit`, or ordered by anything other than creation, cannot be cursored:
 * re-running the pipeline for each batch would re-apply the limit to a
 * shrinking candidate set, so a campaign capped at "the first 1000 users"
 * would pay out to far more than 1000 — and a high-spending user whose _id
 * sorts before the cursor would be skipped entirely.
 */
const isCursorable = (rule) => !rule.limit && (!rule.orderBy || rule.orderBy === 'createdAt');

const batch = async (rule, { afterId = null, size = 250 } = {}) => {
  const pipeline = await buildPipeline(rule);

  if (!isCursorable(rule)) {
    // Resolve the audience once and page through it in memory. Bounded by
    // rule.limit in the common case, and by the match itself otherwise.
    const all = await User.aggregate(pipeline);
    const start = afterId ? all.findIndex((user) => String(user._id) === String(afterId)) + 1 : 0;
    return all.slice(start, start + size);
  }

  const cursored = [...pipeline];
  if (afterId) cursored.unshift({ $match: { _id: { $gt: oid(afterId) } } });
  cursored.push({ $sort: { _id: 1 } }, { $limit: size });
  return User.aggregate(cursored);
};

module.exports = { count, preview, batch, buildPipeline, AUDIENCE_MODES };
