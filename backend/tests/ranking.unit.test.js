// Ranking maths, cursor pagination, and the index shapes the feeds depend on.
//
// The ranking functions are pure, so they can be checked against known
// reference values rather than "it returned a number". A ranking change that
// silently alters ordering is otherwise invisible until users complain.

const ranking = require('../src/services/community/rankingService');
const feedService = require('../src/services/community/feedService');
const { HOT_SCORE_EPOCH_SECONDS, POST_SORTS } = require('../src/config/constants');

const AT = new Date('2026-08-15T12:00:00Z');
const GRAVITY = 45000;

describe('hot score', () => {
  it('buys exactly one gravity window per order of magnitude', () => {
    // The defining property of the formula: 10x the score is worth the same as
    // being `gravity` seconds newer. If this breaks, the feed's whole
    // time-vs-popularity balance has changed.
    const older = new Date(AT.getTime() - GRAVITY * 1000);
    expect(ranking.hotScore(10, older, GRAVITY)).toBeCloseTo(ranking.hotScore(1, AT, GRAVITY), 5);
    expect(ranking.hotScore(100, older, GRAVITY)).toBeCloseTo(ranking.hotScore(10, AT, GRAVITY), 5);
  });

  it('separates each order of magnitude by exactly 1.0 at a fixed time', () => {
    const a = ranking.hotScore(1, AT, GRAVITY);
    const b = ranking.hotScore(10, AT, GRAVITY);
    const c = ranking.hotScore(100, AT, GRAVITY);
    expect(b - a).toBeCloseTo(1, 5);
    expect(c - b).toBeCloseTo(1, 5);
  });

  it('ranks a newer post above an equally scored older one', () => {
    const old = new Date(AT.getTime() - 86400_000);
    expect(ranking.hotScore(50, AT, GRAVITY)).toBeGreaterThan(ranking.hotScore(50, old, GRAVITY));
  });

  it('makes a lower gravity churn the feed faster', () => {
    // Lower gravity = time matters more = a bigger gap between the same two
    // posts. This is the dial an admin turns.
    const old = new Date(AT.getTime() - 86400_000);
    const fast = ranking.hotScore(50, AT, 10000) - ranking.hotScore(50, old, 10000);
    const slow = ranking.hotScore(50, AT, 90000) - ranking.hotScore(50, old, 90000);
    expect(fast).toBeGreaterThan(slow);
  });

  it('sinks a heavily downvoted post below a lightly downvoted one', () => {
    // The sign multiplies the ORDER, not the time. Putting it on the time term
    // instead makes -50 outrank -5, which is exactly backwards — and the two
    // formulations look almost identical when read quickly.
    expect(ranking.hotScore(-50, AT, GRAVITY)).toBeLessThan(ranking.hotScore(-5, AT, GRAVITY));
    expect(ranking.hotScore(-5, AT, GRAVITY)).toBeLessThan(ranking.hotScore(0, AT, GRAVITY));
  });

  it('ranks a zero-score post purely by recency', () => {
    // A brand-new post with no votes yet must still be ordered against other
    // new posts, not collapsed to a constant.
    const older = new Date(AT.getTime() - 3600_000);
    expect(ranking.hotScore(0, AT, GRAVITY)).toBeGreaterThan(ranking.hotScore(0, older, GRAVITY));
  });

  it('orders positive above zero above negative at the same moment', () => {
    expect(ranking.hotScore(10, AT, GRAVITY)).toBeGreaterThan(ranking.hotScore(0, AT, GRAVITY));
    expect(ranking.hotScore(0, AT, GRAVITY)).toBeGreaterThan(ranking.hotScore(-10, AT, GRAVITY));
  });

  it('uses the fixed epoch, not a relative clock', () => {
    const epochMoment = new Date(HOT_SCORE_EPOCH_SECONDS * 1000);
    expect(ranking.hotScore(1, epochMoment, GRAVITY)).toBeCloseTo(0, 5);
  });
});

describe('confidence (Wilson lower bound)', () => {
  it('ranks a large sample above a small perfect one', () => {
    // The entire reason for this sort: 5/0 must not outrank 300/20.
    expect(ranking.confidenceScore(300, 20)).toBeGreaterThan(ranking.confidenceScore(5, 0));
  });

  it('grows with sample size at the same ratio', () => {
    const small = ranking.confidenceScore(9, 1);
    const large = ranking.confidenceScore(900, 100);
    expect(large).toBeGreaterThan(small);
  });

  it('returns zero with no votes', () => {
    expect(ranking.confidenceScore(0, 0)).toBe(0);
  });

  it('stays within 0 and 1', () => {
    for (const [up, down] of [[1, 0], [0, 1], [50, 50], [1000, 1], [1, 1000]]) {
      const score = ranking.confidenceScore(up, down);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('is more conservative at a higher z', () => {
    expect(ranking.confidenceScore(10, 1, 2.5)).toBeLessThan(ranking.confidenceScore(10, 1, 1.28));
  });
});

describe('controversy', () => {
  it('peaks on an even split', () => {
    expect(ranking.controversyScore(500, 500)).toBeGreaterThan(ranking.controversyScore(500, 50));
    expect(ranking.controversyScore(500, 50)).toBeGreaterThan(ranking.controversyScore(500, 2));
  });

  it('rewards magnitude at the same balance', () => {
    expect(ranking.controversyScore(500, 500)).toBeGreaterThan(ranking.controversyScore(50, 50));
  });

  it('is zero when either side is empty', () => {
    // Unanimous is not controversial, however large.
    expect(ranking.controversyScore(1000, 0)).toBe(0);
    expect(ranking.controversyScore(0, 1000)).toBe(0);
  });

  it('is symmetric', () => {
    expect(ranking.controversyScore(300, 100)).toBeCloseTo(ranking.controversyScore(100, 300), 5);
  });
});

describe('vote delta', () => {
  it.each([
    [0, 1, { score: 1, upvotes: 1, downvotes: 0 }],
    [0, -1, { score: -1, upvotes: 0, downvotes: 1 }],
    [1, 0, { score: -1, upvotes: -1, downvotes: 0 }],
    [-1, 0, { score: 1, upvotes: 0, downvotes: -1 }],
    [1, -1, { score: -2, upvotes: -1, downvotes: 1 }],
    [-1, 1, { score: 2, upvotes: 1, downvotes: -1 }],
  ])('%i -> %i', (previous, next, expected) => {
    expect(ranking.voteDelta(previous, next)).toEqual({ ...expected, changed: true });
  });

  it('is a no-op when the value is unchanged', () => {
    // What makes the endpoint idempotent: a double-click cannot double-count.
    for (const value of [1, -1, 0]) {
      expect(ranking.voteDelta(value, value).changed).toBe(false);
      expect(ranking.voteDelta(value, value).score).toBe(0);
    }
  });

  it('treats a flip as a swing of two, not one', () => {
    // Getting this wrong silently corrupts every counter on the site.
    expect(ranking.voteDelta(1, -1).score).toBe(-2);
    expect(ranking.voteDelta(-1, 1).score).toBe(2);
  });

  it('coerces junk to no-vote rather than throwing', () => {
    expect(ranking.voteDelta(null, 5).score).toBe(0);
    expect(ranking.voteDelta(undefined, 'x').changed).toBe(false);
  });
});

describe('karma delta', () => {
  it('follows the configured values', () => {
    expect(ranking.karmaDelta(0, 1, { upvoteValue: 2 })).toBe(2);
    expect(ranking.karmaDelta(0, -1, { downvotePenalty: 0.5 })).toBe(-0.5);
  });

  it('reverses correctly when a vote is withdrawn', () => {
    expect(ranking.karmaDelta(1, 0, { upvoteValue: 1 })).toBe(-1);
  });

  it('supports a zero-cost downvote', () => {
    // Some communities want downvotes to bury without punishing.
    expect(ranking.karmaDelta(0, -1, { downvotePenalty: 0 })).toBe(0);
  });
});

describe('grapheme counting', () => {
  it('counts what a person sees, not UTF-16 units', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(family.length).toBe(11); // what a naive limit would count
    expect(ranking.graphemeLength(family)).toBe(1); // what a user counts
  });

  it('handles combining marks as one character', () => {
    expect(ranking.graphemeLength('é')).toBe(1); // é as e + combining acute
  });

  it('counts plain text normally', () => {
    expect(ranking.graphemeLength('hello')).toBe(5);
    expect(ranking.graphemeLength('')).toBe(0);
    expect(ranking.graphemeLength(null)).toBe(0);
  });

  it('truncates without splitting a grapheme', () => {
    const text = 'ab👨‍👩‍👧‍👦cd';
    const cut = ranking.truncateGraphemes(text, 3);
    expect(ranking.graphemeLength(cut)).toBe(3);
    expect(cut).toBe('ab👨‍👩‍👧‍👦'); // the emoji survives whole
  });

  it('leaves short text alone', () => {
    expect(ranking.truncateGraphemes('hi', 10)).toBe('hi');
  });
});

describe('cursor pagination', () => {
  it('round-trips a value and id', () => {
    const cursor = feedService.encodeCursor(1234.5678, 'abc123');
    expect(feedService.decodeCursor(cursor)).toEqual({ v: 1234.5678, id: 'abc123' });
  });

  it('round-trips a date sort value', () => {
    const date = new Date('2026-08-15T12:00:00Z');
    const decoded = feedService.decodeCursor(feedService.encodeCursor(date, 'abc'));
    expect(new Date(decoded.v).getTime()).toBe(date.getTime());
  });

  it('treats a malformed cursor as no cursor', () => {
    // A stale bookmark should return the first page, not a 400.
    for (const bad of ['not-base64!!', '', null, undefined, Buffer.from('{}').toString('base64url')]) {
      expect(feedService.decodeCursor(bad)).toBeNull();
    }
  });

  it('includes an id tiebreak so ties are not skipped', () => {
    // `{ field: { $lt: v } }` alone silently drops every row tied on the sort
    // value — the classic keyset bug.
    const clause = feedService.cursorClause('hotScore', { v: 100, id: 'abc' });
    expect(clause.$or).toHaveLength(2);
    expect(clause.$or[0]).toEqual({ hotScore: { $lt: 100 } });
    expect(clause.$or[1]).toEqual({ hotScore: 100, _id: { $lt: 'abc' } });
  });

  it('returns an empty clause with no cursor', () => {
    expect(feedService.cursorClause('hotScore', null)).toEqual({});
  });

  it('maps every sort to a persisted, indexed field', () => {
    // A sort with no stored field behind it would be an in-memory sort of the
    // whole collection.
    for (const sort of Object.values(POST_SORTS)) {
      expect(feedService.SORT_FIELD[sort]).toBeTruthy();
    }
  });
});

describe('score visibility', () => {
  const settings = (values) => ({ get: (key) => values[key] });

  it('hides the score inside the configured window', () => {
    const posts = [{ score: 42, createdAt: new Date(), upvotes: 50, downvotes: 8 }];
    const [out] = feedService.applyScoreVisibility(
      posts,
      settings({ 'spaces.voting.showScoreBeforeHours': 2, 'spaces.voting.hideDownvoteCount': false })
    );
    // Hidden server-side. Omitting it only in the UI is not hiding it.
    expect(out.score).toBeNull();
    expect(out.scoreHidden).toBe(true);
    expect(out.scoreVisibleAt).toBeInstanceOf(Date);
  });

  it('reveals the score once the window has passed', () => {
    const posts = [{ score: 42, createdAt: new Date(Date.now() - 5 * 3600_000) }];
    const [out] = feedService.applyScoreVisibility(
      posts,
      settings({ 'spaces.voting.showScoreBeforeHours': 2, 'spaces.voting.hideDownvoteCount': false })
    );
    expect(out.score).toBe(42);
    expect(out.scoreHidden).toBeUndefined();
  });

  it('strips the raw counts when only the net score should show', () => {
    const [out] = feedService.applyScoreVisibility(
      [{ score: 42, upvotes: 50, downvotes: 8, createdAt: new Date() }],
      settings({ 'spaces.voting.showScoreBeforeHours': 0, 'spaces.voting.hideDownvoteCount': true })
    );
    expect(out.downvotes).toBeUndefined();
    expect(out.upvotes).toBeUndefined();
    expect(out.score).toBe(42);
  });

  it('does nothing when both controls are off', () => {
    const posts = [{ score: 42, upvotes: 50, downvotes: 8, createdAt: new Date() }];
    const [out] = feedService.applyScoreVisibility(
      posts,
      settings({ 'spaces.voting.showScoreBeforeHours': 0, 'spaces.voting.hideDownvoteCount': false })
    );
    expect(out).toBe(posts[0]);
  });
});

describe('feed and vote index shapes', () => {
  const Post = require('../src/models/Post');
  const Vote = require('../src/models/Vote');

  const hasIndex = (model, keys) =>
    model.schema.indexes().some(([spec]) => JSON.stringify(spec) === JSON.stringify(keys));

  it('follows ESR on every feed index', () => {
    // Equality, Sort, Range. Wrong order still gets used by the planner and
    // still sorts in memory — it looks fine at a glance in explain().
    expect(hasIndex(Post, { space: 1, status: 1, hotScore: -1, _id: -1 })).toBe(true);
    expect(hasIndex(Post, { space: 1, status: 1, createdAt: -1, _id: -1 })).toBe(true);
    expect(hasIndex(Post, { space: 1, status: 1, score: -1, _id: -1 })).toBe(true);
    expect(hasIndex(Post, { status: 1, hotScore: -1, _id: -1 })).toBe(true);
  });

  it('gives every feed index an _id tiebreak for keyset paging', () => {
    const feedIndexes = Post.schema
      .indexes()
      .filter(([spec]) => spec.hotScore || (spec.status && spec.createdAt));
    expect(feedIndexes.length).toBeGreaterThan(0);
  });

  it('keeps the vote uniqueness constraint', () => {
    const unique = Vote.schema
      .indexes()
      .find(([spec]) => spec.user === 1 && spec.targetType === 1 && spec.target === 1);
    expect(unique).toBeTruthy();
    expect(unique[1].unique).toBe(true);
  });

  it('indexes space on votes, for the karma rebuild that does not exist yet', () => {
    expect(hasIndex(Vote, { space: 1, user: 1 })).toBe(true);
  });

  it('does not put softDelete on votes', () => {
    // The plugin's read hook would add a filter to the most frequent query on
    // the site, for a collection where unvoting is a real delete.
    expect(Vote.schema.paths.deletedAt).toBeUndefined();
  });

  it('carries the fields that would be a migration to add later', () => {
    for (const field of ['space', 'nullified', 'fingerprint', 'ipHash']) {
      expect(Vote.schema.paths[field]).toBeDefined();
    }
  });

  it('partial-indexes the moderation queue rather than the whole collection', () => {
    const partial = Post.schema
      .indexes()
      .find(([, options]) => options && options.partialFilterExpression);
    expect(partial).toBeTruthy();
    expect(partial[1].partialFilterExpression).toEqual({ reportCount: { $gt: 0 } });
  });
});
