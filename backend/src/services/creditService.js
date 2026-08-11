// Credit ledger service.
//
// Correctness here does not depend on multi-document transactions, which is
// deliberate: transactions require a replica set, and a standalone mongod is a
// realistic deployment. Safety comes from four independent guards instead:
//
//   1. Wallet debits are a single atomic conditional update, so a balance can
//      never go below zero through a race.
//   2. CreditTransaction.idempotencyKey is uniquely indexed, so a replayed
//      webhook or a double-clicked button writes one row, not two.
//   3. Bucket withdrawals are atomic conditional updates with a retry, so two
//      concurrent spends cannot draw the same cash twice.
//   4. Any operation that fails after a wallet write compensates it.
//
// Where a compensation itself fails, the reconciliation job is the backstop:
// the ledger is authoritative and the wallet can always be rebuilt from it.

const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const CreditBucket = require('../models/CreditBucket');
const CreditTransaction = require('../models/CreditTransaction');
const settingsService = require('./settingsService');
const {
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  MICROS_PER_CENT,
  BUCKET_CONSUMPTION_ORDER,
} = require('../config/constants');

const BUCKET_RETRY_LIMIT = 5;

const badRequest = (message, status = 400) => Object.assign(new Error(message), { status });

const assertPositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive whole number`);
  }
};

const findByKey = (idempotencyKey) =>
  idempotencyKey ? CreditTransaction.findOne({ idempotencyKey }) : Promise.resolve(null);

// Omit the field entirely rather than storing null, so the partial unique index
// never sees it. Belt and braces alongside the index itself.
const keyField = (idempotencyKey) => (idempotencyKey ? { idempotencyKey } : {});

// Sources that represent real money. Everything else has a zero cost basis and
// therefore generates no revenue when spent — which is the point.
const CASH_SOURCES = new Set([CREDIT_SOURCES.PURCHASE, CREDIT_SOURCES.SUBSCRIPTION]);

// A tranche that never expires must sort *after* every dated one under
// "expiry first" — spend what would otherwise be forfeited before what keeps.
// Mongo sorts null FIRST ascending, which is exactly backwards, so ordering is
// applied in JS against this sentinel rather than in the query.
const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

const expiryRank = (bucket) => (bucket.expiresAt ? bucket.expiresAt.getTime() : NEVER_EXPIRES);
const cashRank = (bucket) => (bucket.remainingCostMicros > 0 ? 1 : 0);
const age = (bucket) => bucket.createdAt.getTime();

const COMPARATORS = {
  [BUCKET_CONSUMPTION_ORDER.EXPIRY_FIRST]: (a, b) => expiryRank(a) - expiryRank(b) || age(a) - age(b),
  [BUCKET_CONSUMPTION_ORDER.FIFO]: (a, b) => age(a) - age(b),
  // Granted (zero-cost) tranches first; the inverse for purchased-first.
  [BUCKET_CONSUMPTION_ORDER.GRANTED_FIRST]: (a, b) => cashRank(a) - cashRank(b) || age(a) - age(b),
  [BUCKET_CONSUMPTION_ORDER.PURCHASED_FIRST]: (a, b) => cashRank(b) - cashRank(a) || age(a) - age(b),
};

/**
 * Load spendable tranches in the configured order.
 *
 * Only live tranches are loaded, and a tranche leaves the set once drained, so
 * this stays small in practice — one row per purchase or grant the user still
 * has credits from.
 */
const loadBuckets = async (userId, order) => {
  const buckets = await CreditBucket.find({ user: userId, remaining: { $gt: 0 } }).sort({ createdAt: 1 });
  const comparator = COMPARATORS[order] || COMPARATORS[BUCKET_CONSUMPTION_ORDER.EXPIRY_FIRST];
  return buckets.sort(comparator);
};

/**
 * Withdraw `credits` worth of tranches, returning the cash they carried.
 *
 * Each withdrawal is a conditional update, so a concurrent spend that beats us
 * to a tranche simply fails that step and we retry against a fresh list.
 *
 * `allowPartial` is for clawbacks: when a refund reverses more credits than the
 * user still holds, the tranches genuinely cannot cover it. Whatever is left is
 * consumed (reversing that much deferred revenue) and the shortfall is
 * reported. Revenue already recognized against chapters they read stays
 * recognized — they read those chapters.
 */
const consumeBuckets = async (userId, credits, order, { allowPartial = false } = {}) => {
  let attempt = 0;
  while (attempt < BUCKET_RETRY_LIMIT) {
    attempt += 1;
    const buckets = await loadBuckets(userId, order);
    const breakdown = [];
    let outstanding = credits;
    let attributedUsdMicros = 0;
    let raced = false;

    for (const bucket of buckets) {
      if (outstanding <= 0) break;
      const take = Math.min(outstanding, bucket.remaining);
      if (take <= 0) continue;
      const costMicros = CreditBucket.costFor(bucket, take);

      const claimed = await CreditBucket.findOneAndUpdate(
        { _id: bucket._id, remaining: { $gte: take } },
        { $inc: { remaining: -take, remainingCostMicros: -costMicros } },
        { new: true }
      );
      if (!claimed) {
        raced = true;
        break;
      }

      breakdown.push({ bucket: bucket._id, credits: take, costMicros });
      attributedUsdMicros += costMicros;
      outstanding -= take;
    }

    if (raced) {
      await restoreBuckets(breakdown);
      continue; // another spend moved first — retry with fresh state
    }

    if (outstanding > 0) {
      if (allowPartial) {
        return { breakdown, attributedUsdMicros, consumed: credits - outstanding, shortfall: outstanding };
      }
      await restoreBuckets(breakdown);
      // Tranches did not cover the debit. The wallet said they should, so the
      // two have drifted; surface it rather than silently under-attributing.
      throw badRequest('Credit tranches are out of sync with the balance. Run reconciliation.', 409);
    }

    return { breakdown, attributedUsdMicros, consumed: credits, shortfall: 0 };
  }
  throw badRequest('Could not reserve credits, please retry', 409);
};

const restoreBuckets = async (breakdown) => {
  await Promise.all(
    breakdown.map((entry) =>
      CreditBucket.updateOne(
        { _id: entry.bucket },
        { $inc: { remaining: entry.credits, remainingCostMicros: entry.costMicros } }
      )
    )
  );
};

/**
 * Add credits.
 *
 * `costUsdCents` is the cash behind this issuance — the post-discount, and
 * optionally post-fee, order total. Split across the full credit count
 * including bonus, so a "1000 + 200 bonus" pack correctly values each credit
 * below face value.
 */
const credit = async ({
  user,
  amount,
  type = CREDIT_TRANSACTION_TYPES.GRANT,
  source = CREDIT_SOURCES.GRANT,
  costUsdCents = 0,
  expiresAt = null,
  idempotencyKey = null,
  refType = null,
  refId = null,
  reason = '',
  description = '',
  metadata = {},
  createdBy = null,
  sourceRef = null,
}) => {
  const userId = user._id || user;
  assertPositiveInteger(amount, 'amount');

  // Same contract as debit: the wallet is present on every path.
  const existing = await findByKey(idempotencyKey);
  if (existing) {
    return { transaction: existing, wallet: await Wallet.getOrCreate(userId), replayed: true };
  }

  const totalCostMicros = CASH_SOURCES.has(source) ? Math.round(costUsdCents * MICROS_PER_CENT) : 0;

  await Wallet.getOrCreate(userId);
  const lifetimeField =
    type === CREDIT_TRANSACTION_TYPES.PURCHASE
      ? 'lifetimePurchased'
      : type === CREDIT_TRANSACTION_TYPES.SUBSCRIPTION_GRANT
        ? 'lifetimePurchased'
        : 'lifetimeGranted';

  const wallet = await Wallet.findOneAndUpdate(
    { user: userId },
    {
      $inc: { balance: amount, [lifetimeField]: amount },
      $set: { lastTransactionAt: new Date() },
    },
    { new: true }
  );

  const bucket = await CreditBucket.create({
    user: userId,
    source,
    sourceRef: sourceRef || refId,
    amount,
    remaining: amount,
    totalCostMicros,
    remainingCostMicros: totalCostMicros,
    expiresAt,
  });

  try {
    const transaction = await CreditTransaction.create({
      user: userId,
      type,
      amount,
      balanceAfter: wallet.balance,
      attributedUsdMicros: 0, // recognized when spent, not when issued
      bucketBreakdown: [{ bucket: bucket._id, credits: amount, costMicros: totalCostMicros }],
      reason,
      description,
      refType,
      refId,
      ...keyField(idempotencyKey),
      metadata,
      createdBy,
    });
    return { transaction, wallet, bucket, replayed: false };
  } catch (error) {
    // Lost an idempotency race: another request credited this same key between
    // our lookup and our write. Undo our side and return theirs.
    if (error.code === 11000) {
      await Promise.all([
        Wallet.updateOne({ user: userId }, { $inc: { balance: -amount, [lifetimeField]: -amount } }),
        CreditBucket.deleteOne({ _id: bucket._id }),
      ]);
      const winner = await findByKey(idempotencyKey);
      if (winner) return { transaction: winner, wallet: await Wallet.getOrCreate(userId), replayed: true };
    }
    throw error;
  }
};

/**
 * Spend credits.
 *
 * The wallet update is the hard gate — a null result means insufficient funds
 * and no state has changed. Everything after it compensates on failure.
 */
const debit = async ({
  user,
  amount,
  type = CREDIT_TRANSACTION_TYPES.SPEND,
  idempotencyKey = null,
  refType = null,
  refId = null,
  novel = null,
  chapter = null,
  reason = '',
  description = '',
  metadata = {},
  createdBy = null,
  // Refund clawbacks may legitimately take back more than the user still
  // holds. Only the caller knows that; a normal spend must never set this.
  allowNegative = false,
}) => {
  const userId = user._id || user;
  assertPositiveInteger(amount, 'amount');

  const existing = await findByKey(idempotencyKey);
  if (existing) {
    // The wallet is included on every path so callers can rely on it. Omitting
    // it here previously made `result.wallet.balance` throw on a replay —
    // turning an otherwise successful retry into a 500.
    return {
      transaction: existing,
      wallet: await Wallet.getOrCreate(userId),
      replayed: true,
      attributedUsdMicros: existing.attributedUsdMicros,
    };
  }

  await Wallet.getOrCreate(userId);

  // Atomic and conditional: no read-modify-write, so no race window. The
  // balance condition is the overspend guard and is dropped only for clawbacks.
  const guard = allowNegative ? { user: userId } : { user: userId, balance: { $gte: amount } };
  const wallet = await Wallet.findOneAndUpdate(
    guard,
    {
      $inc: { balance: -amount, lifetimeSpent: amount },
      $set: { lastTransactionAt: new Date() },
    },
    { new: true }
  );
  if (!wallet) throw badRequest('Insufficient credits', 402);

  if (wallet.balance < 0 && !wallet.flags.negative) {
    await Wallet.updateOne({ _id: wallet._id }, { $set: { 'flags.negative': true } });
  }

  const order = await settingsService.get('expiry.consumptionOrder');

  let consumed;
  try {
    consumed = await consumeBuckets(userId, amount, order, { allowPartial: allowNegative });
  } catch (error) {
    await Wallet.updateOne({ user: userId }, { $inc: { balance: amount, lifetimeSpent: -amount } });
    throw error;
  }

  try {
    const transaction = await CreditTransaction.create({
      user: userId,
      type,
      amount: -amount,
      balanceAfter: wallet.balance,
      attributedUsdMicros: consumed.attributedUsdMicros,
      bucketBreakdown: consumed.breakdown,
      reason,
      description,
      refType,
      refId,
      novel,
      chapter,
      idempotencyKey,
      metadata,
      createdBy,
    });

    if (consumed.attributedUsdMicros > 0) {
      await Wallet.updateOne(
        { user: userId },
        { $inc: { lifetimeSpendUsdCents: Math.round(consumed.attributedUsdMicros / MICROS_PER_CENT) } }
      );
    }

    return { transaction, wallet, attributedUsdMicros: consumed.attributedUsdMicros, replayed: false };
  } catch (error) {
    await restoreBuckets(consumed.breakdown);
    await Wallet.updateOne({ user: userId }, { $inc: { balance: amount, lifetimeSpent: -amount } });
    if (error.code === 11000) {
      const winner = await findByKey(idempotencyKey);
      if (winner) {
        return {
          transaction: winner,
          wallet: await Wallet.getOrCreate(userId),
          replayed: true,
          attributedUsdMicros: winner.attributedUsdMicros,
        };
      }
    }
    throw error;
  }
};

/** Current balance, provisioning the wallet on first read. */
const getBalance = async (user) => {
  const wallet = await Wallet.getOrCreate(user._id || user);
  return wallet.balance;
};

/**
 * Deferred revenue: cash taken but not yet earned in content.
 *
 * The sum of every live tranche's remaining cost. A generous grant campaign
 * does not move this, because granted credits carry no cash — which is exactly
 * the distinction face-value accounting loses.
 */
const getDeferredRevenueMicros = async (userId = null) => {
  const match = { remaining: { $gt: 0 } };
  if (userId) match.user = new mongoose.Types.ObjectId(String(userId));
  const [row] = await CreditBucket.aggregate([
    { $match: match },
    { $group: { _id: null, micros: { $sum: '$remainingCostMicros' } } },
  ]);
  return row ? row.micros : 0;
};

/**
 * Verify Wallet.balance against the ledger. The ledger wins.
 *
 * Returns drift rows without repairing unless `apply` is set, so it is safe to
 * run as a scheduled health check.
 */
const reconcile = async ({ apply = false, userId = null } = {}) => {
  const match = userId ? { user: new mongoose.Types.ObjectId(String(userId)) } : {};
  const totals = await CreditTransaction.aggregate([
    { $match: match },
    { $group: { _id: '$user', ledgerBalance: { $sum: '$amount' } } },
  ]);
  const ledgerByUser = new Map(totals.map((row) => [String(row._id), row.ledgerBalance]));

  const wallets = await Wallet.find(userId ? { user: userId } : {});
  const drift = [];
  for (const wallet of wallets) {
    const expected = ledgerByUser.get(String(wallet.user)) || 0;
    if (wallet.balance !== expected) {
      drift.push({ user: wallet.user, walletBalance: wallet.balance, ledgerBalance: expected });
      if (apply) {
        await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: expected } });
      }
    }
  }
  return { checked: wallets.length, drift, repaired: apply ? drift.length : 0 };
};

module.exports = {
  credit,
  debit,
  getBalance,
  getDeferredRevenueMicros,
  reconcile,
  consumeBuckets,
  restoreBuckets,
};
