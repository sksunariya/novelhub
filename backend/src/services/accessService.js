// Chapter access: deciding whether a reader can open a chapter, and unlocking
// it when they choose to spend.

const ChapterAccess = require('../models/ChapterAccess');
const PricingRule = require('../models/PricingRule');
const Chapter = require('../models/Chapter');
const Novel = require('../models/Novel');
const settingsService = require('./settingsService');
const creditService = require('./creditService');
const revenueService = require('./revenueService');
const subscriptionService = require('./subscriptionService');
const { resolveChapterPrice, resolveNovelMonetization, bulkDiscountPct } = require('../utils/chapterPricing');
const {
  ACCESS_SOURCES,
  GATE_REASONS,
  PRICE_REASONS,
  CREDIT_REF_TYPES,
  MICROS_PER_CENT,
  ROLES,
  REVENUE_EVENT_KINDS,
} = require('../config/constants');

const badRequest = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * The owner tier reads everything without spending.
 *
 * Not a discount and not an entitlement: no ChapterAccess row is written and no
 * revenue is attributed, because nothing was bought. The alternative — giving
 * the owner a credit balance large enough to never run out — would pollute the
 * ledger every operator has to reconcile, to simulate a decision the platform
 * can simply make.
 */
const readsFree = (user) => Boolean(user && user.role === ROLES.SUPERADMIN);

const staffAccess = () => ({
  locked: false,
  free: true,
  priceCredits: 0,
  reason: PRICE_REASONS.STAFF_BYPASS,
  staffBypass: true,
});

const PRICING_KEYS = [
  'monetization.enabled',
  'pricing.defaultChapterCredits',
  'pricing.defaultFreeChapterCount',
  'pricing.defaultFreeAfterDays',
  'pricing.roundToNearestCredits',
  'pricing.allowBulkUnlock',
  'pricing.bulkDiscountTiers',
  'safety.freezeFreeCountByOriginalNumber',
];

/** Flattened settings the pricing resolver needs, in one snapshot read. */
const pricingConfig = async () => {
  const snapshot = await settingsService.snapshot();
  return {
    monetizationEnabled: snapshot.get('monetization.enabled'),
    defaultChapterCredits: snapshot.get('pricing.defaultChapterCredits'),
    defaultFreeChapterCount: snapshot.get('pricing.defaultFreeChapterCount'),
    defaultFreeAfterDays: snapshot.get('pricing.defaultFreeAfterDays'),
    roundToNearestCredits: snapshot.get('pricing.roundToNearestCredits'),
    allowBulkUnlock: snapshot.get('pricing.allowBulkUnlock'),
    bulkDiscountTiers: snapshot.get('pricing.bulkDiscountTiers'),
    freezeFreeCountByOriginalNumber: snapshot.get('safety.freezeFreeCountByOriginalNumber'),
    gateStacking: snapshot.get('pricing.gateStacking'),
  };
};

/**
 * Live pricing rules. Loaded once per request and reused across chapters so
 * pricing a 2000-chapter list is one query, not two thousand.
 */
const loadRules = () => PricingRule.find({ active: true }).sort({ priority: -1, updatedAt: -1 });

/**
 * What a reader's subscription means for one novel, resolved once.
 *
 * Every pricing path needs the same four answers, and they have to agree — a
 * chapter list that quotes a discount the unlock endpoint does not honour is
 * worse than having no discount at all.
 */
const subscriptionContext = async (user, novel) => {
  const none = { entitled: false, unmetered: false, discountPct: 0, earlyHours: 0, freeUnlocksLeft: 0 };
  if (!user) return none;

  const subscription = await subscriptionService.activeFor(user._id);
  if (!subscription || !subscription.isEntitled()) return none;

  const novelConfig = resolveNovelMonetization(novel);
  const included = !novelConfig || novelConfig.subscriptionIncluded !== false;
  const perks = subscription.perks();

  // A 100% chapter discount is an admin saying "free for subscribers". Folding
  // it into coverage avoids the absurd result of rounding it up to 1 credit.
  const fullyDiscounted = (perks.chapterDiscountPct || 0) >= 100;

  return {
    entitled: true,
    subscription,
    unmetered: included && (fullyDiscounted || subscription.coversNovel(novel._id)),
    discountPct: perks.chapterDiscountPct || 0,
    earlyHours: perks.earlyAccessHours || 0,
    freeUnlocksLeft: included ? subscription.freeUnlocksRemaining() : 0,
  };
};

const ownedChapterIds = async (userId, novelId) => {
  if (!userId) return new Set();
  const rows = await ChapterAccess.find({ user: userId, novel: novelId }).select('chapter expiresAt');
  const now = Date.now();
  return new Set(
    rows.filter((row) => !row.expiresAt || row.expiresAt.getTime() > now).map((row) => String(row.chapter))
  );
};

/**
 * Decide access for one chapter.
 *
 * Early access is checked before pricing on purpose: a non-subscriber inside
 * the window is blocked outright, not quoted a price they cannot yet use.
 */
const resolveAccess = async ({
  novel,
  chapter,
  user,
  config,
  rules,
  ownedIds = null,
  subscriptionCtx = null,
  now = new Date(),
}) => {
  // Checked before every other gate, including early access: the owner needs
  // to be able to open a chapter to verify it, and a release window they
  // configured should not lock them out of checking their own work.
  if (readsFree(user)) return staffAccess();

  const cfg = config || (await pricingConfig());

  if (!cfg.monetizationEnabled) {
    return { locked: false, free: true, priceCredits: 0, reason: PRICE_REASONS.MONETIZATION_OFF };
  }

  const owned = ownedIds
    ? ownedIds.has(String(chapter._id))
    : Boolean(
        user &&
          (await ChapterAccess.findOne({ user: user._id, chapter: chapter._id }).then(
            (row) => row && (!row.expiresAt || row.expiresAt.getTime() > now.getTime())
          ))
      );
  if (owned) {
    return { locked: false, owned: true, priceCredits: 0, reason: PRICE_REASONS.OWNED };
  }

  // A subscriber whose plan covers this novel reads it without spending.
  // Checked before pricing, so a covered chapter is never quoted a price.
  const sub = subscriptionCtx || (await subscriptionContext(user, novel));

  if (chapter.earlyAccessUntil && new Date(chapter.earlyAccessUntil) > now) {
    // Early access shortens for a subscriber whose plan grants the perk.
    const opensAt = new Date(new Date(chapter.earlyAccessUntil).getTime() - sub.earlyHours * 3600 * 1000);
    if (opensAt > now) {
      return {
        locked: true,
        reason: GATE_REASONS.EARLY_ACCESS,
        availableAt: opensAt,
        priceCredits: 0,
      };
    }
  }

  if (sub.unmetered) {
    return { locked: false, free: true, reason: PRICE_REASONS.SUBSCRIPTION, viaSubscription: true };
  }

  const priced = resolveChapterPrice({
    novel,
    chapter,
    rules: rules || (await loadRules()),
    config: cfg,
    now,
  });

  if (priced.free) {
    return { locked: false, free: true, priceCredits: 0, reason: priced.reason };
  }

  // Subscriber chapter discount, applied to whatever the chain resolved.
  if (sub.discountPct > 0) {
    priced.priceCredits = Math.max(1, Math.round(priced.priceCredits * (1 - sub.discountPct / 100)));
  }

  const balance = user ? await creditService.getBalance(user) : 0;
  return {
    locked: true,
    reason: GATE_REASONS.CREDITS,
    priceCredits: priced.priceCredits,
    subscriberDiscountPct: sub.discountPct || undefined,
    // A metered allowance stays locked so that claiming it is an explicit act —
    // that is the only way the per-cycle count can mean anything.
    freeUnlocksLeft: sub.freeUnlocksLeft || undefined,
    priceReason: priced.reason,
    ruleId: priced.ruleId,
    balance,
    canAfford: Boolean(user) && balance >= priced.priceCredits,
  };
};

/** Price and ownership for every chapter of a novel, for the chapter list. */
const resolveNovelChapters = async ({ novel, chapters, user, now = new Date() }) => {
  // The list must agree with what the reader sees when they open a chapter,
  // which includes the staff bypass — a list quoting prices the reader will
  // never be charged is the same inconsistency, just in the other direction.
  if (readsFree(user)) {
    return chapters.map((chapter) => ({ chapter, owned: false, ...staffAccess() }));
  }

  // The list must agree with what the reader sees when they open a chapter, so
  // it goes through the same subscription context the single-chapter resolver
  // uses rather than reimplementing the perk rules.
  const [config, rules, ownedIds, sub] = await Promise.all([
    pricingConfig(),
    loadRules(),
    ownedChapterIds(user && user._id, novel._id),
    subscriptionContext(user, novel),
  ]);

  return chapters.map((chapter) => {
    if (!config.monetizationEnabled) {
      return { chapter, locked: false, free: true, priceCredits: 0, owned: false };
    }
    const owned = ownedIds.has(String(chapter._id));
    if (owned) return { chapter, locked: false, owned: true, priceCredits: 0, reason: PRICE_REASONS.OWNED };

    if (chapter.earlyAccessUntil && new Date(chapter.earlyAccessUntil) > now) {
      const opensAt = new Date(new Date(chapter.earlyAccessUntil).getTime() - sub.earlyHours * 3600 * 1000);
      if (opensAt > now) {
        return {
          chapter,
          locked: true,
          owned: false,
          priceCredits: 0,
          reason: GATE_REASONS.EARLY_ACCESS,
          availableAt: opensAt,
        };
      }
    }

    if (sub.unmetered) {
      return {
        chapter,
        locked: false,
        owned: false,
        free: true,
        priceCredits: 0,
        reason: PRICE_REASONS.SUBSCRIPTION,
        viaSubscription: true,
      };
    }

    const priced = resolveChapterPrice({ novel, chapter, rules, config, now });
    const priceCredits =
      priced.free || !sub.discountPct
        ? priced.priceCredits
        : Math.max(1, Math.round(priced.priceCredits * (1 - sub.discountPct / 100)));

    return {
      chapter,
      locked: !priced.free,
      owned: false,
      free: priced.free,
      priceCredits,
      subscriberDiscountPct: !priced.free && sub.discountPct ? sub.discountPct : undefined,
      freeUnlocksLeft: !priced.free && sub.freeUnlocksLeft ? sub.freeUnlocksLeft : undefined,
      reason: priced.reason,
      ruleId: priced.ruleId,
    };
  });
};

/**
 * Recognize revenue for one unlock.
 *
 * Writes the durable RevenueEvent first — that row is what rollups rebuild
 * from, and it is the only copy that survives a rental lapsing or a novel being
 * binned. The live daily bump after it is a latency optimization so the
 * dashboard moves before the hourly rollup runs; the rebuild overwrites it from
 * the ledger either way.
 */
const recordRevenue = async ({
  chapter,
  novel,
  chapterNumber,
  user = null,
  kind = REVENUE_EVENT_KINDS.UNLOCK,
  source = '',
  creditsSpent = 0,
  attributedUsdMicros,
  grantFundedCredits = null,
  transaction = null,
  idempotencyKey = null,
  attribution = null,
  creditsPerUsd = null,
}) => {
  await revenueService.record({
    chapter,
    novel,
    chapterNumber,
    user,
    kind,
    source,
    creditsSpent,
    attributedUsdMicros,
    grantFundedCredits,
    transaction,
    idempotencyKey,
    attribution,
    creditsPerUsd,
  });
  // Recorded even for a zero-cash unlock, so unlock counts stay right when a
  // reader pays with granted credits.
  await require('./readTrackingService').recordUnlock({
    chapter,
    novel,
    chapterNumber,
    creditsSpent,
    attributedUsdMicros,
  });
};

const rentalExpiry = (hours) => (hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000) : null);

/**
 * Spend credits on one chapter.
 *
 * Ordering matters. The wallet debit happens first because it is the atomic
 * gate; the ChapterAccess unique index then makes a concurrent duplicate
 * impossible. If the access row loses that race we refund rather than charge
 * twice for something already owned.
 */
const unlockChapter = async ({ user, novel, chapter }) => {
  // Nothing to buy: the chapter is already open to this account. Reported as
  // already-owned rather than as an error, so a stale client that still shows
  // an Unlock button lands the reader on the chapter instead of on a 409.
  if (readsFree(user)) return { alreadyOwned: true, access: null, staffBypass: true };

  const config = await pricingConfig();
  if (!config.monetizationEnabled) throw badRequest('Monetization is disabled', 409);

  const access = await resolveAccess({ novel, chapter, user, config });
  if (access.owned) return { alreadyOwned: true, access: null };
  if (!access.locked) throw badRequest('This chapter is already free', 409);
  if (access.reason === GATE_REASONS.EARLY_ACCESS) {
    throw badRequest('This chapter is not available yet', 403);
  }

  const price = access.priceCredits;
  const novelConfig = resolveNovelMonetization(novel);
  const expiresAt = rentalExpiry(novelConfig && novelConfig.accessMode === 'rental' ? novelConfig.rentalHours : 0);

  // A subscriber's per-cycle allowance is spent before their credits are: it
  // expires with the cycle, so saving it for later just wastes it.
  if (access.freeUnlocksLeft) {
    const claimed = await subscriptionService.claimFreeUnlock(user._id);
    if (claimed) {
      try {
        const row = await ChapterAccess.create({
          user: user._id,
          chapter: chapter._id,
          novel: novel._id,
          source: ACCESS_SOURCES.SUBSCRIPTION,
          creditsSpent: 0,
          attributedUsdMicros: claimed.attributedUsdMicros,
          expiresAt,
        });
        await recordRevenue({
          chapter: chapter._id,
          novel: novel._id,
          chapterNumber: chapter.number,
          user: user._id,
          kind: REVENUE_EVENT_KINDS.SUBSCRIPTION,
          source: ACCESS_SOURCES.SUBSCRIPTION,
          creditsSpent: 0,
          attributedUsdMicros: claimed.attributedUsdMicros,
          idempotencyKey: `sub-unlock:${row._id}`,
        });
        return {
          alreadyOwned: false,
          access: row,
          spent: 0,
          viaSubscription: true,
          freeUnlocksLeft: claimed.remaining,
        };
      } catch (error) {
        if (error.code !== 11000) throw error;
        // Someone else already unlocked it; hand the allowance back.
        await require('../models/Subscription').updateOne(
          { _id: claimed.subscription._id },
          { $inc: { freeUnlocksUsedThisCycle: -1 } }
        );
        return { alreadyOwned: true, access: null };
      }
    }
  }

  // The key has to identify THIS purchase, not the (reader, chapter) pair.
  //
  // A rental deletes its entitlement when it lapses, so the same chapter can be
  // bought again — and a pair-scoped key made the second purchase replay the
  // first debit, handing out every re-rental free forever. Counting the
  // purchases already in the ledger gives a stable epoch: two clicks in the
  // same instant both see the same count and stay idempotent, while a genuine
  // repurchase after the first one settled sees a higher one.
  const priorPurchases = await revenueService.purchaseCount(user._id, chapter._id);
  const idempotencyKey = `unlock:${user._id}:${chapter._id}:${priorPurchases}`;

  const debited = await creditService.debit({
    user,
    amount: price,
    idempotencyKey,
    refType: CREDIT_REF_TYPES.CHAPTER,
    refId: chapter._id,
    novel: novel._id,
    chapter: chapter._id,
    description: `Unlocked chapter ${chapter.number}: ${chapter.title}`,
    reason: 'chapter unlock',
  });

  try {
    const row = await ChapterAccess.create({
      user: user._id,
      chapter: chapter._id,
      novel: novel._id,
      source: ACCESS_SOURCES.CREDITS,
      creditsSpent: price,
      attributedUsdMicros: debited.attributedUsdMicros,
      transaction: debited.transaction._id,
      expiresAt,
    });
    await recordRevenue({
      chapter: chapter._id,
      novel: novel._id,
      chapterNumber: chapter.number,
      user: user._id,
      kind: REVENUE_EVENT_KINDS.UNLOCK,
      source: ACCESS_SOURCES.CREDITS,
      creditsSpent: price,
      attributedUsdMicros: debited.attributedUsdMicros,
      grantFundedCredits: debited.grantFundedCredits,
      transaction: debited.transaction._id,
      idempotencyKey: `unlock:${debited.transaction._id}:${chapter._id}`,
    });
    // Nudge once when the balance crosses the low threshold, so the reader
    // finds out before they hit a wall mid-chapter.
    await require('./creditNotificationService').maybeLowBalance(user, debited.wallet.balance);
    return { alreadyOwned: false, access: row, spent: price, transaction: debited.transaction };
  } catch (error) {
    if (error.code === 11000) {
      // Concurrent unlock won. Give the credits back — the reader owns it either way.
      if (!debited.replayed) {
        // Restore the tranches rather than minting zero-cost credits, or the
        // cash behind these credits becomes neither deferred nor recognized.
        await creditService.reverseSpend({
          user,
          transaction: debited.transaction,
          idempotencyKey: `${idempotencyKey}:reversal`,
          reason: 'duplicate unlock refunded',
          description: 'Chapter was already unlocked',
        });
      }
      return { alreadyOwned: true, access: null };
    }
    throw error;
  }
};

/**
 * Unlock several chapters in one debit.
 *
 * The bulk discount applies to the total, and the discounted cash is attributed
 * back to each chapter pro-rata by list price — so an expensive chapter in the
 * bundle earns proportionally more than a cheap one.
 */
const unlockChapters = async ({ user, novel, chapters }) => {
  // Shape must match the success return below — the controller spreads this
  // straight into the HTTP response, so `unlocked` is a count and the spend
  // field is `spent`. Returning a different shape here would hand the client
  // an array where it expects a number.
  if (readsFree(user)) {
    return {
      unlocked: 0,
      listTotal: 0,
      discountPct: 0,
      spent: 0,
      transaction: null,
      alreadyOwned: true,
      staffBypass: true,
    };
  }

  const config = await pricingConfig();
  if (!config.monetizationEnabled) throw badRequest('Monetization is disabled', 409);
  if (!config.allowBulkUnlock) throw badRequest('Bulk unlock is disabled', 403);
  if (!chapters.length) throw badRequest('No chapters selected');

  const rules = await loadRules();
  const ownedIds = await ownedChapterIds(user._id, novel._id);
  const sub = await subscriptionContext(user, novel);
  if (sub.unmetered) {
    throw badRequest('Your subscription already includes these chapters', 409);
  }

  const payable = [];
  for (const chapter of chapters) {
    if (ownedIds.has(String(chapter._id))) continue;
    if (chapter.earlyAccessUntil && new Date(chapter.earlyAccessUntil) > new Date()) continue;
    const priced = resolveChapterPrice({ novel, chapter, rules, config, now: new Date() });
    if (priced.free) continue;
    const price = sub.discountPct
      ? Math.max(1, Math.round(priced.priceCredits * (1 - sub.discountPct / 100)))
      : priced.priceCredits;
    payable.push({ chapter, price });
  }
  if (!payable.length) throw badRequest('Nothing to unlock — those chapters are free or already owned', 409);

  const novelConfig = resolveNovelMonetization(novel);
  const tiers =
    novelConfig && novelConfig.bulkDiscountTiers && novelConfig.bulkDiscountTiers.length
      ? novelConfig.bulkDiscountTiers
      : config.bulkDiscountTiers;

  const listTotal = payable.reduce((sum, entry) => sum + entry.price, 0);
  const discountPct = bulkDiscountPct(payable.length, tiers);
  const total = Math.max(1, Math.round(listTotal * (1 - discountPct / 100)));

  // Same purchase-epoch treatment as the single unlock above: without it a
  // second bulk buy of chapters whose rentals have lapsed replays the first
  // debit and costs nothing.
  const priorPurchases = await revenueService.purchaseCount(
    user._id,
    payable.map((entry) => entry.chapter._id)
  );
  const idempotencyKey = `bulk:${user._id}:${novel._id}:${payable
    .map((entry) => entry.chapter._id)
    .sort()
    .join(',')}:${priorPurchases}`;

  const debited = await creditService.debit({
    user,
    amount: total,
    idempotencyKey,
    refType: CREDIT_REF_TYPES.CHAPTER,
    refId: novel._id,
    novel: novel._id,
    description: `Unlocked ${payable.length} chapters of ${novel.title}`,
    reason: 'bulk unlock',
    metadata: { chapterCount: payable.length, listTotal, discountPct },
  });

  // Attribute pro-rata by list price; the last chapter absorbs the rounding
  // remainder so the parts sum exactly to the debit.
  const rows = [];
  let allocated = 0;
  payable.forEach((entry, index) => {
    const isLast = index === payable.length - 1;
    const micros = isLast
      ? debited.attributedUsdMicros - allocated
      : Math.floor((debited.attributedUsdMicros * entry.price) / listTotal);
    allocated += micros;
    rows.push({
      user: user._id,
      chapter: entry.chapter._id,
      novel: novel._id,
      source: ACCESS_SOURCES.BULK,
      creditsSpent: entry.price,
      attributedUsdMicros: micros,
      transaction: debited.transaction._id,
      expiresAt: rentalExpiry(novelConfig && novelConfig.accessMode === 'rental' ? novelConfig.rentalHours : 0),
    });
  });

  // ordered:false so a chapter someone else unlocked mid-flight does not abort
  // the rest of the batch.
  await ChapterAccess.insertMany(rows, { ordered: false }).catch((error) => {
    if (error.code !== 11000 && !error.writeErrors) throw error;
  });

  // Which rows actually landed. Read back rather than inspecting driver error
  // shapes: every row we inserted carries this debit's transaction id, and a
  // pre-existing row from someone else's unlock carries a different one. A
  // chapter that lost the race was still charged for in `total`, and
  // attributing revenue for it — as this did before — booked money against a
  // chapter the reader already owned and then vanished on the next rebuild,
  // because no ChapterAccess row existed to rebuild it from.
  const landed = await ChapterAccess.find({ transaction: debited.transaction._id }).select('chapter');
  const landedIds = new Set(landed.map((row) => String(row.chapter)));

  const attributed = [];
  const lost = [];
  rows.forEach((row, index) => {
    (landedIds.has(String(row.chapter)) ? attributed : lost).push({ row, entry: payable[index] });
  });

  // Give back what was charged for chapters the reader turned out to own,
  // restoring the tranches rather than minting zero-cost credits.
  let refunded = 0;
  let restoredMicros = 0;
  if (lost.length) {
    const lostList = lost.reduce((sum, item) => sum + item.entry.price, 0);
    refunded = Math.min(total, Math.round((total * lostList) / listTotal));
    if (refunded > 0) {
      const reversal = await creditService.reverseSpend({
        user,
        transaction: debited.transaction,
        credits: refunded,
        idempotencyKey: `${idempotencyKey}:reversal`,
        reason: 'bulk unlock partially already owned',
        description: `Refund for ${lost.length} chapter(s) already owned`,
        metadata: { chapters: lost.map((item) => item.entry.chapter.number) },
      });
      restoredMicros = reversal.restoredMicros || 0;
    }
  }

  // Re-split the cash that is actually still spent across the chapters that
  // actually landed. The provisional split above covered every payable chapter;
  // leaving it in place would keep the refunded cash attributed as revenue and
  // deferred in the tranche at the same time.
  const attributable = Math.max(0, debited.attributedUsdMicros - restoredMicros);
  // Grant-funded credits are shared out on the same basis as the cash, so a
  // part-granted bulk buy reports the same free-funded share on every chapter
  // rather than dumping it all on whichever one rounded to zero.
  // reverseSpend gives credits back proportionally across every tranche the
  // debit drew from, so what remains grant-funded shrinks in the same
  // proportion — not by subtracting the refund from the granted part first.
  const grantFunded = total > 0
    ? Math.round(((debited.grantFundedCredits || 0) * (total - refunded)) / total)
    : 0;
  const landedList = attributed.reduce((sum, item) => sum + item.entry.price, 0) || 1;
  let given = 0;
  let grantGiven = 0;
  attributed.forEach((item, index) => {
    const isLast = index === attributed.length - 1;
    item.micros = isLast ? attributable - given : Math.floor((attributable * item.entry.price) / landedList);
    given += item.micros;
    item.grantFunded = isLast
      ? Math.max(0, grantFunded - grantGiven)
      : Math.floor((grantFunded * item.entry.price) / landedList);
    grantGiven += item.grantFunded;
  });

  if (attributed.length && lost.length) {
    await ChapterAccess.bulkWrite(
      attributed.map((item) => ({
        updateOne: {
          filter: { user: user._id, chapter: item.row.chapter },
          update: { $set: { attributedUsdMicros: item.micros } },
        },
      })),
      { ordered: false }
    );
  }

  // Attribution is resolved once for the batch — it is the same novel.
  const attribution = await revenueService.resolveAttribution(novel._id);
  const creditsPerUsd = await settingsService.get('credits.perUsd');

  await Promise.all(
    attributed.map((item) =>
      recordRevenue({
        chapter: item.row.chapter,
        novel: novel._id,
        chapterNumber: item.entry.chapter.number,
        user: user._id,
        kind: REVENUE_EVENT_KINDS.BULK_UNLOCK,
        source: ACCESS_SOURCES.BULK,
        creditsSpent: item.row.creditsSpent,
        attributedUsdMicros: item.micros,
        grantFundedCredits: item.grantFunded,
        transaction: debited.transaction._id,
        idempotencyKey: `bulk-unlock:${debited.transaction._id}:${item.row.chapter}`,
        attribution,
        creditsPerUsd,
      })
    )
  );

  return {
    unlocked: attributed.length,
    alreadyOwnedCount: lost.length,
    refunded,
    listTotal,
    discountPct,
    spent: total - refunded,
    transaction: debited.transaction,
  };
};

/** Quote a bulk unlock without committing it. */
const quoteBulk = async ({ user, novel, chapters }) => {
  const config = await pricingConfig();
  const rules = await loadRules();
  const ownedIds = await ownedChapterIds(user && user._id, novel._id);
  const sub = await subscriptionContext(user, novel);

  // Nothing is payable for an account that reads free, so the quote is empty
  // and the totals below fall out as zero without a special case.
  const payable = readsFree(user) || sub.unmetered
    ? []
    : chapters
        .filter((chapter) => !ownedIds.has(String(chapter._id)))
        .map((chapter) => ({ chapter, priced: resolveChapterPrice({ novel, chapter, rules, config }) }))
        .filter((entry) => !entry.priced.free)
        .map((entry) => ({
          chapter: entry.chapter,
          priced: {
            ...entry.priced,
            priceCredits: sub.discountPct
              ? Math.max(1, Math.round(entry.priced.priceCredits * (1 - sub.discountPct / 100)))
              : entry.priced.priceCredits,
          },
        }));

  const novelConfig = resolveNovelMonetization(novel);
  const tiers =
    novelConfig && novelConfig.bulkDiscountTiers && novelConfig.bulkDiscountTiers.length
      ? novelConfig.bulkDiscountTiers
      : config.bulkDiscountTiers;

  const listTotal = payable.reduce((sum, entry) => sum + entry.priced.priceCredits, 0);
  const discountPct = bulkDiscountPct(payable.length, tiers);
  const total = payable.length ? Math.max(1, Math.round(listTotal * (1 - discountPct / 100))) : 0;
  const balance = user ? await creditService.getBalance(user) : 0;

  return {
    chapterCount: payable.length,
    chapters: payable.map((entry) => ({
      id: entry.chapter._id,
      number: entry.chapter.number,
      title: entry.chapter.title,
      priceCredits: entry.priced.priceCredits,
    })),
    listTotal,
    discountPct,
    subscriberDiscountPct: sub.discountPct || undefined,
    includedInSubscription: sub.unmetered || undefined,
    total,
    balance,
    canAfford: balance >= total,
  };
};

/** How many readers paid for this chapter — used by the delete guard. */
const purchaseSummary = async (chapterIds) => {
  const [row] = await ChapterAccess.aggregate([
    { $match: { chapter: { $in: chapterIds }, creditsSpent: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        purchases: { $sum: 1 },
        credits: { $sum: '$creditsSpent' },
        micros: { $sum: '$attributedUsdMicros' },
      },
    },
  ]);
  return row
    ? { purchases: row.purchases, credits: row.credits, usdCents: Math.round(row.micros / MICROS_PER_CENT) }
    : { purchases: 0, credits: 0, usdCents: 0 };
};

module.exports = {
  pricingConfig,
  loadRules,
  ownedChapterIds,
  subscriptionContext,
  resolveAccess,
  resolveNovelChapters,
  unlockChapter,
  unlockChapters,
  quoteBulk,
  purchaseSummary,
};
