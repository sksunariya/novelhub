// The vote write path — the highest-frequency write on the site.
//
// TWO WRITES PER VOTE. No transaction, no read-modify-write:
//
//   1. findOneAndUpdate on the unique { user, targetType, target } key with
//      upsert, returning the PREVIOUS document. That one round trip both
//      records the vote and tells us what it replaced.
//   2. counterService.increment with the delta derived from previous -> next.
//
// The delta is computed by rankingService.voteDelta, which is pure, so step 2
// never needs to read the post. Flipping an upvote to a downvote is a score
// change of -2 rather than -1, and getting that wrong silently corrupts every
// counter on the site.
//
// IDEMPOTENT. Submitting the same value twice is a no-op: the delta is zero and
// no counter moves. A double-click cannot double-count.

const mongoose = require('mongoose');
const crypto = require('crypto');
const Vote = require('../../models/Vote');
const Post = require('../../models/Post');
const User = require('../../models/User');
const counterService = require('../counterService');
const ranking = require('./rankingService');
const { VOTE_TARGET_TYPES } = require('../../config/constants');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Lazy getters rather than eager requires: commentService requires this module
// for vote hydration, so a top-level require of PostComment here would close a
// load-time cycle.
const MODEL_FOR = {
  get [VOTE_TARGET_TYPES.POST]() {
    return Post;
  },
  get [VOTE_TARGET_TYPES.COMMENT]() {
    // eslint-disable-next-line global-require
    return require('../../models/PostComment');
  },
};

/**
 * A stable, non-reversible device fingerprint.
 *
 * Hashed rather than stored raw: it is only ever compared for equality, so the
 * plaintext has no use and storing it would make the collection a tracking
 * database. Salted with JWT_SECRET so the hashes are useless if exfiltrated
 * without it.
 */
const fingerprintOf = (req) => {
  if (!req) return { fingerprint: '', ipHash: '' };
  const salt = process.env.JWT_SECRET || 'novelhub';
  const ua = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  const hash = (value) =>
    value ? crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32) : '';
  return {
    fingerprint: hash(`${ua}|${lang}`),
    ipHash: hash(req.ip || ''),
  };
};

/**
 * Check the voting gates.
 *
 * Returns null when allowed, or a reason string. Separate from `cast` so the
 * feed can tell a client up front that voting is unavailable and why, rather
 * than the user discovering it on click.
 */
const checkEligibility = (user, settings, { authorId = null } = {}) => {
  if (!settings.get('spaces.voting.enabled')) return 'Voting is disabled';
  if (!user) return 'Sign in to vote';

  // Self-voting is rejected explicitly rather than silently ignored, so the UI
  // can say why. The author's automatic upvote at creation is a separate path.
  if (authorId && String(authorId) === String(user._id)) {
    return 'You cannot vote on your own post';
  }

  const minAgeHours = settings.get('spaces.voting.minAccountAgeHours');
  if (minAgeHours > 0) {
    const eligibleAt = new Date(new Date(user.createdAt).getTime() + minAgeHours * 3600_000);
    if (eligibleAt > new Date()) return `Your account must be ${minAgeHours} hours old to vote`;
  }

  return null;
};

const checkDownvoteEligibility = (user, settings) => {
  if (!settings.get('spaces.voting.allowDownvotes')) return 'Downvoting is disabled';
  const minKarma = settings.get('spaces.voting.minKarmaToDownvote');
  const karma = (user.karma && user.karma.total) || 0;
  if (minKarma > 0 && karma < minKarma) return `You need ${minKarma} karma to downvote`;
  return null;
};

/**
 * Cast, change or remove a vote.
 *
 * @param {object} options
 * @param {object} options.user
 * @param {string} options.targetType
 * @param {ObjectId} options.targetId
 * @param {ObjectId} options.spaceId
 * @param {ObjectId} options.authorId   who receives the karma
 * @param {number} options.value        1 | -1 | 0 (remove)
 * @param {object} options.settings     resolved space settings reader
 * @param {object} [options.req]        for the fingerprint
 */
const cast = async ({ user, targetType, targetId, spaceId, authorId, value, settings, req = null }) => {
  const next = value === 1 || value === -1 ? value : 0;

  const blocked = checkEligibility(user, settings, { authorId });
  if (blocked) throw fail(blocked, 403);
  if (next === -1) {
    const downBlocked = checkDownvoteEligibility(user, settings);
    if (downBlocked) throw fail(downBlocked, 403);
  }
  if (next !== 0 && !settings.get('spaces.voting.allowVoteChange')) {
    const existing = await Vote.findOne({ user: user._id, targetType, target: targetId }).lean();
    if (existing && existing.value !== next) throw fail('Votes cannot be changed', 409);
  }

  const filter = { user: user._id, targetType, target: targetId };
  let previous = 0;

  if (next === 0) {
    const removed = await Vote.findOneAndDelete(filter).lean();
    previous = removed && !removed.nullified ? removed.value : 0;
  } else {
    const { fingerprint, ipHash } = fingerprintOf(req);
    // `returnDocument: 'before'` is what makes this one round trip instead of
    // two: it records the new value AND reports what it replaced.
    const prior = await Vote.findOneAndUpdate(
      filter,
      {
        $set: { value: next, space: spaceId, fingerprint, ipHash, nullified: false },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'before' }
    ).lean();
    previous = prior && !prior.nullified ? prior.value : 0;
  }

  const delta = ranking.voteDelta(previous, next);
  if (!delta.changed) {
    return { value: next, previous, changed: false };
  }

  const Model = MODEL_FOR[targetType];
  if (!Model) throw fail('Unsupported vote target', 400);

  // Recompute the ranking scores from the post's new totals. Pure arithmetic on
  // numbers already in hand — the read is only needed because hotScore depends
  // on createdAt, which does not change and could be cached later.
  const target = await Model.findById(targetId)
    .select('upvotes downvotes createdAt')
    .lean()
    .read('primary');
  if (!target) throw fail('Not found', 404);

  const upvotes = target.upvotes + delta.upvotes;
  const downvotes = target.downvotes + delta.downvotes;
  const scores = ranking.scoresFor(
    { upvotes, downvotes, createdAt: target.createdAt },
    {
      gravitySeconds: settings.get('spaces.ranking.hotGravitySeconds'),
      confidenceZ: settings.get('spaces.ranking.confidenceZ'),
    }
  );

  await counterService.increment(
    targetType,
    targetId,
    { upvotes: delta.upvotes, downvotes: delta.downvotes, score: delta.score },
    {
      hotScore: scores.hotScore,
      bestScore: scores.bestScore,
      controversyScore: scores.controversyScore,
    }
  );

  // Karma to the author. Fire-and-forget: a karma write must never fail a vote,
  // and the nightly rebuild corrects any drift from the ledger.
  if (settings.get('spaces.karma.enabled') && authorId) {
    const karmaChange = ranking.karmaDelta(previous, next, {
      upvoteValue: settings.get('spaces.karma.postUpvoteValue'),
      downvotePenalty: settings.get('spaces.karma.downvotePenalty'),
    });
    if (karmaChange !== 0) {
      const field = targetType === VOTE_TARGET_TYPES.POST ? 'karma.post' : 'karma.comment';
      counterService
        .incrementSilent('user', authorId, { [field]: karmaChange, 'karma.total': karmaChange });
    }
  }

  return { value: next, previous, changed: true, score: scores.score };
};

/**
 * This user's votes across a set of targets.
 *
 * One query per feed page, merged into the response — never a query per post.
 * Always reads the primary: a vote that visually bounces back because it was
 * read from a stale secondary is the most-reported bug on every voting site.
 */
const forTargets = async (user, targetType, targetIds) => {
  if (!user || !targetIds.length) return {};
  const rows = await Vote.forUserTargets(user._id, targetType, targetIds).read('primary');
  return rows.reduce((acc, row) => {
    acc[String(row.target)] = row.value;
    return acc;
  }, {});
};

/**
 * The author's automatic upvote at creation.
 *
 * A real Vote row rather than a synthetic +1 on the counters, so the ledger
 * stays truth and the rebuild job produces the same number as the live
 * counters. A synthetic bump would make every post permanently off by one after
 * the first rebuild.
 */
const autoUpvote = async ({ user, targetType, targetId, spaceId }) => {
  await Vote.create({
    user: user._id,
    targetType,
    target: targetId,
    space: spaceId,
    value: 1,
  });
};

/**
 * Nullify votes without deleting them.
 *
 * Used by manipulation enforcement. The rows stay so the evidence survives an
 * appeal and the counters remain rebuildable; they simply stop counting.
 * Returns the per-target deltas so the caller can correct the counters.
 */
const nullifyByUsers = async (userIds, { reason = 'vote manipulation' } = {}) => {
  const affected = await Vote.find({ user: { $in: userIds }, nullified: false })
    .select('target targetType value')
    .lean();

  if (!affected.length) return { nullified: 0, targets: [] };

  await Vote.updateMany(
    { user: { $in: userIds }, nullified: false },
    { $set: { nullified: true, nullifiedReason: reason } }
  );

  const byTarget = new Map();
  for (const vote of affected) {
    const key = String(vote.target);
    const entry = byTarget.get(key) || { targetType: vote.targetType, upvotes: 0, downvotes: 0, score: 0 };
    if (vote.value === 1) {
      entry.upvotes -= 1;
      entry.score -= 1;
    } else {
      entry.downvotes -= 1;
      entry.score += 1;
    }
    byTarget.set(key, entry);
  }

  for (const [targetId, delta] of byTarget) {
    await counterService.increment(delta.targetType, targetId, {
      upvotes: delta.upvotes,
      downvotes: delta.downvotes,
      score: delta.score,
    });
  }

  return { nullified: affected.length, targets: [...byTarget.keys()] };
};

/**
 * Rebuild counters for a set of posts from the ledger.
 *
 * The recovery path for any counter drift, and the reason batched counter
 * writes are safe to enable.
 */
const rebuildCounters = async (targetIds, settings) => {
  const ids = targetIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const tallies = await Vote.tallyFor(ids);
  const byId = new Map(tallies.map((t) => [String(t._id), t]));

  const posts = await Post.find({ _id: { $in: ids } }).select('createdAt').lean();
  const operations = posts.map((post) => {
    const tally = byId.get(String(post._id)) || { upvotes: 0, downvotes: 0 };
    const scores = ranking.scoresFor(
      { upvotes: tally.upvotes, downvotes: tally.downvotes, createdAt: post.createdAt },
      {
        gravitySeconds: settings.get('spaces.ranking.hotGravitySeconds'),
        confidenceZ: settings.get('spaces.ranking.confidenceZ'),
      }
    );
    return {
      updateOne: {
        filter: { _id: post._id },
        update: { $set: { upvotes: tally.upvotes, downvotes: tally.downvotes, ...scores } },
      },
    };
  });

  if (!operations.length) return { rebuilt: 0 };
  await Post.bulkWrite(operations, { ordered: false });
  return { rebuilt: operations.length };
};

module.exports = {
  cast,
  forTargets,
  autoUpvote,
  nullifyByUsers,
  rebuildCounters,
  checkEligibility,
  checkDownvoteEligibility,
  fingerprintOf,
};
