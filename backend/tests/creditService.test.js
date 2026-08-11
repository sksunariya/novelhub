const creditService = require('../src/services/creditService');
const settingsService = require('../src/services/settingsService');
const Wallet = require('../src/models/Wallet');
const CreditBucket = require('../src/models/CreditBucket');
const CreditTransaction = require('../src/models/CreditTransaction');
const { createUser } = require('./helpers');
const {
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  MICROS_PER_CENT,
} = require('../src/config/constants');

let user;

beforeEach(async () => {
  settingsService.clearCache();
  ({ user } = await createUser());
});

const buyPack = (overrides = {}) =>
  creditService.credit({
    user,
    amount: 1200, // 1000 credits + 200 bonus
    type: CREDIT_TRANSACTION_TYPES.PURCHASE,
    source: CREDIT_SOURCES.PURCHASE,
    costUsdCents: 999, // $9.99
    ...overrides,
  });

const grant = (amount = 500, overrides = {}) =>
  creditService.credit({
    user,
    amount,
    type: CREDIT_TRANSACTION_TYPES.GRANT,
    source: CREDIT_SOURCES.GRANT,
    ...overrides,
  });

describe('wallet provisioning', () => {
  it('creates a wallet automatically when a user is created', async () => {
    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet).not.toBeNull();
    expect(wallet.balance).toBe(0);
  });

  it('getOrCreate is idempotent under concurrency', async () => {
    const { user: fresh } = await createUser();
    await Wallet.deleteMany({ user: fresh._id });
    const results = await Promise.all([
      Wallet.getOrCreate(fresh._id),
      Wallet.getOrCreate(fresh._id),
      Wallet.getOrCreate(fresh._id),
    ]);
    expect(results.every(Boolean)).toBe(true);
    expect(await Wallet.countDocuments({ user: fresh._id })).toBe(1);
  });
});

describe('crediting', () => {
  it('increases the balance and records a tranche carrying the cash', async () => {
    await buyPack();
    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet.balance).toBe(1200);
    expect(wallet.lifetimePurchased).toBe(1200);

    const bucket = await CreditBucket.findOne({ user: user._id });
    expect(bucket.remaining).toBe(1200);
    expect(bucket.totalCostMicros).toBe(999 * MICROS_PER_CENT); // 9,990,000
  });

  it('gives granted credits a zero cost basis', async () => {
    await grant(500);
    const bucket = await CreditBucket.findOne({ user: user._id, source: CREDIT_SOURCES.GRANT });
    expect(bucket.totalCostMicros).toBe(0);
    expect((await Wallet.findOne({ user: user._id })).lifetimeGranted).toBe(500);
  });

  it('is idempotent on a replayed key', async () => {
    const first = await buyPack({ idempotencyKey: 'order:abc:capture' });
    const second = await buyPack({ idempotencyKey: 'order:abc:capture' });

    expect(second.replayed).toBe(true);
    expect(String(second.transaction._id)).toBe(String(first.transaction._id));
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
    expect(await CreditTransaction.countDocuments({ user: user._id })).toBe(1);
  });

  it('credits once when the same key is used concurrently', async () => {
    const results = await Promise.all([
      buyPack({ idempotencyKey: 'order:race:capture' }),
      buyPack({ idempotencyKey: 'order:race:capture' }),
      buyPack({ idempotencyKey: 'order:race:capture' }),
    ]);
    const ids = new Set(results.map((r) => String(r.transaction._id)));
    expect(ids.size).toBe(1);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
    // the losers must have cleaned up their tranches
    expect(await CreditBucket.countDocuments({ user: user._id })).toBe(1);
  });

  it('rejects a non-positive amount', async () => {
    await expect(creditService.credit({ user, amount: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(creditService.credit({ user, amount: 1.5 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('spending and revenue attribution', () => {
  it('attributes the real cash behind a bonus pack, not face value', async () => {
    await buyPack();
    const { attributedUsdMicros } = await creditService.debit({ user, amount: 10 });

    // 9,990,000 micros over 1200 credits, 10 spent -> floor(9990000*10/1200)
    expect(attributedUsdMicros).toBe(83250);
    // face value at 100 credits/USD would have claimed 100,000 — 20% too high
    expect(attributedUsdMicros).toBeLessThan(100000);
  });

  it('attributes nothing when the spend is funded by granted credits', async () => {
    await grant(500);
    const { attributedUsdMicros } = await creditService.debit({ user, amount: 10 });
    expect(attributedUsdMicros).toBe(0);
  });

  it('refuses to overspend', async () => {
    await grant(5);
    await expect(creditService.debit({ user, amount: 10 })).rejects.toMatchObject({ status: 402 });
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(5);
  });

  it('leaves no state behind when a debit is refused', async () => {
    await grant(5);
    await expect(creditService.debit({ user, amount: 10 })).rejects.toMatchObject({ status: 402 });
    expect(await CreditTransaction.countDocuments({ type: CREDIT_TRANSACTION_TYPES.SPEND })).toBe(0);
    expect((await CreditBucket.findOne({ user: user._id })).remaining).toBe(5);
  });

  it('allows exactly one winner when concurrent spends exceed the balance', async () => {
    await grant(15); // enough for one 10-credit unlock, not two

    const results = await Promise.allSettled([
      creditService.debit({ user, amount: 10, idempotencyKey: 'unlock:a' }),
      creditService.debit({ user, amount: 10, idempotencyKey: 'unlock:b' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.status).toBe(402);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(5);
  });

  it('is idempotent on a replayed spend key', async () => {
    await grant(100);
    const first = await creditService.debit({ user, amount: 10, idempotencyKey: 'unlock:ch1' });
    const second = await creditService.debit({ user, amount: 10, idempotencyKey: 'unlock:ch1' });

    expect(second.replayed).toBe(true);
    expect(String(second.transaction._id)).toBe(String(first.transaction._id));
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(90);
  });

  it('draws across several tranches and sums their cash exactly', async () => {
    await buyPack({ idempotencyKey: 'p1' }); // 1200 credits / 9,990,000 micros
    await grant(100, { idempotencyKey: 'g1' }); // 100 credits / 0 micros

    // expiry_first with no expiry dates falls back to createdAt, so the pack
    // (created first) is drawn down before the grant.
    const { attributedUsdMicros } = await creditService.debit({ user, amount: 1250 });

    // all 1200 paid credits plus 50 free ones
    expect(attributedUsdMicros).toBe(9990000);
    const buckets = await CreditBucket.find({ user: user._id }).sort({ createdAt: 1 });
    expect(buckets[0].remaining).toBe(0);
    expect(buckets[0].remainingCostMicros).toBe(0);
    expect(buckets[1].remaining).toBe(50);
  });

  it('spends soonest-to-expire first', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await grant(50, { idempotencyKey: 'later' });
    await grant(50, { idempotencyKey: 'soon', expiresAt: soon });

    await creditService.debit({ user, amount: 50 });
    const expiring = await CreditBucket.findOne({ user: user._id, expiresAt: soon });
    const neverExpires = await CreditBucket.findOne({ user: user._id, expiresAt: null });
    expect(expiring.remaining).toBe(0);
    expect(neverExpires.remaining).toBe(50);
  });

  it('honours a purchased-first consumption order', async () => {
    await settingsService.update({ 'expiry.consumptionOrder': 'purchased_first' });
    settingsService.clearCache();

    await grant(100, { idempotencyKey: 'g' });
    await buyPack({ idempotencyKey: 'p' });

    const { attributedUsdMicros } = await creditService.debit({ user, amount: 100 });
    expect(attributedUsdMicros).toBeGreaterThan(0); // drew from the paid tranche

    const granted = await CreditBucket.findOne({ user: user._id, source: CREDIT_SOURCES.GRANT });
    expect(granted.remaining).toBe(100);
  });

  it('never leaves orphaned micros after draining a tranche', async () => {
    await buyPack(); // 9,990,000 over 1200 — does not divide evenly
    for (let i = 0; i < 120; i += 1) {
      await creditService.debit({ user, amount: 10, idempotencyKey: `drain:${i}` });
    }
    const bucket = await CreditBucket.findOne({ user: user._id });
    expect(bucket.remaining).toBe(0);
    expect(bucket.remainingCostMicros).toBe(0);

    const spends = await CreditTransaction.find({ type: CREDIT_TRANSACTION_TYPES.SPEND });
    const recognized = spends.reduce((sum, row) => sum + row.attributedUsdMicros, 0);
    expect(recognized).toBe(9990000); // every micro accounted for, none invented
  });
});

describe('deferred revenue', () => {
  it('counts cash taken but not yet earned in content', async () => {
    await buyPack();
    expect(await creditService.getDeferredRevenueMicros(user._id)).toBe(9990000);

    await creditService.debit({ user, amount: 600 });
    expect(await creditService.getDeferredRevenueMicros(user._id)).toBe(9990000 - 4995000);
  });

  it('is unmoved by a grant campaign, because free credits carry no cash', async () => {
    await buyPack();
    const before = await creditService.getDeferredRevenueMicros(user._id);
    await grant(100000);
    expect(await creditService.getDeferredRevenueMicros(user._id)).toBe(before);
  });
});

describe('accounting identity', () => {
  it('cash in equals recognized plus deferred after randomized activity', async () => {
    const packs = [
      { amount: 1200, costUsdCents: 999 },
      { amount: 550, costUsdCents: 499 },
      { amount: 3000, costUsdCents: 1999 },
    ];
    let cashInMicros = 0;
    for (let i = 0; i < packs.length; i += 1) {
      await creditService.credit({
        user,
        amount: packs[i].amount,
        type: CREDIT_TRANSACTION_TYPES.PURCHASE,
        source: CREDIT_SOURCES.PURCHASE,
        costUsdCents: packs[i].costUsdCents,
        idempotencyKey: `pack:${i}`,
      });
      cashInMicros += packs[i].costUsdCents * MICROS_PER_CENT;
    }
    await grant(400, { idempotencyKey: 'promo' });

    const amounts = [7, 13, 5, 250, 31, 900, 12, 3, 88, 411];
    for (let i = 0; i < amounts.length; i += 1) {
      await creditService.debit({ user, amount: amounts[i], idempotencyKey: `spend:${i}` });
    }

    const spends = await CreditTransaction.find({ user: user._id, type: CREDIT_TRANSACTION_TYPES.SPEND });
    const recognized = spends.reduce((sum, row) => sum + row.attributedUsdMicros, 0);
    const deferred = await creditService.getDeferredRevenueMicros(user._id);

    expect(recognized + deferred).toBe(cashInMicros);
  });
});

describe('reconciliation', () => {
  it('reports no drift on a healthy ledger', async () => {
    await buyPack();
    await creditService.debit({ user, amount: 200 });
    const result = await creditService.reconcile();
    expect(result.drift).toHaveLength(0);
  });

  it('detects and repairs a corrupted wallet balance', async () => {
    await buyPack();
    await Wallet.updateOne({ user: user._id }, { $set: { balance: 999999 } });

    const detected = await creditService.reconcile();
    expect(detected.drift).toHaveLength(1);
    expect(detected.repaired).toBe(0);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(999999);

    const repaired = await creditService.reconcile({ apply: true });
    expect(repaired.repaired).toBe(1);
    expect((await Wallet.findOne({ user: user._id })).balance).toBe(1200);
  });
});

describe('ledger immutability', () => {
  it('refuses updates to a written entry', async () => {
    await grant(100);
    const entry = await CreditTransaction.findOne();
    await expect(CreditTransaction.updateOne({ _id: entry._id }, { amount: 999 })).rejects.toThrow(/immutable/);
  });
});
