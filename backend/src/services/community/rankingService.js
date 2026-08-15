// Ranking maths.
//
// PURE. No database, no settings lookup, no I/O of any kind — every input is an
// argument. That is a hard rule, not a preference:
//
//   - `hotScore` is recomputed on every single vote. If this module could
//     query, that would be an extra round trip on the highest-frequency write
//     on the site.
//   - Pure functions are testable against known reference values, which is the
//     only way to be confident a ranking change did what was intended.
//   - It stays trivially extractable if the vote path is ever split out.
//
// Tunable constants are passed in by the caller, which reads them from the
// settings registry. Nothing here reads configuration.

const { HOT_SCORE_EPOCH_SECONDS } = require('../../config/constants');

/**
 * Reddit's hot ranking.
 *
 *   sign(score) * log10(max(|score|, 1)) + (seconds - EPOCH) / gravity
 *
 * The sign multiplies the ORDER, not the time. That placement is the whole
 * behaviour of the formula and it is easy to get backwards:
 *
 *   - Time is always added positively, so a newer post always ranks above an
 *     identically scored older one.
 *   - A negative score subtracts, so a heavily downvoted post sinks BELOW a
 *     lightly downvoted one. (With the sign on the time term instead, -50 would
 *     outrank -5, which is exactly wrong.)
 *   - A zero score contributes nothing, so a brand-new post ranks purely by
 *     recency rather than collapsing to a constant.
 *
 * The logarithm is why the first ten votes matter enormously and the next
 * thousand barely move a post: each order of magnitude buys the same fixed
 * amount of time. `gravity` is how many seconds one order of magnitude is
 * worth — 45000 (~12.5h) by default, and the single most consequential dial in
 * the product.
 *
 * Stored on the document and indexed descending. A feed is an index scan on
 * this field or it does not scale.
 *
 * @param {number} score       upvotes - downvotes
 * @param {Date|number} createdAt
 * @param {number} gravitySeconds
 */
const hotScore = (score, createdAt, gravitySeconds = 45000) => {
  const seconds = Math.floor(new Date(createdAt).getTime() / 1000) - HOT_SCORE_EPOCH_SECONDS;
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  // 7 decimal places: enough to keep ordering stable between posts seconds
  // apart, few enough that the stored double stays comparable.
  return Number((order * sign + seconds / gravitySeconds).toFixed(7));
};

/**
 * Wilson score lower bound — the "best" sort.
 *
 * Asks: given this sample, what is the worst plausible true approval rate? A
 * 5/0 comment has a wide confidence interval and scores below a 300/20 one,
 * which is exactly right and is why this rather than a raw ratio is the default
 * comment sort.
 *
 * z = 1.281655 is an 80% confidence interval. Higher z is more conservative
 * toward low-vote items.
 */
const confidenceScore = (upvotes, downvotes, z = 1.281655) => {
  const n = upvotes + downvotes;
  if (n === 0) return 0;

  const p = upvotes / n;
  const z2 = z * z;
  const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;
  return Number((numerator / denominator).toFixed(7));
};

/**
 * Controversy — magnitude weighted by how evenly split the vote is.
 *
 *   (up + down) ^ (min/max)
 *
 * A 500/500 post scores enormously; a 500/2 post scores near 1. Zero on either
 * side is not controversial, it is just unpopular or popular.
 */
const controversyScore = (upvotes, downvotes) => {
  if (upvotes <= 0 || downvotes <= 0) return 0;
  const magnitude = upvotes + downvotes;
  const balance = Math.min(upvotes, downvotes) / Math.max(upvotes, downvotes);
  return Number((magnitude ** balance).toFixed(7));
};

/**
 * Rising — score velocity within a short window.
 *
 * Computed at read time rather than stored: the candidate set is bounded by the
 * window, so it is small, and a stored field would need recomputing constantly
 * as the age denominator changes.
 *
 * The `floor` stops a 30-second-old post with 2 votes from topping the list.
 */
const risingScore = (score, createdAt, { floorMinutes = 30 } = {}) => {
  const ageMinutes = (Date.now() - new Date(createdAt).getTime()) / 60000;
  return Number((score / Math.max(ageMinutes, floorMinutes)).toFixed(7));
};

/** Every score a post carries, computed together. Used on create and on vote. */
const scoresFor = ({ upvotes = 0, downvotes = 0, createdAt = new Date() }, options = {}) => {
  const score = upvotes - downvotes;
  return {
    score,
    hotScore: hotScore(score, createdAt, options.gravitySeconds),
    bestScore: confidenceScore(upvotes, downvotes, options.confidenceZ),
    controversyScore: controversyScore(upvotes, downvotes),
  };
};

/**
 * The delta a vote produces.
 *
 * Returns the counter changes for moving from `previous` to `next`, where each
 * is 1, -1 or 0 (no vote). Pure, so the vote path can compute it without
 * re-reading the post.
 *
 * The four-way case matters: flipping an upvote to a downvote is a score change
 * of -2, not -1, and getting that wrong silently corrupts every counter.
 */
const voteDelta = (previous, next) => {
  const prev = previous === 1 || previous === -1 ? previous : 0;
  const value = next === 1 || next === -1 ? next : 0;

  if (prev === value) return { score: 0, upvotes: 0, downvotes: 0, changed: false };

  return {
    score: value - prev,
    upvotes: (value === 1 ? 1 : 0) - (prev === 1 ? 1 : 0),
    downvotes: (value === -1 ? 1 : 0) - (prev === -1 ? 1 : 0),
    changed: true,
  };
};

/**
 * The karma a vote grants or removes.
 *
 * Separate from the score delta because karma is configurable per direction —
 * a downvote may cost less than an upvote gives — and because it is capped per
 * post, which the score is not.
 */
const karmaDelta = (previous, next, { upvoteValue = 1, downvotePenalty = 1 } = {}) => {
  const prev = previous === 1 || previous === -1 ? previous : 0;
  const value = next === 1 || next === -1 ? next : 0;
  const worth = (v) => (v === 1 ? upvoteValue : v === -1 ? -downvotePenalty : 0);
  return Number((worth(value) - worth(prev)).toFixed(4));
};

// ---------------------------------------------------------------- text

/**
 * Length in user-perceived characters.
 *
 * `'👨‍👩‍👧‍👦'.length` is 11 and its code-point count is 7, but a person sees one
 * character. Counting either of those against a title limit produces a rule
 * nobody can predict. Intl.Segmenter gives the count a user would give.
 */
let segmenter = null;
const graphemeLength = (text) => {
  if (typeof text !== 'string' || !text) return 0;
  try {
    if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of segmenter.segment(text)) count += 1;
    return count;
  } catch (error) {
    // Older runtime without Intl.Segmenter: code points are still much closer
    // to correct than UTF-16 units.
    return [...text].length;
  }
};

/** Truncate to N graphemes without splitting one in half. */
const truncateGraphemes = (text, max) => {
  if (typeof text !== 'string') return '';
  if (graphemeLength(text) <= max) return text;
  try {
    if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let out = '';
    let count = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (count >= max) break;
      out += segment;
      count += 1;
    }
    return out;
  } catch (error) {
    return [...text].slice(0, max).join('');
  }
};

module.exports = {
  hotScore,
  confidenceScore,
  controversyScore,
  risingScore,
  scoresFor,
  voteDelta,
  karmaDelta,
  graphemeLength,
  truncateGraphemes,
};
