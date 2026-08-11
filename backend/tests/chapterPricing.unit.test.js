const { resolveChapterPrice, bulkDiscountPct, effectiveNumber } = require('../src/utils/chapterPricing');
const { PRICE_REASONS, CHAPTER_ACCESS_TYPES, PRICING_RULE_MODES } = require('../src/config/constants');

// Pure resolution logic — no database needed.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-08T12:00:00Z');

const config = {
  defaultChapterCredits: 10,
  defaultFreeChapterCount: 5,
  defaultFreeAfterDays: 0,
  roundToNearestCredits: 1,
  freezeFreeCountByOriginalNumber: true,
};

const novel = (overrides = {}) => ({
  _id: 'novel1',
  genres: ['Fantasy'],
  status: 'ongoing',
  monetization: { override: false },
  ...overrides,
});

const chapter = (overrides = {}) => ({
  _id: 'ch',
  number: 10,
  accessType: CHAPTER_ACCESS_TYPES.INHERIT,
  priceCredits: null,
  freeAfterDays: null,
  wordCount: 2000,
  publishedAt: new Date(NOW.getTime() - 10 * DAY),
  ...overrides,
});

const rule = (overrides = {}) => ({
  _id: 'r1',
  active: true,
  priority: 0,
  scope: 'global',
  conditions: {},
  action: { mode: PRICING_RULE_MODES.SET, priceCredits: 7 },
  updatedAt: new Date(),
  ...overrides,
});

const price = (args) => resolveChapterPrice({ config, now: NOW, ...args });

describe('price resolution chain', () => {
  it('falls back to the global default', () => {
    const result = price({ novel: novel(), chapter: chapter() });
    expect(result).toMatchObject({ priceCredits: 10, reason: PRICE_REASONS.GLOBAL_DEFAULT, free: false });
  });

  it('makes the first N chapters free', () => {
    expect(price({ novel: novel(), chapter: chapter({ number: 5 }) })).toMatchObject({
      priceCredits: 0,
      reason: PRICE_REASONS.FREE_QUOTA,
    });
    expect(price({ novel: novel(), chapter: chapter({ number: 6 }) }).free).toBe(false);
  });

  it('honours an explicit free chapter', () => {
    const result = price({ novel: novel(), chapter: chapter({ accessType: CHAPTER_ACCESS_TYPES.FREE }) });
    expect(result).toMatchObject({ priceCredits: 0, reason: PRICE_REASONS.CHAPTER_FREE });
  });

  it('lets a novel override the global default', () => {
    const n = novel({ monetization: { override: true, freeChapterCount: 2, defaultChapterPriceCredits: 25 } });
    expect(price({ novel: n, chapter: chapter() })).toMatchObject({
      priceCredits: 25,
      reason: PRICE_REASONS.NOVEL_DEFAULT,
    });
  });

  it('ignores a novel block that is not marked override', () => {
    const n = novel({ monetization: { override: false, defaultChapterPriceCredits: 999 } });
    expect(price({ novel: n, chapter: chapter() }).priceCredits).toBe(10);
  });

  it('treats an unmonetized novel as free', () => {
    const n = novel({ monetization: { override: true, monetized: false } });
    expect(price({ novel: n, chapter: chapter() }).free).toBe(true);
  });

  it('puts a chapter override above a matching rule', () => {
    const result = price({
      novel: novel(),
      chapter: chapter({ accessType: CHAPTER_ACCESS_TYPES.PAID, priceCredits: 42 }),
      rules: [rule({ action: { mode: PRICING_RULE_MODES.SET, priceCredits: 3 } })],
    });
    expect(result).toMatchObject({ priceCredits: 42, reason: PRICE_REASONS.CHAPTER_OVERRIDE });
  });

  it('puts a rule above the novel and global defaults', () => {
    const result = price({ novel: novel(), chapter: chapter(), rules: [rule()] });
    expect(result).toMatchObject({ priceCredits: 7, reason: PRICE_REASONS.PRICING_RULE, ruleId: 'r1' });
  });

  it('picks the highest-priority rule', () => {
    const result = price({
      novel: novel(),
      chapter: chapter(),
      rules: [
        rule({ _id: 'low', priority: 1, action: { mode: PRICING_RULE_MODES.SET, priceCredits: 3 } }),
        rule({ _id: 'high', priority: 9, action: { mode: PRICING_RULE_MODES.SET, priceCredits: 8 } }),
      ],
    });
    expect(result.priceCredits).toBe(8);
    expect(result.ruleId).toBe('high');
  });

  describe('rule matching', () => {
    it('respects a chapter number window', () => {
      const r = rule({ conditions: { chapterNumberFrom: 20, chapterNumberTo: 30 } });
      expect(price({ novel: novel(), chapter: chapter({ number: 10 }), rules: [r] }).priceCredits).toBe(10);
      expect(price({ novel: novel(), chapter: chapter({ number: 25 }), rules: [r] }).priceCredits).toBe(7);
    });

    it('respects an age window', () => {
      const r = rule({ conditions: { chapterAgeDaysFrom: 90 } });
      expect(price({ novel: novel(), chapter: chapter(), rules: [r] }).priceCredits).toBe(10);
      const old = chapter({ publishedAt: new Date(NOW.getTime() - 120 * DAY) });
      expect(price({ novel: novel(), chapter: old, rules: [r] }).priceCredits).toBe(7);
    });

    it('respects a word-count window', () => {
      const r = rule({ conditions: { wordCountFrom: 5000 } });
      expect(price({ novel: novel(), chapter: chapter({ wordCount: 2000 }), rules: [r] }).priceCredits).toBe(10);
      expect(price({ novel: novel(), chapter: chapter({ wordCount: 8000 }), rules: [r] }).priceCredits).toBe(7);
    });

    it('scopes to a novel', () => {
      const r = rule({ scope: 'novel', novel: 'other' });
      expect(price({ novel: novel(), chapter: chapter(), rules: [r] }).priceCredits).toBe(10);
      const mine = rule({ scope: 'novel', novel: 'novel1' });
      expect(price({ novel: novel(), chapter: chapter(), rules: [mine] }).priceCredits).toBe(7);
    });

    it('scopes to a genre', () => {
      expect(price({ novel: novel(), chapter: chapter(), rules: [rule({ scope: 'genre', genres: ['Horror'] })] }).priceCredits).toBe(10);
      expect(price({ novel: novel(), chapter: chapter(), rules: [rule({ scope: 'genre', genres: ['Fantasy'] })] }).priceCredits).toBe(7);
    });

    it('ignores an inactive or out-of-window rule', () => {
      expect(price({ novel: novel(), chapter: chapter(), rules: [rule({ active: false })] }).priceCredits).toBe(10);
      const future = rule({ validFrom: new Date(NOW.getTime() + DAY) });
      expect(price({ novel: novel(), chapter: chapter(), rules: [future] }).priceCredits).toBe(10);
      const expired = rule({ validUntil: new Date(NOW.getTime() - DAY) });
      expect(price({ novel: novel(), chapter: chapter(), rules: [expired] }).priceCredits).toBe(10);
    });

    it('supports multiply, add and free actions', () => {
      const mult = rule({ action: { mode: PRICING_RULE_MODES.MULTIPLY, multiplier: 2 } });
      expect(price({ novel: novel(), chapter: chapter(), rules: [mult] }).priceCredits).toBe(20);

      const add = rule({ action: { mode: PRICING_RULE_MODES.ADD, delta: -4 } });
      expect(price({ novel: novel(), chapter: chapter(), rules: [add] }).priceCredits).toBe(6);

      const free = rule({ action: { mode: PRICING_RULE_MODES.FREE } });
      expect(price({ novel: novel(), chapter: chapter(), rules: [free] })).toMatchObject({ free: true });
    });

    it('never produces a negative price', () => {
      const add = rule({ action: { mode: PRICING_RULE_MODES.ADD, delta: -999 } });
      expect(price({ novel: novel(), chapter: chapter(), rules: [add] }).priceCredits).toBe(0);
    });
  });

  describe('timed release', () => {
    it('frees a chapter once it ages past the window', () => {
      const cfg = { ...config, defaultFreeAfterDays: 30 };
      const fresh = resolveChapterPrice({ novel: novel(), chapter: chapter(), config: cfg, now: NOW });
      expect(fresh.free).toBe(false);

      const old = chapter({ publishedAt: new Date(NOW.getTime() - 45 * DAY) });
      const aged = resolveChapterPrice({ novel: novel(), chapter: old, config: cfg, now: NOW });
      expect(aged).toMatchObject({ free: true, reason: PRICE_REASONS.TIMED_RELEASE });
    });

    it('lets a chapter opt out with 0 while the site default is on', () => {
      const cfg = { ...config, defaultFreeAfterDays: 30 };
      const never = chapter({ freeAfterDays: 0, publishedAt: new Date(NOW.getTime() - 400 * DAY) });
      expect(resolveChapterPrice({ novel: novel(), chapter: never, config: cfg, now: NOW }).free).toBe(false);
    });

    it('uses publishedAt, not createdAt', () => {
      const cfg = { ...config, defaultFreeAfterDays: 30 };
      // Drafted long ago, published yesterday: must still be paid.
      const late = {
        ...chapter(),
        createdAt: new Date(NOW.getTime() - 200 * DAY),
        publishedAt: new Date(NOW.getTime() - 1 * DAY),
      };
      expect(resolveChapterPrice({ novel: novel(), chapter: late, config: cfg, now: NOW }).free).toBe(false);
    });
  });

  describe('renumber safety', () => {
    it('uses the original number for the free quota when frozen', () => {
      // Paid chapter 12 gets reordered to position 3, inside the free range.
      const moved = chapter({ number: 3, originalNumber: 12 });
      expect(price({ novel: novel(), chapter: moved }).free).toBe(false);
    });

    it('follows the current number when the freeze is off', () => {
      const moved = chapter({ number: 3, originalNumber: 12 });
      const cfg = { ...config, freezeFreeCountByOriginalNumber: false };
      expect(resolveChapterPrice({ novel: novel(), chapter: moved, config: cfg, now: NOW }).free).toBe(true);
    });

    it('effectiveNumber falls back when no original is recorded', () => {
      expect(effectiveNumber({ number: 7 }, true)).toBe(7);
      expect(effectiveNumber({ number: 7, originalNumber: 3 }, true)).toBe(3);
      expect(effectiveNumber({ number: 7, originalNumber: 3 }, false)).toBe(7);
    });
  });

  it('rounds to the configured step', () => {
    const cfg = { ...config, defaultChapterCredits: 13, roundToNearestCredits: 5 };
    expect(resolveChapterPrice({ novel: novel(), chapter: chapter(), config: cfg, now: NOW }).priceCredits).toBe(15);
  });
});

describe('bulk discounts', () => {
  const tiers = [
    { minChapters: 5, discountPct: 5 },
    { minChapters: 10, discountPct: 10 },
    { minChapters: 25, discountPct: 15 },
  ];

  it('picks the best qualifying tier', () => {
    expect(bulkDiscountPct(3, tiers)).toBe(0);
    expect(bulkDiscountPct(5, tiers)).toBe(5);
    expect(bulkDiscountPct(12, tiers)).toBe(10);
    expect(bulkDiscountPct(100, tiers)).toBe(15);
  });

  it('handles an empty tier table', () => {
    expect(bulkDiscountPct(50, [])).toBe(0);
    expect(bulkDiscountPct(50)).toBe(0);
  });
});
