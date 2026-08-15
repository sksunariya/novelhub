// The superadmin's paid-content bypass.
//
// The owner reads everything without spending. What matters is that the bypass
// is a *bypass* and not a purchase: no ChapterAccess row, no wallet debit, no
// revenue attributed. Getting that wrong would quietly corrupt the ledger every
// operator has to reconcile, which is worse than the paywall not lifting at all.
//
// Pure: pricing config comes from the settings service, stubbed here, and no
// path under test reaches the database.

jest.mock('../src/services/settingsService', () => {
  const registry = require('../src/config/settingsRegistry');
  const values = { ...registry.defaults(), 'monetization.enabled': true };
  const reset = () => {
    Object.keys(values).forEach((key) => delete values[key]);
    Object.assign(values, registry.defaults(), { 'monetization.enabled': true });
  };
  return {
    __values: values,
    __set: (patch) => Object.assign(values, patch),
    __reset: reset,
    snapshot: async () => ({
      get: (key) => values[key],
      all: () => ({ ...values }),
      section: () => ({}),
    }),
    clearCache: reset,
    get: async (key) => values[key],
    getMany: async (keys) => keys.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {}),
    update: async () => ({}),
    getForAdmin: async () => ({}),
  };
});

// Any of these being touched means the bypass is buying something rather than
// stepping around the purchase, which is the failure this suite exists to catch.
jest.mock('../src/models/PricingRule', () => ({ find: () => ({ sort: async () => [] }) }));
jest.mock('../src/models/ChapterAccess', () => ({
  find: () => ({ select: async () => [] }),
  findOne: async () => null,
  create: jest.fn(async () => {
    throw new Error('ChapterAccess.create must not be called for a staff bypass');
  }),
}));
jest.mock('../src/services/creditService', () => ({
  getBalance: async () => 0,
  debit: jest.fn(async () => {
    throw new Error('creditService.debit must not be called for a staff bypass');
  }),
}));
jest.mock('../src/services/subscriptionService', () => ({ activeFor: async () => null }));

const accessService = require('../src/services/accessService');
const creditService = require('../src/services/creditService');
const ChapterAccess = require('../src/models/ChapterAccess');
const { ROLES, PRICE_REASONS } = require('../src/config/constants');

const superAdmin = { _id: 'super-1', role: ROLES.SUPERADMIN };
const admin = { _id: 'admin-1', role: ROLES.ADMIN };

const novel = { _id: 'novel-1', monetization: {} };
const pricedChapter = { _id: 'chapter-1', number: 12, priceCredits: 50 };
// Priced AND inside a release window that would lock out a paying reader.
const embargoedChapter = {
  _id: 'chapter-2',
  number: 13,
  priceCredits: 50,
  earlyAccessUntil: new Date(Date.now() + 86400000),
};

beforeEach(() => jest.clearAllMocks());

describe('resolveAccess', () => {
  it('unlocks a priced chapter for the owner tier, at zero, with its own reason', async () => {
    const access = await accessService.resolveAccess({ novel, chapter: pricedChapter, user: superAdmin });
    expect(access.locked).toBe(false);
    expect(access.priceCredits).toBe(0);
    expect(access.staffBypass).toBe(true);
    // Its own reason rather than reusing monetization_off, so the bypass is
    // legible in read logs and never mistaken for a pricing bug.
    expect(access.reason).toBe(PRICE_REASONS.STAFF_BYPASS);
  });

  it('ignores an early-access window the owner configured themselves', async () => {
    const access = await accessService.resolveAccess({ novel, chapter: embargoedChapter, user: superAdmin });
    expect(access.locked).toBe(false);
    expect(access.availableAt).toBeUndefined();
  });

  it('does not extend the bypass to an ordinary admin', async () => {
    const access = await accessService.resolveAccess({ novel, chapter: pricedChapter, user: admin });
    expect(access.locked).toBe(true);
    expect(access.priceCredits).toBeGreaterThan(0);
  });

  it('does not mark the chapter as owned — nothing was bought', async () => {
    const access = await accessService.resolveAccess({ novel, chapter: pricedChapter, user: superAdmin });
    expect(access.owned).toBeUndefined();
  });
});

describe('resolveNovelChapters', () => {
  it('quotes the list at zero, so it agrees with what opening a chapter does', async () => {
    const rows = await accessService.resolveNovelChapters({
      novel,
      chapters: [pricedChapter, embargoedChapter],
      user: superAdmin,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.locked === false && row.priceCredits === 0)).toBe(true);
    expect(rows.every((row) => row.owned === false)).toBe(true);
    expect(rows.every((row) => row.chapter)).toBe(true);
  });
});

describe('unlock', () => {
  it('is a no-op rather than an error, so a stale Unlock button still works', async () => {
    const result = await accessService.unlockChapter({ user: superAdmin, novel, chapter: pricedChapter });
    expect(result.alreadyOwned).toBe(true);
    expect(result.access).toBeNull();
  });

  it('writes no access row and debits no credits', async () => {
    await accessService.unlockChapter({ user: superAdmin, novel, chapter: pricedChapter });
    await accessService.unlockChapters({ user: superAdmin, novel, chapters: [pricedChapter] });
    expect(ChapterAccess.create).not.toHaveBeenCalled();
    expect(creditService.debit).not.toHaveBeenCalled();
  });

  it('returns the same shape as a real bulk unlock', async () => {
    // The controller spreads this straight into the HTTP response, so a
    // different shape here hands the client an array where it expects a count.
    const result = await accessService.unlockChapters({
      user: superAdmin,
      novel,
      chapters: [pricedChapter, embargoedChapter],
    });
    expect(typeof result.unlocked).toBe('number');
    expect(result.unlocked).toBe(0);
    expect(result.spent).toBe(0);
    expect(result.listTotal).toBe(0);
    expect(result.discountPct).toBe(0);
  });
});

describe('quoteBulk', () => {
  it('quotes nothing payable, and does not round an empty basket up to 1 credit', async () => {
    const quote = await accessService.quoteBulk({
      novel,
      chapters: [pricedChapter, embargoedChapter],
      user: superAdmin,
    });
    expect(quote.chapterCount).toBe(0);
    expect(quote.total).toBe(0);
    expect(quote.listTotal).toBe(0);
  });
});
