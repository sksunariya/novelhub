// Free credit rollouts.
//
// Three properties matter here, because this hands out money:
//
//   1. Idempotent per user per run — `grant:<campaign>:<run>:<user>` is unique
//      on the ledger, so a resumed or re-executed campaign never pays twice.
//   2. Resumable — the cursor is persisted every batch, so a crash continues
//      rather than restarting and re-paying.
//   3. Previewable — count and dry run are exact, so nobody discovers the blast
//      radius after pressing send.

const GrantCampaign = require('../models/GrantCampaign');
const Wallet = require('../models/Wallet');
const CreditTransaction = require('../models/CreditTransaction');
const audienceResolver = require('./audienceResolver');
const creditService = require('./creditService');
const creditNotifications = require('./creditNotificationService');
const settingsService = require('./settingsService');
const {
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  CREDIT_REF_TYPES,
  MICROS_PER_CENT,
} = require('../config/constants');

const fail = (message, status = 400, details = null) => Object.assign(new Error(message), { status, details });

const BATCH_SIZE = 250;

/** What this user should receive, given the campaign's amount mode. */
const amountFor = async (campaign, userId) => {
  if (campaign.amountMode === 'fixed') return campaign.amount;

  const wallet = await Wallet.findOne({ user: userId });
  if (campaign.amountMode === 'top_up_to') {
    const balance = wallet ? wallet.balance : 0;
    return Math.max(0, campaign.amount - balance);
  }
  if (campaign.amountMode === 'match_percent') {
    const spendCents = wallet ? wallet.lifetimeSpendUsdCents : 0;
    const snapshot = await settingsService.snapshot();
    const creditsPerUsd = snapshot.get('credits.perUsd');
    const spentCredits = Math.round((spendCents / 100) * creditsPerUsd);
    return Math.floor((spentCredits * campaign.amount) / 100);
  }
  return campaign.amount;
};

const cap = (campaign, amount) =>
  campaign.maxPerUser > 0 ? Math.min(amount, campaign.maxPerUser) : amount;

/** Live target count for the campaign builder. */
const previewAudience = async (audience) => {
  const [total, sample] = await Promise.all([
    audienceResolver.count(audience),
    audienceResolver.preview(audience, 10),
  ]);
  return { total, sample };
};

/**
 * Estimate the full cost without issuing anything.
 *
 * Walks the real audience so a `top_up_to` or `match_percent` campaign gives a
 * true total rather than a headline figure times a user count.
 */
const dryRun = async (campaign) => {
  const targeted = await audienceResolver.count(campaign.audience);
  let creditsIssued = 0;
  let skipped = 0;
  let processed = 0;
  let afterId = null;

  for (;;) {
    const users = await audienceResolver.batch(campaign.audience, { afterId, size: BATCH_SIZE });
    if (!users.length) break;
    for (const user of users) {
      const amount = cap(campaign, await amountFor(campaign, user._id));
      if (amount <= 0) skipped += 1;
      else creditsIssued += amount;
      processed += 1;
    }
    afterId = users[users.length - 1]._id;
    if (users.length < BATCH_SIZE) break;
  }

  const snapshot = await settingsService.snapshot();
  const creditsPerUsd = snapshot.get('credits.perUsd');

  campaign.lastDryRunAt = new Date();
  campaign.lastDryRunCount = targeted;
  await campaign.save();

  return {
    targeted,
    processed,
    wouldGrant: processed - skipped,
    skipped,
    creditsIssued,
    // Granted credits carry no cash, but they do add content the platform now
    // owes — worth showing before anyone presses send.
    liabilityUsdCents: creditsPerUsd ? Math.round((creditsIssued / creditsPerUsd) * 100) : 0,
  };
};

const assertSafeToRun = async (campaign, { approvedBy = null } = {}) => {
  const snapshot = await settingsService.snapshot();

  if (snapshot.get('grants.requireDryRun') && !campaign.lastDryRunAt) {
    throw fail('Run a dry run before executing this campaign', 428);
  }

  const maxCredits = snapshot.get('grants.maxCreditsPerCampaign');
  const estimate = campaign.lastDryRunCount * campaign.amount;
  if (maxCredits && estimate > maxCredits) {
    throw fail(`This campaign would issue about ${estimate} credits, above the ${maxCredits} limit`, 403);
  }

  const approvalThreshold = snapshot.get('grants.approvalThresholdCredits');
  if (approvalThreshold && estimate > approvalThreshold && !(campaign.approvedBy || approvedBy)) {
    throw fail(`Campaigns over ${approvalThreshold} credits need a second approver`, 428);
  }
};

/**
 * Issue the credits.
 *
 * Safe to call again on a campaign that died mid-run: the cursor resumes and
 * the per-user idempotency key covers anything already paid.
 */
const execute = async (campaign, { resume = false, actor = null } = {}) => {
  if (campaign.status === 'running' && !resume) {
    throw fail('This campaign is already running', 409);
  }
  await assertSafeToRun(campaign, { approvedBy: actor });

  const startedAt = new Date();
  if (!resume) {
    campaign.runIndex += 1;
    campaign.cursor = { lastUserId: null, processedCount: 0 };
    campaign.stats = { targeted: 0, granted: 0, skipped: 0, failed: 0, creditsIssued: 0 };
  }
  campaign.status = 'running';
  campaign.stats.targeted = await audienceResolver.count(campaign.audience);
  await campaign.save();

  const runIndex = campaign.runIndex;
  const expiresAt =
    campaign.expiryDays > 0 ? new Date(Date.now() + campaign.expiryDays * 24 * 3600 * 1000) : null;
  const notifyEnabled = campaign.notify && campaign.notify.enabled;

  let afterId = campaign.cursor.lastUserId;

  try {
    for (;;) {
      const users = await audienceResolver.batch(campaign.audience, { afterId, size: BATCH_SIZE });
      if (!users.length) break;

      for (const user of users) {
        try {
          const amount = cap(campaign, await amountFor(campaign, user._id));
          if (amount <= 0) {
            campaign.stats.skipped += 1;
            continue;
          }

          const result = await creditService.credit({
            user: user._id,
            amount,
            type: CREDIT_TRANSACTION_TYPES.GRANT,
            source: CREDIT_SOURCES.GRANT,
            costUsdCents: 0, // free credits carry no cash, so they earn no revenue when spent
            expiresAt,
            // Stable across a resume, unique across re-runs.
            idempotencyKey: `grant:${campaign._id}:${runIndex}:${user._id}`,
            refType: CREDIT_REF_TYPES.GRANT_CAMPAIGN,
            refId: campaign._id,
            reason: campaign.name,
            description: campaign.notify.message || `${amount} credits from ${campaign.name}`,
            createdBy: actor ? actor._id : null,
          });

          if (result.replayed) {
            campaign.stats.skipped += 1;
          } else {
            campaign.stats.granted += 1;
            campaign.stats.creditsIssued += amount;
            if (notifyEnabled) {
              await creditNotifications.creditsGranted(user, {
                amount,
                reason: campaign.name,
                campaignName: campaign.name,
                expiresAt,
              });
            }
          }
        } catch (error) {
          campaign.stats.failed += 1;
          console.error(`[grants] ${campaign.name} failed for ${user._id}:`, error.message);
        }
        campaign.cursor.processedCount += 1;
      }

      afterId = users[users.length - 1]._id;
      campaign.cursor.lastUserId = afterId;
      // Persisted every batch, so a crash costs at most one batch of progress.
      await campaign.save();

      if (users.length < BATCH_SIZE) break;
    }

    campaign.status = campaign.stats.failed > 0 ? 'partially_failed' : 'completed';
  } catch (error) {
    campaign.status = 'partially_failed';
    campaign.runs.push({ runIndex, startedAt, finishedAt: new Date(), stats: campaign.stats, error: error.message });
    await campaign.save();
    throw error;
  }

  campaign.runs.push({ runIndex, startedAt, finishedAt: new Date(), stats: campaign.stats, error: '' });
  await campaign.save();
  return campaign.stats;
};

/**
 * Take back what has not been spent.
 *
 * Only unspent credits are clawed back — a reader who already used them keeps
 * the chapters, because retroactively locking content they read would be worse
 * than absorbing the cost.
 */
const reverse = async (campaign, { actor = null } = {}) => {
  const snapshot = await settingsService.snapshot();
  const window = snapshot.get('grants.reversalWindowDays');
  if (window > 0) {
    const age = (Date.now() - campaign.createdAt.getTime()) / (24 * 3600 * 1000);
    if (age > window) throw fail(`Campaigns can only be reversed within ${window} days`, 403);
  }

  const grants = await CreditTransaction.find({
    refType: CREDIT_REF_TYPES.GRANT_CAMPAIGN,
    refId: campaign._id,
    type: CREDIT_TRANSACTION_TYPES.GRANT,
  });

  let reversed = 0;
  let credits = 0;
  let partial = 0;

  for (const grant of grants) {
    const bucketId = grant.bucketBreakdown[0] && grant.bucketBreakdown[0].bucket;
    if (!bucketId) continue;
    const CreditBucket = require('../models/CreditBucket');
    const bucket = await CreditBucket.findById(bucketId);
    if (!bucket || bucket.remaining <= 0) continue;

    const take = bucket.remaining;
    const claimed = await CreditBucket.findOneAndUpdate(
      { _id: bucket._id, remaining: { $gte: take } },
      { $set: { remaining: 0, remainingCostMicros: 0 } }
    );
    if (!claimed) continue;

    const wallet = await Wallet.findOneAndUpdate(
      { user: grant.user },
      { $inc: { balance: -take, lifetimeGranted: -take } },
      { new: true }
    );

    await CreditTransaction.create({
      user: grant.user,
      type: CREDIT_TRANSACTION_TYPES.REVERSAL,
      amount: -take,
      balanceAfter: wallet ? wallet.balance : 0,
      attributedUsdMicros: 0,
      bucketBreakdown: [{ bucket: bucket._id, credits: take, costMicros: 0 }],
      idempotencyKey: `grant-reversal:${campaign._id}:${grant.user}`,
      refType: CREDIT_REF_TYPES.GRANT_CAMPAIGN,
      refId: campaign._id,
      reason: `reversed campaign: ${campaign.name}`,
      description: 'A credit grant was reversed',
      createdBy: actor ? actor._id : null,
    }).catch((error) => {
      if (error.code !== 11000) throw error;
    });

    reversed += 1;
    credits += take;
    if (take < grant.amount) partial += 1;
  }

  campaign.status = 'reversed';
  await campaign.save();
  return { reversed, credits, partiallySpent: partial, alreadySpent: grants.length - reversed };
};

/** Campaigns whose scheduled time has arrived. Driven by the scheduler. */
const runDueCampaigns = async () => {
  const now = new Date();
  const due = await GrantCampaign.find({
    status: 'scheduled',
    'schedule.mode': 'scheduled',
    'schedule.runAt': { $lte: now },
  }).limit(10);

  const results = [];
  for (const campaign of due) {
    try {
      const stats = await execute(campaign);
      results.push({ campaign: campaign.name, ...stats });
    } catch (error) {
      results.push({ campaign: campaign.name, error: error.message });
    }
  }
  return { due: due.length, results };
};

/** Resume anything left running by a crashed instance. */
const resumeStalled = async () => {
  const stalled = await GrantCampaign.find({
    status: 'running',
    updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
  }).limit(5);

  const results = [];
  for (const campaign of stalled) {
    try {
      const stats = await execute(campaign, { resume: true });
      results.push({ campaign: campaign.name, resumed: true, ...stats });
    } catch (error) {
      results.push({ campaign: campaign.name, error: error.message });
    }
  }
  return { stalled: stalled.length, results };
};

module.exports = { previewAudience, dryRun, execute, reverse, runDueCampaigns, resumeStalled, amountFor };
