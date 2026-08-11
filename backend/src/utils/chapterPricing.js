// Chapter price resolution.
//
// Pure functions over already-loaded documents so the whole chain is testable
// without a database and can be run over a novel's chapters in a loop to build
// the admin pricing preview.
//
// Precedence, highest first:
//   1. chapter.priceCredits          when accessType is 'paid'
//   2. highest-priority PricingRule  that matches
//   3. novel.monetization            when the novel overrides
//   4. global default
//
// Every result carries the reason that won, so the admin preview can say
// "10 credits — from rule: first 20 free" instead of leaving admins guessing.

const {
  CHAPTER_ACCESS_TYPES,
  PRICE_REASONS,
  PRICING_RULE_SCOPES,
  PRICING_RULE_MODES,
} = require('../config/constants');

const DAY_MS = 24 * 60 * 60 * 1000;

const toPlain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : value || {});

/** A novel's own monetization block only applies when the admin ticked override. */
/**
 * Read the monetization fields off an admin chapter payload.
 *
 * Shared by chapter create, update, single upload, zip upload and the bulk
 * re-price endpoint, so a chapter cannot be priced through one door and not
 * another. Values arrive as strings from multipart form posts, hence the
 * coercion.
 *
 * A field being absent means "leave it alone"; an explicit null or empty
 * string means "clear it back to inherit". Conflating those two would make it
 * impossible to ever un-set a price once one had been given.
 */
const readChapterPricing = (body = {}) => {
  const errors = [];
  const updates = {};

  const clearing = (value) => value === null || value === '' || value === 'null';

  if (body.accessType !== undefined) {
    const value = String(body.accessType);
    if (!Object.values(CHAPTER_ACCESS_TYPES).includes(value)) {
      errors.push(`accessType must be one of ${Object.values(CHAPTER_ACCESS_TYPES).join(', ')}`);
    } else {
      updates.accessType = value;
    }
  }

  for (const field of ['priceCredits', 'freeAfterDays']) {
    if (body[field] === undefined) continue;
    if (clearing(body[field])) {
      updates[field] = null;
      continue;
    }
    const number = Number(body[field]);
    if (!Number.isInteger(number) || number < 0) {
      errors.push(`${field} must be a whole number of 0 or more`);
    } else {
      updates[field] = number;
    }
  }

  if (body.earlyAccessUntil !== undefined) {
    if (clearing(body.earlyAccessUntil)) {
      updates.earlyAccessUntil = null;
    } else {
      const date = new Date(body.earlyAccessUntil);
      if (Number.isNaN(date.getTime())) errors.push('earlyAccessUntil must be a valid date');
      else updates.earlyAccessUntil = date;
    }
  }

  // Marked paid but priced at zero is a contradiction that would quietly give
  // the chapter away. Say so rather than guessing which half the admin meant.
  if (updates.accessType === CHAPTER_ACCESS_TYPES.PAID && updates.priceCredits === 0) {
    errors.push('A paid chapter cannot cost 0 credits — set access to Free instead');
  }

  return { updates, errors };
};

const resolveNovelMonetization = (novel) => {
  const config = toPlain(novel && novel.monetization);
  return config.override ? config : null;
};

/**
 * Effective chapter number for free-quota purposes.
 *
 * With the safety setting on, this follows the number the chapter was created
 * with, so reordering a novel cannot silently move a paid chapter into the free
 * range (or push a free one out of it).
 */
const effectiveNumber = (chapter, freezeByOriginal) => {
  if (freezeByOriginal && Number.isFinite(chapter.originalNumber)) return chapter.originalNumber;
  return chapter.number;
};

const ageInDays = (chapter, now) => {
  const published = chapter.publishedAt || chapter.createdAt;
  if (!published) return 0;
  return Math.floor((now.getTime() - new Date(published).getTime()) / DAY_MS);
};

const withinWindow = (value, from, to) => {
  if (from !== undefined && from !== null && value < from) return false;
  if (to !== undefined && to !== null && value > to) return false;
  return true;
};

/** Does this rule apply to this novel at all? */
const ruleMatchesScope = (rule, novel) => {
  if (rule.scope === PRICING_RULE_SCOPES.GLOBAL) return true;
  if (rule.scope === PRICING_RULE_SCOPES.NOVEL) {
    return Boolean(rule.novel) && String(rule.novel) === String(novel._id);
  }
  if (rule.scope === PRICING_RULE_SCOPES.GENRE) {
    const genres = novel.genres || [];
    return (rule.genres || []).some((genre) => genres.includes(genre));
  }
  if (rule.scope === PRICING_RULE_SCOPES.NOVEL_STATUS) {
    return Boolean(rule.novelStatus) && rule.novelStatus === novel.status;
  }
  return false;
};

const ruleMatchesChapter = (rule, { number, ageDays, wordCount }) => {
  const c = toPlain(rule.conditions);
  if (!withinWindow(number, c.chapterNumberFrom, c.chapterNumberTo)) return false;
  if (!withinWindow(ageDays, c.chapterAgeDaysFrom, c.chapterAgeDaysTo)) return false;
  if (!withinWindow(wordCount || 0, c.wordCountFrom, c.wordCountTo)) return false;
  return true;
};

const ruleIsLive = (rule, now) => {
  if (!rule.active) return false;
  if (rule.validFrom && now < new Date(rule.validFrom)) return false;
  if (rule.validUntil && now > new Date(rule.validUntil)) return false;
  return true;
};

/**
 * Highest-priority live rule matching this chapter. Ties break on the most
 * recently updated rule, so the last edit wins predictably.
 */
const findMatchingRule = (rules, novel, chapterFacts, now) =>
  (rules || [])
    .filter((rule) => ruleIsLive(rule, now) && ruleMatchesScope(rule, novel) && ruleMatchesChapter(rule, chapterFacts))
    .sort((a, b) => b.priority - a.priority || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;

const applyRule = (rule, basePrice) => {
  const action = toPlain(rule.action);
  if (action.mode === PRICING_RULE_MODES.FREE) return 0;
  if (action.mode === PRICING_RULE_MODES.SET) return action.priceCredits || 0;
  if (action.mode === PRICING_RULE_MODES.MULTIPLY) return Math.round(basePrice * (action.multiplier || 1));
  if (action.mode === PRICING_RULE_MODES.ADD) return Math.max(0, basePrice + (action.delta || 0));
  return basePrice;
};

const roundTo = (price, step) => {
  if (!step || step <= 1) return price;
  return Math.round(price / step) * step;
};

/**
 * Resolve what a chapter costs, ignoring ownership and subscriptions — those
 * are decided by the access service, which calls this only when it needs a price.
 *
 * @returns {{ priceCredits: number, reason: string, ruleId: ?string, free: boolean }}
 */
const resolveChapterPrice = ({ novel, chapter, rules = [], config, now = new Date() }) => {
  const novelConfig = resolveNovelMonetization(novel);

  if (novelConfig && novelConfig.monetized === false) {
    return { priceCredits: 0, reason: PRICE_REASONS.CHAPTER_FREE, ruleId: null, free: true };
  }

  if (chapter.accessType === CHAPTER_ACCESS_TYPES.FREE) {
    return { priceCredits: 0, reason: PRICE_REASONS.CHAPTER_FREE, ruleId: null, free: true };
  }

  const number = effectiveNumber(chapter, config.freezeFreeCountByOriginalNumber);
  const freeCount = novelConfig ? novelConfig.freeChapterCount : config.defaultFreeChapterCount;
  if (number <= (freeCount || 0)) {
    return { priceCredits: 0, reason: PRICE_REASONS.FREE_QUOTA, ruleId: null, free: true };
  }

  // Timed release: a chapter that has aged past the window falls free. An
  // explicit chapter value of null means "inherit"; 0 means "never".
  const freeAfterDays =
    chapter.freeAfterDays !== null && chapter.freeAfterDays !== undefined
      ? chapter.freeAfterDays
      : novelConfig
        ? novelConfig.freeAfterDays
        : config.defaultFreeAfterDays;
  const ageDays = ageInDays(chapter, now);
  if (freeAfterDays > 0 && ageDays >= freeAfterDays) {
    return { priceCredits: 0, reason: PRICE_REASONS.TIMED_RELEASE, ruleId: null, free: true };
  }

  const facts = { number: chapter.number, ageDays, wordCount: chapter.wordCount };

  // Base price before rules, so multiply/add rules have something to act on.
  let base;
  let reason;
  if (chapter.accessType === CHAPTER_ACCESS_TYPES.PAID && Number.isFinite(chapter.priceCredits)) {
    base = chapter.priceCredits;
    reason = PRICE_REASONS.CHAPTER_OVERRIDE;
  } else if (novelConfig) {
    base = novelConfig.defaultChapterPriceCredits || 0;
    reason = PRICE_REASONS.NOVEL_DEFAULT;
  } else {
    base = config.defaultChapterCredits || 0;
    reason = PRICE_REASONS.GLOBAL_DEFAULT;
  }

  // An explicit per-chapter price is the admin being deliberate about this one
  // chapter, so it outranks a rule that merely matched it.
  let price = base;
  let ruleId = null;
  if (reason !== PRICE_REASONS.CHAPTER_OVERRIDE) {
    const rule = findMatchingRule(rules, novel, facts, now);
    if (rule) {
      price = applyRule(rule, base);
      reason = PRICE_REASONS.PRICING_RULE;
      ruleId = String(rule._id);
    }
  }

  price = Math.max(0, roundTo(Math.round(price), config.roundToNearestCredits));

  return {
    priceCredits: price,
    reason: price === 0 ? PRICE_REASONS.CHAPTER_FREE : reason,
    ruleId,
    free: price === 0,
  };
};

/** Bulk discount for a given chapter count, from the applicable tier table. */
const bulkDiscountPct = (count, tiers = []) =>
  (tiers || [])
    .filter((tier) => count >= tier.minChapters)
    .reduce((best, tier) => Math.max(best, tier.discountPct || 0), 0);

module.exports = {
  resolveChapterPrice,
  readChapterPricing,
  resolveNovelMonetization,
  effectiveNumber,
  ageInDays,
  findMatchingRule,
  applyRule,
  bulkDiscountPct,
};
