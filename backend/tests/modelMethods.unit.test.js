// Schema statics and methods, exercised without a database.
//
// These are small pure functions that carry the money arithmetic and the
// guards, so they are worth testing directly rather than only through the
// routes that happen to call them.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const mongoose = require('mongoose');
const CreditBucket = require('../src/models/CreditBucket');
const Currency = require('../src/models/Currency');
const ChapterAccess = require('../src/models/ChapterAccess');
const Chapter = require('../src/models/Chapter');
const Order = require('../src/models/Order');
const AppSettings = require('../src/models/AppSettings');
const NotificationTemplate = require('../src/models/NotificationTemplate');
const CreditPack = require('../src/models/CreditPack');

const oid = () => new mongoose.Types.ObjectId();

describe('CreditBucket.costFor', () => {
  it('withdraws cash proportionally to credits taken', () => {
    // $9.99 over 1200 credits: a 10-credit unlock is worth 83,250 micros,
    // not the 100,000 that face value would claim.
    expect(CreditBucket.costFor({ remaining: 1200, remainingCostMicros: 9990000 }, 10)).toBe(83250);
  });

  it('sweeps the exact remainder on the final withdrawal', () => {
    // Integer division would otherwise strand micros in a drained tranche.
    expect(CreditBucket.costFor({ remaining: 7, remainingCostMicros: 12345 }, 7)).toBe(12345);
    expect(CreditBucket.costFor({ remaining: 7, remainingCostMicros: 12345 }, 99)).toBe(12345);
  });

  it('returns zero for a grant tranche', () => {
    expect(CreditBucket.costFor({ remaining: 500, remainingCostMicros: 0 }, 10)).toBe(0);
  });

  it('returns zero for an empty tranche rather than dividing by zero', () => {
    expect(CreditBucket.costFor({ remaining: 0, remainingCostMicros: 0 }, 5)).toBe(0);
    expect(CreditBucket.costFor({ remaining: 0, remainingCostMicros: 100 }, 5)).toBe(100);
  });

  it('never invents or loses micros across a full drain', () => {
    const bucket = { remaining: 1000, remainingCostMicros: 4990000 };
    let taken = 0;
    // Deliberately uneven withdrawals.
    for (const n of [7, 13, 100, 1, 379, 500]) {
      const cost = CreditBucket.costFor(bucket, n);
      taken += cost;
      bucket.remaining -= n;
      bucket.remainingCostMicros -= cost;
    }
    expect(bucket.remaining).toBe(0);
    expect(bucket.remainingCostMicros).toBe(0);
    expect(taken).toBe(4990000);
  });
});

describe('Currency', () => {
  // validateSync deliberately skips middleware, so apply the guards explicitly.
  // Production goes through save(), which runs the same code via pre('validate').
  const build = (attrs) => new Currency(attrs).applyCapabilities();

  it('derives PayPal support from the code, not from admin input', () => {
    expect(build({ code: 'EUR', paypalSupported: false }).paypalSupported).toBe(true);
    expect(build({ code: 'INR', paypalSupported: true }).paypalSupported).toBe(false);
  });

  it('downgrades local settlement for a currency PayPal cannot settle', () => {
    expect(build({ code: 'INR', settlementMode: 'local' }).settlementMode).toBe('usd');
    expect(build({ code: 'EUR', settlementMode: 'local' }).settlementMode).toBe('local');
  });

  it('forces zero decimals on the three zero-decimal currencies', () => {
    ['JPY', 'HUF', 'TWD'].forEach((code) => expect(build({ code, decimals: 2 }).decimals).toBe(0));
    expect(build({ code: 'USD', decimals: 2 }).decimals).toBe(2);
  });

  it('strips charm rounding where there are no minor units to land on', () => {
    expect(build({ code: 'JPY', rounding: 'charm_99' }).rounding).toBe('nearest_int');
    expect(build({ code: 'EUR', rounding: 'charm_99' }).rounding).toBe('charm_99');
  });

  it('uppercases the code', () => {
    expect(build({ code: 'eur' }).code).toBe('EUR');
  });

  describe('deriveCapabilities as a pure function', () => {
    it('corrects an unsupported currency asking for local settlement', () => {
      expect(Currency.deriveCapabilities({ code: 'inr', settlementMode: 'local' })).toMatchObject({
        code: 'INR',
        paypalSupported: false,
        settlementMode: 'usd',
      });
    });

    it('leaves a supported currency alone', () => {
      expect(Currency.deriveCapabilities({ code: 'GBP', settlementMode: 'local' })).toMatchObject({
        paypalSupported: true,
        settlementMode: 'local',
      });
    });

    it('does not mutate its input', () => {
      const input = { code: 'inr', settlementMode: 'local' };
      Currency.deriveCapabilities(input);
      expect(input).toEqual({ code: 'inr', settlementMode: 'local' });
    });

    it('handles an empty input without throwing', () => {
      expect(Currency.deriveCapabilities()).toMatchObject({ paypalSupported: false });
    });
  });

  describe('effectiveRate', () => {
    it('applies the markup to the auto rate', () => {
      expect(build({ code: 'EUR', autoRate: 0.9, markupPct: 10 }).effectiveRate()).toBeCloseTo(0.99, 6);
    });

    it('prefers a pinned manual rate', () => {
      const c = build({ code: 'EUR', autoRate: 0.9, manualRate: 0.8, rateSource: 'manual', markupPct: 0 });
      expect(c.effectiveRate()).toBe(0.8);
    });

    it('returns the bare rate with no markup', () => {
      expect(build({ code: 'EUR', autoRate: 0.92 }).effectiveRate()).toBe(0.92);
    });
  });

  describe('isStale', () => {
    it('treats USD as never stale', () => {
      expect(build({ code: 'USD' }).isStale(1)).toBe(false);
    });

    it('treats a manual rate as never stale', () => {
      expect(build({ code: 'EUR', rateSource: 'manual', manualRate: 0.9 }).isStale(1)).toBe(false);
    });

    it('treats a never-fetched rate as stale', () => {
      expect(build({ code: 'EUR' }).isStale(48)).toBe(true);
    });

    it('compares against the configured window', () => {
      const fresh = build({ code: 'EUR', lastRateAt: new Date(Date.now() - 60 * 60 * 1000) });
      expect(fresh.isStale(48)).toBe(false);
      expect(fresh.isStale(0.5)).toBe(true);
    });
  });
});

describe('ChapterAccess.isLive', () => {
  it('treats a permanent unlock as live', () => {
    expect(new ChapterAccess({ user: oid(), chapter: oid(), novel: oid(), expiresAt: null }).isLive()).toBe(true);
  });

  it('treats an unexpired rental as live', () => {
    const row = new ChapterAccess({
      user: oid(), chapter: oid(), novel: oid(), expiresAt: new Date(Date.now() + 3600e3),
    });
    expect(row.isLive()).toBe(true);
  });

  it('treats a lapsed rental as expired', () => {
    const row = new ChapterAccess({
      user: oid(), chapter: oid(), novel: oid(), expiresAt: new Date(Date.now() - 1000),
    });
    expect(row.isLive()).toBe(false);
  });
});

describe('Chapter', () => {
  it('counts words with markup stripped', () => {
    expect(Chapter.countWords('<p>one two three</p>')).toBe(3);
    expect(Chapter.countWords('<p>a</p><p>b</p>')).toBe(2);
    expect(Chapter.countWords('')).toBe(0);
    expect(Chapter.countWords(null)).toBe(0);
    expect(Chapter.countWords('<div class="x">  spaced   out  </div>')).toBe(2);
  });

  // The publishedAt / originalNumber stamping runs in a pre-save hook, so it is
  // covered against a real save in tests/chapterLifecycle.test.js rather than
  // by invoking Mongoose internals here.
});

describe('Order', () => {
  it('records events as subdocuments, not strings', () => {
    // Declared inline with a `type` key, Mongoose collapses this array to
    // [String] and every log() throws a CastError.
    expect(Order.schema.path('events').casterConstructor.name).toBe('EmbeddedDocument');
  });

  it('appends structured log entries', () => {
    const order = new Order({
      orderNumber: 'NH-2026-0000001', user: oid(), credits: 100, totalCredits: 100,
      baseUsdCents: 999, netUsdCents: 999, chargeCurrency: 'USD', chargeAmountMinor: 999,
    });
    order.log('created', 'client', { packId: 'p1' });
    order.log('captured', 'webhook');
    expect(order.events).toHaveLength(2);
    expect(order.events[0]).toMatchObject({ type: 'created', source: 'client' });
    expect(order.events[0].data.packId).toBe('p1');
    expect(order.events[1].at).toBeInstanceOf(Date);
    expect(order.validateSync()).toBeUndefined();
  });

  it('rejects an unknown event source', () => {
    const order = new Order({
      orderNumber: 'NH-2026-0000002', user: oid(), credits: 1, totalCredits: 1,
      baseUsdCents: 1, netUsdCents: 1, chargeCurrency: 'USD', chargeAmountMinor: 1,
    });
    order.log('x', 'martians');
    expect(order.validateSync()).toBeDefined();
  });
});

describe('AppSettings value store', () => {
  const doc = () => new AppSettings({ singleton: true });

  it('round-trips dotted keys that a Mongoose Map would reject', () => {
    const d = doc();
    d.setValue('credits.perUsd', 250);
    d.setValue('monetization.enabled', true);
    expect(d.getValue('credits.perUsd')).toBe(250);
    expect(d.toObjectMap()).toEqual({ 'credits.perUsd': 250, 'monetization.enabled': true });
    expect(d.validateSync()).toBeUndefined();
  });

  it('overwrites in place rather than appending a duplicate', () => {
    const d = doc();
    d.setValue('credits.perUsd', 250);
    d.setValue('credits.perUsd', 500);
    expect(d.values).toHaveLength(1);
    expect(d.getValue('credits.perUsd')).toBe(500);
  });

  it('reports and removes keys', () => {
    const d = doc();
    d.setValue('a.b', 1);
    expect(d.hasValue('a.b')).toBe(true);
    d.deleteValue('a.b');
    expect(d.hasValue('a.b')).toBe(false);
    expect(d.getValue('a.b')).toBeUndefined();
  });

  it('ignores deleting a key that was never set', () => {
    const d = doc();
    d.deleteValue('nope');
    expect(d.values).toHaveLength(0);
  });

  it('stores structured values intact', () => {
    const d = doc();
    const tiers = [{ minChapters: 5, discountPct: 10 }];
    d.setValue('pricing.bulkDiscountTiers', tiers);
    expect(d.getValue('pricing.bulkDiscountTiers')).toEqual(tiers);
  });
});

describe('NotificationTemplate.render', () => {
  it('substitutes variables', () => {
    expect(NotificationTemplate.render('Hi {{username}}, {{amount}} {{label}}.', {
      username: 'sumit', amount: 50, label: 'credits',
    })).toBe('Hi sumit, 50 credits.');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(NotificationTemplate.render('{{ username }}', { username: 'x' })).toBe('x');
  });

  it('renders unknown or null variables as empty rather than leaking the token', () => {
    expect(NotificationTemplate.render('a{{nope}}b', {})).toBe('ab');
    expect(NotificationTemplate.render('a{{v}}b', { v: null })).toBe('ab');
  });

  it('renders a zero value rather than treating it as missing', () => {
    expect(NotificationTemplate.render('{{balance}} left', { balance: 0 })).toBe('0 left');
  });

  it('handles empty and non-string input', () => {
    expect(NotificationTemplate.render('', {})).toBe('');
    expect(NotificationTemplate.render(null, {})).toBe('');
    expect(NotificationTemplate.render(undefined)).toBe('');
  });

  it('leaves text with no placeholders untouched', () => {
    expect(NotificationTemplate.render('plain text', { a: 1 })).toBe('plain text');
  });
});

describe('CreditPack', () => {
  const pack = (attrs = {}) =>
    new CreditPack({ name: 'P', slug: 'p', credits: 1000, priceUsdCents: 999, ...attrs });

  it('totals credits including the bonus', () => {
    expect(pack({ bonusCredits: 200 }).totalCredits).toBe(1200);
    expect(pack().totalCredits).toBe(1000);
  });

  it('is unavailable when inactive', () => {
    expect(pack({ active: false }).isAvailable()).toBe(false);
  });

  it('respects a scheduled availability window', () => {
    const now = new Date('2026-06-15');
    expect(pack({ availableFrom: new Date('2026-07-01') }).isAvailable(now)).toBe(false);
    expect(pack({ availableUntil: new Date('2026-06-01') }).isAvailable(now)).toBe(false);
    expect(pack({ availableFrom: new Date('2026-06-01'), availableUntil: new Date('2026-07-01') }).isAvailable(now)).toBe(true);
  });

  it('sells out when stock is exhausted', () => {
    expect(pack({ limits: { globalStock: 10, globalSold: 10 } }).isAvailable()).toBe(false);
    expect(pack({ limits: { globalStock: 10, globalSold: 9 } }).isAvailable()).toBe(true);
    // Zero stock means unlimited, not sold out.
    expect(pack({ limits: { globalStock: 0, globalSold: 500 } }).isAvailable()).toBe(true);
  });

  describe('allowsCountry', () => {
    it('allows everything when no lists are set', () => {
      expect(pack().allowsCountry('IN')).toBe(true);
      expect(pack().allowsCountry('')).toBe(true);
    });

    it('honours a block list', () => {
      expect(pack({ visibility: { blockedCountries: ['IN'] } }).allowsCountry('IN')).toBe(false);
      expect(pack({ visibility: { blockedCountries: ['IN'] } }).allowsCountry('US')).toBe(true);
    });

    it('honours an allow list', () => {
      const p = pack({ visibility: { allowedCountries: ['US', 'CA'] } });
      expect(p.allowsCountry('US')).toBe(true);
      expect(p.allowsCountry('IN')).toBe(false);
    });

    it('lets the block list win over the allow list', () => {
      const p = pack({ visibility: { allowedCountries: ['US'], blockedCountries: ['US'] } });
      expect(p.allowsCountry('US')).toBe(false);
    });

    it('allows an unknown country when only a block list exists', () => {
      expect(pack({ visibility: { blockedCountries: ['KP'] } }).allowsCountry(undefined)).toBe(true);
    });
  });
});
