// Guards against destroying content people paid for.
//
// Chapter and Novel both carry the softDelete plugin, and the plugin's read
// hooks make a deleted chapter populate as `null` rather than error — so
// without this guard, deleting a chapter 400 readers bought would silently
// strip their access with no refund and no error anywhere.

const ChapterAccess = require('../models/ChapterAccess');
const Chapter = require('../models/Chapter');
const settingsService = require('./settingsService');
const creditService = require('./creditService');
const accessService = require('./accessService');
const { CREDIT_TRANSACTION_TYPES, CREDIT_SOURCES, CREDIT_REF_TYPES } = require('../config/constants');

const conflict = (message, details) => Object.assign(new Error(message), { status: 409, details });

/**
 * Refund everyone who paid for these chapters.
 *
 * Idempotency is keyed on the access row, so re-running a partially failed
 * delete never double-refunds.
 */
const refundPurchasers = async ({ chapterIds, reason }) => {
  const rows = await ChapterAccess.find({ chapter: { $in: chapterIds }, creditsSpent: { $gt: 0 } });
  let refunded = 0;
  let credits = 0;
  for (const row of rows) {
    await creditService.credit({
      user: row.user,
      amount: row.creditsSpent,
      type: CREDIT_TRANSACTION_TYPES.REFUND,
      source: CREDIT_SOURCES.ADJUSTMENT,
      idempotencyKey: `content-removed:${row._id}`,
      refType: CREDIT_REF_TYPES.CHAPTER,
      refId: row.chapter,
      reason,
      description: 'Refund: a chapter you unlocked was removed',
    });
    refunded += 1;
    credits += row.creditsSpent;
  }
  await ChapterAccess.deleteMany({ chapter: { $in: chapterIds } });
  return { refunded, credits };
};

/**
 * Run before soft-deleting chapters.
 *
 * @returns {{ action: string, summary: object, refund: ?object }}
 * @throws  409 with a summary when the configured policy is to block
 */
const guardChapterDeletion = async (chapterIds, { force = false } = {}) => {
  const snapshot = await settingsService.snapshot();
  const summary = await accessService.purchaseSummary(chapterIds);

  if (!summary.purchases) return { action: 'none', summary, refund: null };
  if (!snapshot.get('safety.blockDeleteOfPurchasedChapters')) {
    return { action: 'allowed', summary, refund: null };
  }

  const policy = snapshot.get('safety.onChapterDelete');

  if (policy === 'block' && !force) {
    throw conflict(
      `This content has ${summary.purchases} purchase(s) worth ${summary.credits} credits ` +
        `($${(summary.usdCents / 100).toFixed(2)} attributed). Refund them first, or change the deletion policy.`,
      summary
    );
  }

  if (policy === 'refund_credits' || policy === 'refund_and_notify' || force) {
    const refund = await refundPurchasers({ chapterIds, reason: 'chapter removed by admin' });
    return { action: policy === 'refund_and_notify' ? 'refunded_and_notified' : 'refunded', summary, refund };
  }

  return { action: 'allowed', summary, refund: null };
};

/** Same guard, resolving a novel to all of its chapters first. */
const guardNovelDeletion = async (novelId, options = {}) => {
  const chapters = await Chapter.find({ novel: novelId }).select('_id');
  return guardChapterDeletion(
    chapters.map((chapter) => chapter._id),
    options
  );
};

/** Has this user any financial history worth retaining? */
const transactionSummary = async (userId) => {
  const Order = require('../models/Order');
  const CreditTransaction = require('../models/CreditTransaction');
  const Wallet = require('../models/Wallet');

  const [orders, ledgerRows, wallet] = await Promise.all([
    Order.countDocuments({ user: userId, creditedAt: { $ne: null } }),
    CreditTransaction.countDocuments({ user: userId }),
    Wallet.findOne({ user: userId }),
  ]);
  return {
    orders,
    ledgerRows,
    balance: wallet ? wallet.balance : 0,
    hasHistory: orders > 0 || ledgerRows > 0,
  };
};

/**
 * Strip personal data while keeping the financial trail intact.
 *
 * Tax and accounting rules generally require order records to be retained for
 * years, while an erasure request has to be honoured. Anonymizing satisfies
 * both: the rows survive with no personal data attached to them.
 *
 * The username and email are replaced with unique placeholders rather than
 * cleared, because both carry unique indexes and blanking them would collide
 * on the second anonymized user.
 */
const anonymizeUser = async (user) => {
  const User = require('../models/User');
  const tag = String(user._id).slice(-8);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        username: `deleted_${tag}`,
        email: `deleted_${tag}@removed.invalid`,
        fullName: '',
        avatarUrl: '',
        country: '',
        anonymizedAt: new Date(),
        deletedAt: new Date(),
      },
      $unset: { googleId: '', password: '' },
    }
  );
  return { anonymized: true };
};

/**
 * Run before soft-deleting a user.
 *
 * @throws 409 when the policy is to block and the user has financial history
 */
const guardUserDeletion = async (user, { force = false } = {}) => {
  const snapshot = await settingsService.snapshot();
  const summary = await transactionSummary(user._id);

  if (!summary.hasHistory) return { action: 'none', summary };

  const policy = snapshot.get('safety.onTransactedUserDelete');

  if (policy === 'block' && !force) {
    throw conflict(
      `This user has ${summary.orders} completed order(s) and ${summary.ledgerRows} ledger entries. ` +
        'Anonymize instead, or change the deletion policy.',
      summary
    );
  }

  if (policy === 'anonymize' && !force) {
    await anonymizeUser(user);
    return { action: 'anonymized', summary };
  }

  // full_delete, or an admin explicitly forcing past the policy. The ledger
  // rows are left in place regardless — deleting them would break
  // reconciliation and the revenue already recognized against chapters.
  return { action: 'deleted_with_records_retained', summary };
};

module.exports = {
  guardChapterDeletion,
  guardNovelDeletion,
  guardUserDeletion,
  transactionSummary,
  anonymizeUser,
  refundPurchasers,
};
