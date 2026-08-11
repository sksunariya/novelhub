// The pricing helpers that chapterPricing.test.js exercises only indirectly
// through resolveChapterPrice. Tested directly so a regression names itself.

const {
  readChapterPricing,
  resolveNovelMonetization,
  effectiveNumber,
  ageInDays,
  findMatchingRule,
  applyRule,
  bulkDiscountPct,
} = require('../src/utils/chapterPricing');
const { PRICING_RULE_MODES } = require('../src/config/constants');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-08T12:00:00Z');

describe('resolveNovelMonetization', () => {
  it('returns the block only when the novel opts in', () => {
    expect(resolveNovelMonetization({ monetization: { override: true, freeChapterCount: 5 } }))
      .toMatchObject({ freeChapterCount: 5 });
  });

  it('returns null when override is off, so global defaults win', () => {
    expect(resolveNovelMonetization({ monetization: { override: false, freeChapterCount: 99 } })).toBeNull();
  });

  it('handles a novel with no monetization block at all', () => {
    expect(resolveNovelMonetization({})).toBeNull();
    expect(resolveNovelMonetization(null)).toBeNull();
  });

  it('unwraps a Mongoose subdocument', () => {
    const doc = { monetization: { toObject: () => ({ override: true, freeChapterCount: 3 }) } };
    expect(resolveNovelMonetization(doc)).toMatchObject({ freeChapterCount: 3 });
  });
});

describe('effectiveNumber', () => {
  it('prefers the original number when the freeze is on', () => {
    expect(effectiveNumber({ number: 3, originalNumber: 12 }, true)).toBe(12);
  });

  it('uses the current number when the freeze is off', () => {
    expect(effectiveNumber({ number: 3, originalNumber: 12 }, false)).toBe(3);
  });

  it('falls back when no original was recorded', () => {
    expect(effectiveNumber({ number: 3 }, true)).toBe(3);
    expect(effectiveNumber({ number: 3, originalNumber: null }, true)).toBe(3);
  });

  it('treats chapter zero as a real number rather than missing', () => {
    expect(effectiveNumber({ number: 5, originalNumber: 0 }, true)).toBe(0);
  });
});

describe('ageInDays', () => {
  it('measures from publishedAt', () => {
    expect(ageInDays({ publishedAt: new Date(NOW.getTime() - 10 * DAY) }, NOW)).toBe(10);
  });

  it('falls back to createdAt for chapters predating publishedAt tracking', () => {
    expect(ageInDays({ createdAt: new Date(NOW.getTime() - 4 * DAY) }, NOW)).toBe(4);
  });

  it('prefers publishedAt over createdAt', () => {
    const chapter = {
      createdAt: new Date(NOW.getTime() - 200 * DAY),
      publishedAt: new Date(NOW.getTime() - 1 * DAY),
    };
    expect(ageInDays(chapter, NOW)).toBe(1);
  });

  it('returns zero when neither date exists', () => {
    expect(ageInDays({}, NOW)).toBe(0);
  });

  it('floors partial days', () => {
    expect(ageInDays({ publishedAt: new Date(NOW.getTime() - (DAY + 3600e3)) }, NOW)).toBe(1);
  });

  it('accepts a date string', () => {
    expect(ageInDays({ publishedAt: '2026-08-01T12:00:00Z' }, NOW)).toBe(7);
  });
});

describe('applyRule', () => {
  const rule = (action) => ({ action });

  it('sets an absolute price', () => {
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.SET, priceCredits: 7 }), 10)).toBe(7);
  });

  it('multiplies and rounds', () => {
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.MULTIPLY, multiplier: 0.5 }), 10)).toBe(5);
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.MULTIPLY, multiplier: 0.33 }), 10)).toBe(3);
  });

  it('adds and subtracts, never below zero', () => {
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.ADD, delta: 5 }), 10)).toBe(15);
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.ADD, delta: -4 }), 10)).toBe(6);
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.ADD, delta: -999 }), 10)).toBe(0);
  });

  it('makes a chapter free', () => {
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.FREE }), 10)).toBe(0);
  });

  it('defaults a missing multiplier or delta to a no-op', () => {
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.MULTIPLY }), 10)).toBe(10);
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.ADD }), 10)).toBe(10);
  });

  it('leaves the price alone for an unknown mode', () => {
    expect(applyRule(rule({ mode: 'nonsense' }), 10)).toBe(10);
  });

  it('treats a missing priceCredits on set as free', () => {
    expect(applyRule(rule({ mode: PRICING_RULE_MODES.SET }), 10)).toBe(0);
  });
});

describe('findMatchingRule', () => {
  const novel = { _id: 'n1', genres: ['Fantasy', 'Action'], status: 'ongoing' };
  const facts = { number: 15, ageDays: 30, wordCount: 3000 };
  const rule = (over = {}) => ({
    _id: 'r',
    active: true,
    priority: 0,
    scope: 'global',
    conditions: {},
    action: { mode: 'set', priceCredits: 5 },
    updatedAt: new Date('2026-01-01'),
    ...over,
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingRule([], novel, facts, NOW)).toBeNull();
    expect(findMatchingRule(null, novel, facts, NOW)).toBeNull();
  });

  it('picks the highest priority', () => {
    const winner = findMatchingRule(
      [rule({ _id: 'low', priority: 1 }), rule({ _id: 'high', priority: 5 }), rule({ _id: 'mid', priority: 3 })],
      novel, facts, NOW
    );
    expect(winner._id).toBe('high');
  });

  it('breaks a priority tie on the most recently updated rule', () => {
    const winner = findMatchingRule(
      [
        rule({ _id: 'older', priority: 5, updatedAt: new Date('2026-01-01') }),
        rule({ _id: 'newer', priority: 5, updatedAt: new Date('2026-06-01') }),
      ],
      novel, facts, NOW
    );
    expect(winner._id).toBe('newer');
  });

  it('skips inactive rules', () => {
    expect(findMatchingRule([rule({ active: false })], novel, facts, NOW)).toBeNull();
  });

  it('respects the scheduled window at both ends', () => {
    expect(findMatchingRule([rule({ validFrom: new Date(NOW.getTime() + DAY) })], novel, facts, NOW)).toBeNull();
    expect(findMatchingRule([rule({ validUntil: new Date(NOW.getTime() - DAY) })], novel, facts, NOW)).toBeNull();
    const live = rule({ validFrom: new Date(NOW.getTime() - DAY), validUntil: new Date(NOW.getTime() + DAY) });
    expect(findMatchingRule([live], novel, facts, NOW)).not.toBeNull();
  });

  describe('scope', () => {
    it('matches the right novel only', () => {
      expect(findMatchingRule([rule({ scope: 'novel', novel: 'other' })], novel, facts, NOW)).toBeNull();
      expect(findMatchingRule([rule({ scope: 'novel', novel: 'n1' })], novel, facts, NOW)).not.toBeNull();
    });

    it('requires a novel id for novel scope', () => {
      expect(findMatchingRule([rule({ scope: 'novel' })], novel, facts, NOW)).toBeNull();
    });

    it('matches any overlapping genre', () => {
      expect(findMatchingRule([rule({ scope: 'genre', genres: ['Horror'] })], novel, facts, NOW)).toBeNull();
      expect(findMatchingRule([rule({ scope: 'genre', genres: ['Horror', 'Action'] })], novel, facts, NOW)).not.toBeNull();
    });

    it('matches novel status', () => {
      expect(findMatchingRule([rule({ scope: 'novel_status', novelStatus: 'completed' })], novel, facts, NOW)).toBeNull();
      expect(findMatchingRule([rule({ scope: 'novel_status', novelStatus: 'ongoing' })], novel, facts, NOW)).not.toBeNull();
    });

    it('rejects an unknown scope rather than matching everything', () => {
      expect(findMatchingRule([rule({ scope: 'galaxy' })], novel, facts, NOW)).toBeNull();
    });
  });

  describe('conditions', () => {
    const matches = (conditions, f = facts) => Boolean(findMatchingRule([rule({ conditions })], novel, f, NOW));

    it('applies an inclusive chapter number range', () => {
      expect(matches({ chapterNumberFrom: 15, chapterNumberTo: 15 })).toBe(true);
      expect(matches({ chapterNumberFrom: 16 })).toBe(false);
      expect(matches({ chapterNumberTo: 14 })).toBe(false);
    });

    it('applies an open-ended range', () => {
      expect(matches({ chapterNumberFrom: 10 })).toBe(true);
      expect(matches({ chapterNumberTo: 20 })).toBe(true);
    });

    it('applies an age range', () => {
      expect(matches({ chapterAgeDaysFrom: 30 })).toBe(true);
      expect(matches({ chapterAgeDaysFrom: 31 })).toBe(false);
      expect(matches({ chapterAgeDaysTo: 29 })).toBe(false);
    });

    it('applies a word count range and treats a missing count as zero', () => {
      expect(matches({ wordCountFrom: 3000 })).toBe(true);
      expect(matches({ wordCountFrom: 3001 })).toBe(false);
      expect(matches({ wordCountFrom: 1 }, { ...facts, wordCount: undefined })).toBe(false);
    });

    it('requires every condition to hold', () => {
      expect(matches({ chapterNumberFrom: 10, wordCountFrom: 9999 })).toBe(false);
      expect(matches({ chapterNumberFrom: 10, wordCountFrom: 100 })).toBe(true);
    });
  });
});

describe('bulkDiscountPct', () => {
  const tiers = [
    { minChapters: 5, discountPct: 5 },
    { minChapters: 10, discountPct: 10 },
    { minChapters: 25, discountPct: 15 },
  ];

  it('takes the best qualifying tier', () => {
    expect(bulkDiscountPct(4, tiers)).toBe(0);
    expect(bulkDiscountPct(5, tiers)).toBe(5);
    expect(bulkDiscountPct(24, tiers)).toBe(10);
    expect(bulkDiscountPct(25, tiers)).toBe(15);
  });

  it('is not confused by tiers listed out of order', () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(bulkDiscountPct(12, shuffled)).toBe(10);
  });

  it('handles missing or empty tier tables', () => {
    expect(bulkDiscountPct(50, [])).toBe(0);
    expect(bulkDiscountPct(50, null)).toBe(0);
    expect(bulkDiscountPct(50)).toBe(0);
  });

  it('treats a tier with no discount as zero', () => {
    expect(bulkDiscountPct(10, [{ minChapters: 5 }])).toBe(0);
  });
});

// The admin-input side of pricing. Every write path for a chapter price funnels
// through this one parser, so its edge cases are worth naming directly.
describe('readChapterPricing', () => {
  it('changes nothing when no pricing fields are sent', () => {
    expect(readChapterPricing({}).updates).toEqual({});
    expect(readChapterPricing({ title: 'Unrelated' }).updates).toEqual({});
  });

  it('coerces the strings a multipart form sends', () => {
    expect(readChapterPricing({ accessType: 'paid', priceCredits: '25' }).updates).toEqual({
      accessType: 'paid',
      priceCredits: 25,
    });
  });

  it('distinguishes "leave alone" from "clear back to the default"', () => {
    // Absent and explicitly-null are different intents; conflating them would
    // make an existing price impossible to remove.
    expect(readChapterPricing({}).updates.priceCredits).toBeUndefined();
    for (const cleared of [null, '', 'null']) {
      expect(readChapterPricing({ priceCredits: cleared }).updates).toEqual({ priceCredits: null });
    }
  });

  it('refuses a paid chapter priced at nothing', () => {
    const { errors } = readChapterPricing({ accessType: 'paid', priceCredits: 0 });
    expect(errors[0]).toMatch(/cannot cost 0/i);
  });

  it('rejects prices that are not whole and positive', () => {
    expect(readChapterPricing({ priceCredits: -1 }).errors).toHaveLength(1);
    expect(readChapterPricing({ priceCredits: '2.5' }).errors).toHaveLength(1);
    expect(readChapterPricing({ priceCredits: 'abc' }).errors).toHaveLength(1);
  });

  it('rejects an unknown access type', () => {
    expect(readChapterPricing({ accessType: 'premium' }).errors).toHaveLength(1);
  });

  it('rejects an unparseable early-access date', () => {
    expect(readChapterPricing({ earlyAccessUntil: 'not-a-date' }).errors).toHaveLength(1);
    expect(readChapterPricing({ earlyAccessUntil: '' }).updates).toEqual({ earlyAccessUntil: null });
  });

  it('accepts a valid payload cleanly', () => {
    const { updates, errors } = readChapterPricing({ accessType: 'paid', priceCredits: 5 });
    expect(errors).toEqual([]);
    expect(updates).toEqual({ accessType: 'paid', priceCredits: 5 });
  });
});
