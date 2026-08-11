# Monetization Architecture — Credits, PayPal, Revenue Attribution

**Status:** Design proposal v2 (revised after gap analysis)
**Date:** 2026-08-08
**Companion doc:** [`admin-portal-spec.md`](./admin-portal-spec.md) — every setting, page and chart in the admin portal
**Scope:** Paid chapter unlocks via a credit currency, PayPal checkout with worldwide currency handling, admin-controlled free-credit rollouts, subscriptions, coupons, per-novel and per-chapter revenue attribution.

> **v2 changes:** added cost-basis revenue attribution (§6) so chapter revenue maps to real cash; resolved all six open questions into admin-controlled config; folded in fixes for four blockers found during code review (§4); added author revenue share, tax, refund workflow and geo models.

---

## 1. Read this first — four constraints that shape everything

**1. PayPal settles in only 25 currencies. INR is not one of them.**
Per [PayPal's currency codes reference](https://developer.paypal.com/api/codes/currency) (updated 13 Jul 2026): AUD, BRL, CAD, CNY, CZK, DKK, EUR, HKD, HUF, ILS, JPY, MYR, MXN, TWD, NZD, NOK, PHP, PLN, GBP, RUB, SEK, SGD, CHF, THB, USD.

No INR, AED, ZAR, KRW, IDR, VND, NGN. For a reader in India — likely a large share of a web-novel audience — you cannot create a PayPal order denominated in rupees. It settles in USD and PayPal converts buyer-side. So `settlementMode` is a **per-currency capability**, not a global switch, and for most of the world the local figure is a clearly-labelled estimate.

**2. JPY, HUF and TWD reject decimal amounts.** All money math is integer minor units with a per-currency exponent. No floats, anywhere.

**3. Credit face value is not revenue.** A user paying $9.99 for "1000 credits + 200 bonus" did not buy 1200 credits at 1¢ each. If you report chapter revenue as `creditsSpent ÷ creditsPerUsd` you will overstate it by exactly the bonus rate, and free granted credits will manufacture revenue out of nothing. §6 solves this properly with cost-basis tracking. **This is why credit buckets are in Phase 1** — the per-chapter revenue you asked for is not computable without them.

**4. Native mobile app wrappers trigger Apple/Google IAP rules** (~15–30% cut, external payment for digital content forbidden). Web-only is unaffected. Worth knowing before pricing is set.

---

## 2. Design principles

| Principle | Why |
|---|---|
| **Credits are integers. Money is integer minor units.** | `priceUsdCents: 999`, never `9.99`. |
| **Ledger-first accounting.** | `CreditTransaction` is append-only truth; `Wallet.balance` is a rebuildable cache. Any bug is recoverable. |
| **Cash is attributed, never assumed.** | Every credit carries a cost basis. Chapter revenue sums to actual money received — provably (§6.4). |
| **Everything is idempotent.** | Networks retry, PayPal replays webhooks, users double-click. Every credit-granting path has a key behind a unique index. |
| **Never trust a client price.** | Server recomputes, locks into an `Order`, re-verifies the capture before crediting. |
| **Config resolves through a chain.** | Global → novel → chapter → dynamic rule. Mirrors the existing `readingGate.override` pattern. |
| **Financial records are immutable.** | No `softDelete` plugin on ledger, orders, buckets, payouts, tax records. |
| **Every config change is audited, every subsystem has a kill switch.** | Money needs a who/what/before/after trail and an off button that doesn't need a deploy. |

---

## 3. What already exists that we build on

| Existing | Reused how |
|---|---|
| `models/schemas/readingGate.js` — `buildReadingGateSchema(extraFields)` shared by settings + novel with an `override` switch | Exact pattern copied for `buildMonetizationSchema()` across settings / novel / chapter |
| `utils/readingGate.js` — `evaluateReadingGate()` → `{locked, reason, requirements}` | Credit gate becomes a third reason in the same pipeline; no rewrite |
| `services/notificationService.js` — channel resolution, global toggles, per-user prefs, 250-row batching | Credit notifications route through `dispatchNotification()`; we add types + templates |
| `models/Campaign.js` — audience targeting + recipient count | `GrantCampaign` is its richer sibling |
| `models/plugins/softDelete.js` | Applied to packs/coupons/plans. **Never** to financial records |
| `middlewares/errorHandler.js` — `asyncHandler` + `err.status` convention | All new routes follow it (there is no express-async-errors; an unwrapped throw hangs the request) |
| `controllers/chapterController.js` — already withholds content server-side on a locked gate and skips the view count | The paywall has a correct foundation; we extend rather than re-secure it |
| Jest + Supertest + `mongodb-memory-server` | Ready, but needs replica-set mode (§4.2) |

---

## 4. Pre-flight: four fixes that must land before Phase 1

Found by reading the current code. Each is independently worth doing.

### 4.1 Webhook route must live outside `/api`

`app.js` mounts `app.use('/api', maintenanceGuard)` **before** every router, and `req.user` is only populated by `protect`/`optionalAuth` *inside* routers. Two consequences:

- A webhook at `/api/webhooks/paypal` is not in `EXEMPT_PREFIXES`, so **enabling maintenance mode 503s every PayPal webhook.** PayPal retries for ~3 days, then gives up. Users who paid never get credits.
- Separately, `maintenanceGuard`'s `req.user.role === ADMIN` exemption is **dead code today** — `req.user` is always undefined there. Admins are locked out of their own site except via the prefix list.

**Fix:** mount webhooks at `/webhooks/paypal` (outside `/api`) and add `optionalAuth` before `maintenanceGuard`, or move the guard inside each router. Both changes are small and the second fixes an existing bug.

### 4.2 Test harness needs a replica set

`tests/setup.js` uses `MongoMemoryServer.create()` — standalone. Any transaction throws *"Transaction numbers are only allowed on a replica set member or mongos."* Switch to:

```js
const { MongoMemoryReplSet } = require('mongodb-memory-server');
mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
```

Adds a few seconds to suite startup across all 19 existing test files. **Production caveat:** transactions need a replica set there too. Atlas is fine; a bare `mongod` is not. Hence `TRANSACTIONS_ENABLED` (§4.5).

### 4.3 Purchased chapters must not be deletable

`Chapter` and `Novel` both carry the softDelete plugin and `deleteChapter` exists. Nothing stops deleting a chapter 400 people paid for — and the plugin's read hooks make `ChapterAccess.populate('chapter')` return `null` rather than error, so it fails silently.

**Fix:** a `guardPurchasedContent` check in the delete paths, with admin-configurable behaviour (`safety.onChapterDelete`: `block` | `refund_credits` | `refund_and_notify`) and a confirmation dialog stating *"This chapter has 412 purchases worth 4,120 credits ($34.20 attributed). Deleting will refund all of them."*

### 4.4 `readChapter` leaks private S3 keys

`res.json({ chapter })` ships the raw Mongoose document — including `sourceFile.key` and `sourceFile.name` — to every reader. Pre-existing and unrelated to payments, but it means every field added to `Chapter` auto-leaks (`priceCredits`, cost data, `earlyAccessUntil`).

**Fix:** a `serializeChapter()` whitelist, mirroring the existing `getPublicSettings` and `serializeUser` pattern, before Phase 1 touches the model.

### 4.5 Also required before Phase 1

| Item | Detail |
|---|---|
| **Rate limiting** | Nothing exists in the app. Add `express-rate-limit` with per-route configs (§10) driven by admin settings |
| **`optionalAuth` on `listChapters`** | Currently absent, so the chapter list cannot show owned/locked/price state. Also extend its `.select()` |
| **`Chapter.publishedAt`** | Doesn't exist. `createdAt` is wrong — a chapter drafted in January and published in August would be instantly free under `freeAfterDays`. Add the field, set it on the `published` false→true transition in both `createChapter` and `updateChapter`, backfill existing rows from `createdAt` |
| **`Chapter.wordCount`** | Backfill by stripping HTML from `content` in a one-time script |
| **Wallet lazy-creation** | Upsert on first touch and create at signup, so the atomic debit isn't accidentally right-for-the-wrong-reason |
| **`Wallet.balance` in `serializeUser()`** | Otherwise the navbar credit display costs an extra round-trip on every page |
| **`lastActiveAt` strategy** | Needed for audience targeting. Throttled write (only if stale >1h) or derive from the existing `ReadingProgress.updatedAt`, which is cheaper |
| **`orderNumber` generation** | Use a `Counter` collection with atomic `findOneAndUpdate($inc)`, or a ULID. A naive sequence collides under concurrency |
| **Renumber guard** | `freeChapterCount` keys on `chapter.number`, which admins can reorder. Paid chapters can slide into the free zone. Config: `safety.freezeFreeCountByOriginalNumber` |
| **Bulk-import guard** | `bulkUploadChapters` defaults `published: true`; dropping 200 chapters into a monetized novel instantly paywalls all of them. Config: `import.defaultAccessType` + `import.requirePricingConfirmation` |
| **Grants must not use `setImmediate`** | `dispatchCampaign`'s fire-and-forget silently drops the remainder on restart with no resume. Money campaigns need the persisted cursor (§5.13) driven by a cron worker |

---

## 5. Data model

```
User ──1:1── Wallet ──1:N── CreditBucket ───────────┐  (carries cost basis)
              │                                      │
              └──1:N── CreditTransaction ────────────┤
                            ▲                        │
     ┌──────────────────────┼───────────┬────────────┴────┐
  Order                GrantCampaign  ChapterAccess    Subscription
 (cash in)             (free credits) (what's owned)   (recurring)
     │                                     │
 WebhookEvent                     ChapterRevenueDaily ──► NovelRevenueDaily
 RefundRequest                         (rollups)              │
 TaxTransaction                                          AuthorPayout
```

### 5.1 `Wallet`

Separate collection — the balance is the hottest write path and shouldn't contend with profile writes or bloat `User` docs that are populated everywhere.

```js
{
  user: ObjectId,              // unique
  balance: Number,             // integer credits; cache of the ledger
  lifetimePurchased, lifetimeGranted, lifetimeSpent, lifetimeExpired, lifetimeRefunded: Number,
  lifetimeSpendUsdCents: Number,     // real cash, for audience targeting + whale analysis
  autoUnlock: { enabled, maxPriceCredits, novels: [ObjectId] },
  lowBalanceNotifiedAt: Date,
  flags: { negative: Boolean, disputeFrozen: Boolean, refundBlocked: Boolean },
  lastTransactionAt: Date,
}
```

Spending is one conditional update, never read-modify-write:

```js
Wallet.findOneAndUpdate(
  { user: userId, balance: { $gte: price } },
  { $inc: { balance: -price, lifetimeSpent: price } },
  { new: true, session }
)   // null === insufficient funds. No race possible.
```

### 5.2 `CreditBucket` — tranches with cost basis

**Now core, not optional.** Buckets are what make per-chapter cash revenue computable, and expiry rides along for free.

```js
{
  user: ObjectId,
  source: 'purchase' | 'grant' | 'subscription' | 'referral' | 'adjustment',
  sourceRef: ObjectId,
  amount: Number,               // credits originally issued
  remaining: Number,            // decremented as spent
  totalCostMicros: Number,      // real cash behind this tranche, micro-USD (1¢ = 10,000)
  remainingCostMicros: Number,  // decremented in lockstep with `remaining`
  expiresAt: Date | null,
  createdAt: Date,
}
```

Indexes: `{ user: 1, expiresAt: 1, remaining: 1 }` (consumption scan), `{ expiresAt: 1, remaining: 1 }` (sweeper).

Grants have `totalCostMicros: 0` — free credits generate zero revenue when spent, which is correct and is the whole point.

### 5.3 `CreditTransaction` — the ledger

Append-only. No soft delete, no updates after creation.

```js
{
  user: ObjectId,
  type: 'purchase'|'grant'|'spend'|'refund'|'expire'|'adjustment'|'reversal'|'subscription_grant'|'referral',
  amount: Number,               // SIGNED: +500 credit, -10 debit
  balanceAfter: Number,         // snapshot, for statements + drift detection
  attributedUsdMicros: Number,  // cash recognized by this transaction (§6)
  bucketBreakdown: [{ bucket: ObjectId, credits: Number, costMicros: Number }],
  reason: String,               // admin-facing
  description: String,          // user-facing, from a template
  refType: 'order'|'chapter'|'grant_campaign'|'subscription'|'coupon'|'admin'|null,
  refId: ObjectId,
  novel: ObjectId,              // denormalized for fast revenue rollups
  chapter: ObjectId,
  idempotencyKey: String,       // UNIQUE sparse — the double-credit guard
  metadata: Mixed,
  createdBy: ObjectId,
  createdAt: Date,
}
```

Indexes: `{user:1, createdAt:-1}`, `{idempotencyKey:1}` unique sparse, `{type:1, createdAt:-1}`, `{novel:1, createdAt:-1}`, `{chapter:1, createdAt:-1}`, `{refType:1, refId:1}`.

**Idempotency key conventions** — what makes the system safe:

| Operation | Key |
|---|---|
| Order capture (client path) | `order:<orderId>:capture` |
| Order capture (webhook path) | *same key* — the two paths converge harmlessly |
| Grant campaign | `grant:<campaignId>:<runIndex>:<userId>` |
| Subscription cycle | `sub:<subscriptionId>:<cycleNumber>` |
| Chapter unlock | `unlock:<userId>:<chapterId>` |
| Refund clawback | `refund:<captureId>` |
| Bucket expiry | `expire:<bucketId>` |

### 5.4 `CreditPack`

```js
{
  name, slug, description,
  credits, bonusCredits, bonusPct: Number,
  priceUsdCents: Number,          // the ONE canonical price; every currency derives from it
  compareAtUsdCents: Number,      // strikethrough anchor
  badge, badgeColor, imageUrl, sortOrder, active,
  visibility: { newUsersOnly, firstPurchaseOnly, minAccountAgeDays,
                allowedCountries: [String], blockedCountries: [String],
                subscribersOnly, requiredTier },
  limits: { perUserTotal, perUserPerDay, globalStock, globalSold },
  availableFrom: Date, availableUntil: Date,
}
```

Admin never types a price in EUR or JPY. One USD price, 25+ derived. That's what keeps a multi-currency catalogue maintainable.

### 5.5 `Currency`

```js
{
  code: 'EUR',                    // unique, ISO-4217
  name, symbol, symbolPosition: 'before'|'after',
  enabled: Boolean,
  decimals: Number,               // 2, or 0 for JPY/HUF/TWD
  paypalSupported: Boolean,       // DERIVED from a constant — read-only in the admin UI
  settlementMode: 'local'|'usd',  // 'local' honoured only when paypalSupported
  rateSource: 'auto'|'manual',
  autoRate, manualRate, markupPct: Number,
  rounding: 'none'|'nearest_int'|'ceil_int'|'charm_99'|'charm_95'|'nearest_10'|'nearest_50'|'nearest_100',
  minChargeMinor: Number,
  lastRateAt: Date, lastRateSource: String,
  isDefault: Boolean,
}
```

`paypalSupported` comes from a hardcoded list in `config/constants.js`, not admin-editable truth — if an admin could lie about it, the system would generate orders PayPal rejects. Validation also rejects `charm_99` on a zero-decimal currency.

### 5.6 `Order`

Immutable. No soft delete.

```js
{
  orderNumber: String,            // from a Counter collection, atomic
  user: ObjectId,
  pack: ObjectId, packSnapshot: Mixed,     // frozen — the pack may change later
  credits, bonusCredits, totalCredits: Number,

  baseUsdCents, discountUsdCents, netUsdCents: Number,
  taxUsdCents: Number, taxRatePct: Number, taxCountry: String, taxInclusive: Boolean,
  paypalFeeUsdCents: Number,      // from seller_receivable_breakdown.paypal_fee
  netAfterFeeUsdCents: Number,    // what actually lands in your account

  coupon: ObjectId, couponCode: String,
  chargeCurrency: String, chargeAmountMinor: Number,
  fxRateUsed, fxMarkupPct: Number, fxRateAt: Date, isEstimateDisplay: Boolean,

  provider: 'paypal',
  paypalOrderId, paypalCaptureId, paypalPayerId, paypalPayerEmail: String,

  status: 'created'|'approved'|'captured'|'failed'|'refunded'
        |'partially_refunded'|'disputed'|'expired'|'cancelled',
  creditedAt: Date,               // the double-credit guard
  refundedUsdCents, creditsClawedBack: Number,
  quoteExpiresAt: Date,           // ~15 min price lock
  ipAddress, ipCountry, userAgent, failureReason: String,
  events: [{ at, type, source: 'client'|'webhook'|'admin'|'cron', data }],
}
```

Do **not** set PayPal's `invoice_id` — it's globally unique per merchant account, so a retried creation throws `DUPLICATE_INVOICE_ID`. Use `custom_id` for our order id.

### 5.7 `WebhookEvent`

```js
{
  provider: 'paypal',
  eventId: String,      // UNIQUE — PayPal's id. Replays die here and nowhere else.
  eventType, resourceId: String,
  payload: Mixed,
  signatureVerified: Boolean,
  status: 'received'|'processed'|'failed'|'ignored',
  attempts: Number, lastError: String, processedAt: Date,
}
```

Every webhook persists here *before* any business logic. Reprocessing becomes a one-click admin action; a replay storm is a no-op.

### 5.8 `Coupon` + `CouponRedemption`

```js
{
  code: String,                   // uppercase, unique
  type: 'percent_off'|'fixed_off_usd'|'bonus_credits'|'bonus_percent',
  value: Number,
  appliesTo: 'all_packs'|'specific_packs'|'subscriptions'|'all',
  packs: [ObjectId], plans: [ObjectId],
  minSpendUsdCents, maxDiscountUsdCents: Number,
  maxRedemptions, redemptionCount, maxPerUser: Number,
  startsAt, endsAt: Date,
  newUsersOnly, firstPurchaseOnly: Boolean,
  allowedCountries: [String],
  audienceRule: AudienceRule,     // same resolver as grants — arbitrary targeting
  stackable, active: Boolean,
  campaignTag: String,            // groups bulk-generated batches for reporting
}
// CouponRedemption { coupon, user, order, discountUsdCents, bonusCredits, at }
//   unique (coupon, order); counted per user for maxPerUser
```

### 5.9 `SubscriptionPlan` + `Subscription`

```js
// SubscriptionPlan — local mirror of a PayPal billing plan
{
  name, tier, description, sortOrder, active,
  priceUsdCents: Number, interval: 'month'|'year', intervalCount, trialDays: Number,
  monthlyCredits: Number, creditsExpireWithCycle: Boolean,
  perks: {
    freeUnlocks: 'none'|'all'|'selected_novels'|'up_to_n_per_cycle',
    freeUnlockNovels: [ObjectId], freeUnlockLimit: Number,
    packDiscountPct, chapterDiscountPct, earlyAccessHours: Number,
    adFree: Boolean, profileBadge, badgeColor: String, prioritySupport: Boolean,
  },
  paypalProductId, paypalPlanId: String, paypalSyncedAt: Date,
}

// Subscription
{
  user, plan, planSnapshot: Mixed,
  paypalSubscriptionId: String,   // unique
  status: 'approval_pending'|'active'|'past_due'|'suspended'|'cancelled'|'expired',
  currentPeriodStart, currentPeriodEnd, nextBillingAt: Date,
  cyclesCompleted, lastGrantedCycle: Number,   // cycle-grant idempotency
  cancelAtPeriodEnd: Boolean, cancelledAt: Date, cancelReason: String,
  gracePeriodEndsAt: Date,
  freeUnlocksUsedThisCycle: Number,
  cycleNetUsdCents: Number,       // for subscription revenue attribution (§6.3)
}
```

PayPal plans are created via the [Catalog Products + Billing Plans APIs](https://developer.paypal.com/docs/subscriptions/integrate/). **Active PayPal plans are largely immutable** — a price change means a new plan plus subscriber migration. The admin UI must say this out loud; it's a common and expensive surprise.

### 5.10 `ChapterAccess`

```js
{
  user, chapter, novel: ObjectId,
  source: 'credits'|'bulk'|'subscription'|'free'|'admin_grant'|'coupon'|'timed_release',
  creditsSpent: Number,
  attributedUsdMicros: Number,    // cash this unlock recognized (§6)
  transaction: ObjectId,
  expiresAt: Date | null,         // null = permanent; set under the rental model
  unlockedAt: Date,
}
```

Indexes: `{user:1, chapter:1}` **unique** (the double-unlock guard — a duplicate-key error means "already owned", which is success, not failure), `{user:1, novel:1}` (chapter-list ownership lookup), `{chapter:1, unlockedAt:-1}` and `{novel:1, unlockedAt:-1}` (revenue rollups), `{expiresAt:1}` sparse (rental sweeper).

### 5.11 `PricingRule`

Static per-chapter prices don't scale to a catalogue. Rules do.

```js
{
  name, active: Boolean, priority: Number,     // highest wins
  scope: 'global'|'novel'|'genre'|'novel_status',
  novel: ObjectId, genres: [String], novelStatus: String,
  conditions: {
    chapterNumberFrom, chapterNumberTo,
    chapterAgeDaysFrom, chapterAgeDaysTo,
    wordCountFrom, wordCountTo: Number,
  },
  action: { mode: 'set'|'multiply'|'add'|'free', priceCredits, multiplier, delta: Number },
  validFrom, validUntil: Date,                 // scheduled sales
}
```

Expresses without code changes: "chapters 1–20 free everywhere"; "chapters older than 90 days at half price"; "double price for the first 48 hours"; "*Novel X* free this weekend"; "over 5000 words costs 15 not 10".

### 5.12 `Author` + `AuthorPayout` — revenue share

`Novel.author` is currently a free-text `String`. Add an optional `authorUser` ref so payouts have a real account behind them.

```js
// Author
{
  user: ObjectId,                 // optional link to a User account
  displayName, email: String,
  payoutMethod: 'paypal'|'manual'|'none',
  paypalEmail: String,
  defaultSharePct: Number,
  taxFormOnFile: Boolean, taxCountry: String,
  status: 'active'|'paused'|'terminated',
}

// AuthorPayout — immutable
{
  author: ObjectId, periodStart, periodEnd: Date,
  lines: [{ novel: ObjectId, grossUsdMicros, shareUsdMicros, sharePct: Number }],
  grossUsdMicros, shareUsdMicros, adjustmentsUsdMicros, netUsdMicros: Number,
  basis: 'gross'|'net_after_fees'|'net_after_fees_and_tax',
  status: 'draft'|'approved'|'paid'|'failed'|'held',
  paypalBatchId, paypalPayoutItemId: String,
  paidAt: Date, note: String,
}
```

### 5.13 `GrantCampaign` + `AudienceRule`

```js
{
  name, internalNote: String,
  amount: Number,
  amountMode: 'fixed'|'match_percent'|'top_up_to',
  //  fixed         → everyone gets `amount`
  //  match_percent → amount% of their lifetime spend (loyalty rebate)
  //  top_up_to     → bring every balance up to `amount` (nobody below X)
  maxPerUser: Number,
  audience: AudienceRule,
  schedule: { mode: 'immediate'|'scheduled'|'recurring', runAt: Date,
              cron: String, timezone: String, endsAt: Date },
  expiryDays: Number,             // 0 = never
  notify: { channels: ['in_app','email'], templateKey, title, message },
  status: 'draft'|'scheduled'|'running'|'completed'|'partially_failed'|'cancelled',
  dryRun: Boolean,
  requiresApproval: Boolean, approvedBy: ObjectId,
  stats: { targeted, granted, skipped, failed, creditsIssued },
  cursor: { lastUserId: ObjectId, processedCount: Number },   // resumable
  runs: [{ runIndex, startedAt, finishedAt, stats, error }],
  createdBy: ObjectId,
}
```

**`AudienceRule`** — declarative, compiled to an aggregation:

```js
{
  mode: 'all'|'role'|'specific'|'csv_emails'|'query',
  role, userIds: [ObjectId], emails: [String],
  query: {
    registeredBefore, registeredAfter, lastActiveBefore, lastActiveAfter: Date,
    inactiveForDays: Number,                    // win-back
    emailVerified: Boolean, country: [String],
    hasEverPurchased: Boolean,
    minLifetimeSpendUsdCents, maxLifetimeSpendUsdCents: Number,
    balanceBelow, balanceAbove: Number,
    hasActiveSubscription: Boolean, subscriptionTier: [String],
    hasNovelInLibrary: [ObjectId], hasReadNovel: [ObjectId],
    minChaptersRead, minChaptersUnlocked, minCommentCount, minReviewCount: Number,
    receivedGrantCampaign, notReceivedGrantCampaign: ObjectId,
  },
  limit: Number, orderBy: 'createdAt'|'lastActive'|'lifetimeSpend'|'random',
  excludeBanned: true,                          // always enforced
  excludeUserIds: [ObjectId],
}
```

The resolver (`services/audienceResolver.js`) exposes `count(rule)` separately from `stream(rule)`, so the admin UI shows **"this will target 12,483 users"** live as the form is edited. `notReceivedGrantCampaign` makes re-running for stragglers safe.

### 5.14 `TaxRate` + `TaxTransaction`

```js
// TaxRate
{ country: String, state: String, ratePct: Number,
  appliesToDigitalGoods: Boolean, b2bReverseCharge: Boolean,
  registrationThresholdUsd: Number, taxIdLabel: String,   // 'VAT ID', 'GSTIN'
  effectiveFrom, effectiveTo: Date, active: Boolean }

// TaxTransaction — immutable, for filing
{ order: ObjectId, country, state, ratePct, taxableUsdCents,
  taxUsdCents, customerTaxId: String, reverseCharge: Boolean, at: Date }
```

### 5.15 `RefundRequest`

```js
{ user, order: ObjectId, reason: String, requestedCredits: Number,
  status: 'pending'|'approved'|'rejected'|'processed'|'failed',
  autoApproved: Boolean, creditsAvailable: Number, creditsSpent: Number,
  resolution: 'full'|'partial'|'refused',
  revokedAccessCount: Number, reviewedBy: ObjectId, reviewNote: String,
  processedAt: Date }
```

### 5.16 Rollups

Written by a nightly job (plus incremental updates on write). Aggregating the raw ledger on every dashboard load will not stay fast.

```js
// ChapterRevenueDaily — the per-chapter revenue you asked for
{ date: Date, novel, chapter: ObjectId, chapterNumber: Number,
  unlocks, uniqueUsers, creditsSpent: Number,
  attributedUsdMicros: Number,           // real cash recognized
  faceValueUsdMicros: Number,            // credits ÷ creditsPerUsd, for comparison
  subscriptionUnlocks: Number, subscriptionAttributedMicros: Number,
  grantFundedCredits: Number,            // credits spent here that were free
  refundedUnlocks: Number, refundedUsdMicros: Number,
  readers: Number,                       // saw the chapter (gate impression or read)
  unlockRate: Number }
// unique (date, chapter)

// NovelRevenueDaily — chapter rollup + novel-scoped events
{ date, novel: ObjectId, unlocks, uniqueUsers, creditsSpent,
  attributedUsdMicros, faceValueUsdMicros, bulkUnlocks, bulkCreditsSpent,
  subscriptionAttributedMicros, newPayers, readers, refundedUsdMicros,
  authorShareUsdMicros }
// unique (date, novel)

// RevenueDaily — global
{ date, currency: String, orders, capturedOrders, failedOrders,
  grossUsdCents, discountUsdCents, taxUsdCents, feeUsdCents, netUsdCents,
  refundUsdCents, chargebackUsdCents,
  creditsIssued, creditsGranted, creditsSpent, creditsExpired,
  recognizedUsdMicros, deferredBalanceUsdMicros,
  newPayers, activePayers, subscriptionMrrUsdCents }
```

### 5.17 Extensions to existing models

**`Chapter`** — `accessType: 'inherit'|'free'|'paid'`, `priceCredits`, `freeAfterDays`, `earlyAccessUntil`, `rentalHours`, `wordCount`, `publishedAt`, `originalNumber` (renumber guard), `revenueLifetimeUsdMicros` (denormalized, for cheap sorting).

**`Novel`** — a `monetization` subdoc from the same `buildMonetizationSchema({ override })` factory used for settings:
```js
{ override, monetized: Boolean, freeChapterCount, defaultChapterPriceCredits,
  freeAfterDays: Number,
  bulkDiscountTiers: [{ minChapters, discountPct }],
  subscriptionIncluded: Boolean,
  accessMode: 'inherit'|'permanent'|'rental', rentalHours: Number,
  revenueShare: { enabled, author: ObjectId, sharePct: Number } }
```
Plus `authorUser: ObjectId` and `revenueLifetimeUsdMicros`.

**`User`** — `country`, `preferredCurrency`, `currencyLockedAt`, `lastActiveAt`, `taxId`, and notification prefs `emailPurchases` / `emailCredits` / `inAppCredits`.

**`SiteSettings`** — only `monetizationEnabled` (master kill switch). Everything else lives in a separate `MonetizationSettings` singleton so the public settings payload — fetched on every page load by `SettingsContext` — stays small. Its public projection is an explicit whitelist, mirroring `getPublicSettings`; **PayPal secrets and webhook ids are never in it.**

---

## 6. Revenue attribution — how chapter and novel revenue actually work

This is the part that makes the analytics honest.

### 6.1 The problem

A user pays **$9.99** for a pack of **1000 credits + 200 bonus**. They unlock a chapter for **10 credits**. What did that chapter earn?

- *Face value* says `10 ÷ 100 = $0.10`. Wrong — they got 1200 credits for $9.99, so a credit is worth 0.8325¢, not 1¢.
- Worse: if they'd been *given* 500 free credits in a promo, face value would report $0.10 of revenue from money that never existed.

Sum face value across a catalogue and you will report materially more revenue than your bank shows.

### 6.2 Cost-basis tracking

Every credit carries the cash that bought it, fixed at issuance:

| Source | `totalCostMicros` |
|---|---|
| Purchase | `netUsdCents × 10,000` (post-discount; post-fee if `revenueBasis = net_after_fees`) |
| Grant | `0` |
| Subscription cycle | `cycleNetUsdCents × 10,000` |
| Referral / adjustment | `0` |

Spending consumes buckets in the configured order (default: soonest-expiring first) and withdraws cost proportionally:

```js
take(bucket, n) {
  const cost = (n === bucket.remaining)
    ? bucket.remainingCostMicros                                   // last withdrawal sweeps the remainder
    : Math.floor(bucket.remainingCostMicros * n / bucket.remaining);
  bucket.remaining -= n;
  bucket.remainingCostMicros -= cost;
  return cost;
}
```

Exact, self-balancing, no rounding drift — the final withdrawal from a bucket always takes exactly what's left.

**Worked example.** $9.99 pack, 1200 credits → `totalCostMicros = 9,990,000`. Unlock a 10-credit chapter:
`floor(9,990,000 × 10 / 1200) = 83,250` micros = **$0.08325** recognized. Face value would have claimed $0.10 — an 20% overstatement.

Same user then spends 10 granted credits: cost basis 0 → **$0.00** recognized. Correct.

### 6.3 Special cases

**Bulk unlock.** One debit covering 20 chapters with a 20% discount. Attribute the discounted cash **pro-rata by each chapter's list price**, so an expensive chapter in the bundle earns proportionally more.

**Subscription free-unlocks.** A subscriber reads without spending credits. Configurable via `analytics.subscriptionAttribution`:
- `none` — chapter earns 0 (subscription revenue reported separately)
- `per_chapter_prorata` — at cycle close, split the cycle's net revenue across chapters unlocked that cycle
- `per_novel_prorata` — split across novels instead

Because this resolves at cycle close, the UI shows in-cycle unlocks as *pending attribution* rather than pretending to know.

**Refunds.** A clawback writes a negative `attributedUsdMicros` against the same chapters, so historical revenue self-corrects rather than needing a restatement.

**Expiry.** Unspent expired credits release their `remainingCostMicros` as **forfeited revenue** — real money you kept with no content delivered. Reported as its own line, never folded into chapter revenue.

**Author share** is computed off whichever `revenueBasis` is configured (`gross` / `net_after_fees` / `net_after_fees_and_tax`), so authors and you are looking at the same number.

### 6.4 The accounting identity

This should hold at all times and is worth asserting in a test:

```
Σ orders.netUsdCents
  = Σ recognized (chapter revenue)
  + Σ deferred   (remainingCostMicros across live buckets)
  + Σ refunded
  + Σ forfeited  (expired unspent)
```

**Deferred revenue** — the sum of `remainingCostMicros` — is money you've taken but not yet earned in content. It's a real liability and the admin portal surfaces it prominently. A generous grant campaign can quietly balloon it.

### 6.5 Both metrics, admin's choice

`analytics.revenueBasis` selects which figure is primary everywhere: `attributed_cash` (default, honest), `face_value` (simple, comparable to credit budgets), or `both` (side-by-side columns). The other is always available in exports.

---

## 7. The currency calculator

```
displayPrice(pack, currency, user):
  1. usdCents  = pack.priceUsdCents
  2. usdCents -= couponDiscount(usdCents)         # coupons always apply in USD
  3. rate      = currency.rateSource === 'manual' ? currency.manualRate : currency.autoRate
  4. if stale beyond fxStaleAfterHours → apply settings.onStaleRates
  5. effective = rate * (1 + currency.markupPct / 100)
  6. raw       = (usdCents / 100) * effective
  7. minor     = applyRounding(raw, currency.rounding, currency.decimals)
  8. minor     = max(minor, currency.minChargeMinor)
  9. tax       = taxFor(user.country) applied inclusive or exclusive per config

  settle = currency.settlementMode === 'local' && currency.paypalSupported
             ? { currency: currency.code, amountMinor: minor,  isEstimate: false }
             : { currency: 'USD',         amountMinor: usdCents, isEstimate: true }
```

| Pack | USD | Currency | Rate | Markup | Rounding | Displayed | PayPal charges |
|---|---|---|---|---|---|---|---|
| 1000 cr | $9.99 | EUR | 0.92 | 2% | `charm_99` | €9.99 | **€9.99** local |
| 1000 cr | $9.99 | INR | 83.2 | 3% | `nearest_10` | ≈ ₹860 | **$9.99** estimate |
| 1000 cr | $9.99 | JPY | 152 | 2% | `nearest_int` | ¥1549 | **¥1549** (0 decimals) |
| 500 cr | $4.99 | GBP | 0.79 | 0% | `charm_95` | £3.95 | **£3.95** local |

Estimate prices must render with a tooltip: *"Charged as $9.99 USD. Your bank's rate may differ slightly."* Showing ₹860 then charging what lands as ₹871 is the top source of payment support tickets.

**FX source:** default `https://open.er-api.com/v6/latest/USD` (free, no key), provider URL configurable. Every fetch writes an `FxRateSnapshot`; last-known-good persists so an outage never blocks the store.

---

## 8. Flows

### 8.1 Purchase

```
1. GET  /api/store/packs?currency=EUR
        → resolve currency (user pref → geo → default), return display prices + isEstimate

2. POST /api/store/orders  { packId, currency, couponCode }
        → recompute price AUTHORITATIVELY (client figures ignored)
        → validate pack active, visibility, per-user limits, coupon, country, kill switch
        → create Order{ status:'created', quoteExpiresAt: now+15min }
        → POST PayPal /v2/checkout/orders  intent=CAPTURE, custom_id=<orderId>,
               shipping_preference=NO_SHIPPING
        → return { orderId, paypalOrderId }

3. Buyer approves in the PayPal JS SDK (no redirect)

4. POST /api/store/orders/:id/capture
        → POST PayPal /v2/checkout/orders/{id}/capture
        → VERIFY captured currency + amount === locked values      ← critical
        → read seller_receivable_breakdown.paypal_fee → store fee + net
        → create CreditBucket with cost basis, credit wallet, write ledger
          (idempotencyKey = 'order:<id>:capture')
        → set creditedAt, status='captured'; notify(purchase_success)

5. Webhook PAYMENT.CAPTURE.COMPLETED (may arrive before step 4, or twice)
        → verify signature → upsert WebhookEvent (unique eventId)
        → same credit path, SAME idempotency key → no-op if already done
```

Steps 4 and 5 are deliberately redundant: 4 gives instant feedback, 5 guarantees delivery if the user closes the tab mid-capture. Convergence comes from the shared key plus its unique index — **not** from ordering. A cron expires `created` orders past `quoteExpiresAt`.

### 8.2 Webhooks

Mounted at **`/webhooks/paypal`** — outside `/api`, so the maintenance guard can't 503 it (§4.1). Verified via PayPal's `/v1/notifications/verify-webhook-signature` using the five `PAYPAL-*` headers plus the configured `webhookId`; [PayPal recommends this over local cert-chain validation](https://developer.paypal.com/api/rest/webhooks/rest/), which makes you handle cert rotation. Always respond `200` once the event is *persisted*, then process async — a `500` makes PayPal retry for days.

| Event | Action |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | mark `approved` |
| `PAYMENT.CAPTURE.COMPLETED` | credit (idempotent) |
| `PAYMENT.CAPTURE.DENIED` / `.DECLINED` | `failed` + notify |
| `PAYMENT.CAPTURE.REFUNDED` | clawback, negative attribution |
| `PAYMENT.CAPTURE.REVERSED` | clawback, flag account |
| `CUSTOMER.DISPUTE.CREATED` | `disputed`, freeze spend, alert admin |
| `BILLING.SUBSCRIPTION.ACTIVATED` | activate, grant first cycle |
| `PAYMENT.SALE.COMPLETED` | grant cycle credits (`sub:<id>:<cycle>`) |
| `BILLING.SUBSCRIPTION.PAYMENT.FAILED` | `past_due`, start grace, dunning |
| `BILLING.SUBSCRIPTION.CANCELLED` / `.SUSPENDED` / `.EXPIRED` | update, revoke perks at period end |

### 8.3 Chapter access resolution

```
resolveChapterAccess(user, novel, chapter):
  if !monetizationEnabled                     → free
  if ChapterAccess exists and not expired     → owned
  if chapter.earlyAccessUntil > now
       and user is not an eligible subscriber → locked { early_access, availableAt }
  if chapter.accessType === 'free'            → free
  if effectiveNumber <= freeChapterCount      → free
  if freeAfterDays && publishedAt age > N     → free { timed_release }
  if subscription covers this novel           → free { subscription }
  price = resolvePrice(...)
  if price === 0                              → free
  → locked { credits, priceCredits, balance, canAfford, rentalHours? }
```

Early access is checked **before** pricing — a non-subscriber inside the window is blocked outright, not quoted a price. `effectiveNumber` respects `safety.freezeFreeCountByOriginalNumber`.

**Price resolution chain**, highest precedence first:
1. `chapter.priceCredits` when `chapter.accessType === 'paid'`
2. Highest-priority matching `PricingRule`
3. `novel.monetization.defaultChapterPriceCredits` when `override`
4. `settings.defaultChapterPriceCredits`

Then apply subscriber `chapterDiscountPct`.

**Gate integration.** `evaluateReadingGate()` already returns `{locked, reason}` with `LOGIN` / `ENGAGEMENT` — note it returns a bare `{locked:false}` with no `requirements`, which the wrapper must handle. We add `GATE_REASONS.CREDITS` and `.EARLY_ACCESS`, and `evaluateChapterAccess()` runs login → engagement → credits per `gateStacking`. `ChapterGate.jsx` gains a credits branch. No existing gate logic is rewritten.

### 8.4 Unlock — the double-spend-safe path

```js
// 1. Atomic conditional debit — no race window
const wallet = await Wallet.findOneAndUpdate(
  { user, balance: { $gte: price } },
  { $inc: { balance: -price, lifetimeSpent: price } },
  { new: true, session }
);
// Matches the existing convention in middlewares/errorHandler.js:
// a plain Error carrying `.status`, thrown inside an asyncHandler.
if (!wallet) throw Object.assign(new Error('Insufficient credits'), { status: 402 });

// 2. Consume buckets in configured order, collecting cost basis
const { breakdown, attributedUsdMicros } = await consumeBuckets(user, price, session);

// 3. Unique index makes a concurrent duplicate impossible
try {
  await ChapterAccess.create([{ user, chapter, novel, source: 'credits',
                                creditsSpent: price, attributedUsdMicros }], { session });
} catch (e) {
  if (e.code === 11000) { await session.abortTransaction(); return alreadyOwned(); }
  throw e;
}

// 4. Ledger row, idempotencyKey 'unlock:<user>:<chapter>'
await CreditTransaction.create([{ ..., attributedUsdMicros,
                                  bucketBreakdown: breakdown, novel, chapter }], { session });
```

Wrapped in a transaction. **Requires a replica set** (§4.2). When `TRANSACTIONS_ENABLED=false`, the fallback relies on the atomic debit plus the unique index, applying a compensating re-credit if a later write fails — correct, just less tidy, and bucket consumption becomes eventually-consistent with a reconciliation sweep.

Bulk unlock computes the total across requested chapters, applies `bulkDiscountTiers`, performs one debit, and pro-rata-attributes cash by list price (§6.3).

### 8.5 Grant campaign

```
1. Admin builds rule → POST /admin/monetization/grants/preview → live count + sample users
2. Dry run  → full pipeline, stats only, zero credits issued
3. Execute  → status='running', batched cursor over the audience
   per user: credit with key 'grant:<campaignId>:<runIndex>:<userId>'   ← re-run safe
             → CreditBucket { totalCostMicros: 0, expiresAt }
             → dispatchNotification() on configured channels
4. Cursor persisted every batch → a crash resumes rather than restarts
5. Recurring campaigns re-run on cron with an incremented runIndex
```

Driven by a durable cron worker, **not** `setImmediate` (§4.5).

---

## 9. API surface

### Public / user
```
GET    /api/store/config                     labels, currencies, creditsPerUsd, flags
GET    /api/store/packs?currency=            packs with resolved display prices
POST   /api/store/coupons/validate           { code, packId } → discount preview
POST   /api/store/orders                     create + PayPal order
POST   /api/store/orders/:id/capture         capture + credit
GET    /api/store/orders                     purchase history
GET    /api/store/orders/:id/receipt         HTML/PDF receipt (with tax lines)
POST   /api/store/orders/:id/refund-request  self-service refund
GET    /api/store/plans                      subscription plans
POST   /api/store/subscriptions              start
POST   /api/store/subscriptions/:id/cancel

GET    /api/wallet                           balance, lifetime stats, buckets, expiring soon
GET    /api/wallet/transactions?page=        paginated ledger for the profile
PUT    /api/wallet/auto-unlock               user preference

GET    /api/novels/:slug/chapters            + optionalAuth → price/owned/locked inline
GET    /api/novels/:slug/chapters/:n/access  price, ownership, lock reason
POST   /api/novels/:slug/chapters/:n/unlock  spend credits
POST   /api/novels/:slug/unlock-bulk         quote or commit
```

### Webhooks
```
POST   /webhooks/paypal                      outside /api, unauthenticated, signature-verified
```

### Admin
All under `/api/admin/monetization/*` behind the existing `protect, adminOnly`. The settings payload is sectioned to match the tabs in [admin portal spec §4](./admin-portal-spec.md#4-settings--monetization), so each tab saves independently rather than PUTting the whole config.

```
GET/PUT   /settings                          (sectioned: credits, pricing, currencies, …)
CRUD      /packs /currencies /coupons /plans /pricing-rules /grants /templates /tax-rates /authors
POST      /currencies/refresh-rates          /plans/:id/sync-paypal   /paypal/test
POST      /grants/preview | /:id/execute | /dry-run | /cancel | /reverse
POST      /coupons/bulk-generate
GET       /wallets  POST /wallets/:userId/adjust
GET       /transactions /orders /subscriptions /refund-requests /webhooks /audit-log
POST      /orders/:id/refund                 /webhooks/:id/replay   /reconcile
GET       /analytics/{revenue,novels,novels/:id,chapters,economy,funnel,subs,cohorts}
GET       /payouts  POST /payouts/generate | /:id/approve | /:id/pay
```

---

## 10. Security & anti-abuse

| Risk | Mitigation |
|---|---|
| Client tampers with price | Server recomputes; `Order` locks it; capture verifies currency + amount before crediting |
| Replayed webhook double-credits | `WebhookEvent.eventId` unique + `CreditTransaction.idempotencyKey` unique |
| Forged webhook | PayPal signature verification; reject unverified, log, alert |
| Double-spend via concurrent unlock | Atomic conditional `$inc` + unique `(user, chapter)` index |
| Multi-accounting to farm free credits | Grant dedupe key; optional IP/device clustering **flag for review, never auto-ban** |
| Coupon brute-forcing | Rate-limited validate endpoint, ≥10-char high-entropy codes, lockout after N failures |
| Refund-after-spend abuse | Configurable policy (§ admin spec), account flag, block new orders while negative |
| Admin error (grant 1M credits to everyone) | Mandatory dry-run, count confirmation, `maxPerUser` cap, optional two-person approval, audit log, reversible campaigns |
| Deleting paid content | `guardPurchasedContent` (§4.3) |
| Secret leakage | PayPal secret in env only, never in the public settings projection, masked in the UI, separate sandbox/live credentials |
| Sanctions / restricted regions | `geo.restrictedCountries` blocks order creation |

**Rate limiting** must be added (`express-rate-limit`, currently absent) with admin-tunable per-route limits: order creation, capture, coupon validate, unlock, refund request, auth.

**`AdminAuditLog`** — `actor`, `action`, `entity`, `entityId`, `before`, `after`, `ip`, `at` — on every monetization config mutation. For money this is not optional.

---

## 11. Testing plan

Extends the existing Jest + Supertest harness, switched to `MongoMemoryReplSet` (§4.2). PayPal HTTP mocked at the client-module boundary.

1. **Concurrent unlock** — 10 parallel requests, 1 credit short of 2× price → exactly one succeeds
2. **Webhook replay** — same `eventId` 3× → one credit
3. **Capture/webhook race** — both paths fire → one credit
4. **Amount tampering** — capture returns a different amount → no credit, order flagged
5. **Zero-decimal currency** — JPY order carries an integer amount; `charm_99` rejected on 0-decimal
6. **Unsupported currency** — INR forces USD settlement with `isEstimate: true`
7. **Stale FX** — each `onStaleRates` policy behaves as configured
8. **Price resolution** — chapter > rule > novel > global, all combinations
9. **Coupon limits** — global cap, per-user cap, expiry, min-spend, country
10. **Audience resolver** — every query field, plus `limit` + `orderBy`
11. **Grant idempotency** — re-running a campaign grants nothing extra; cursor resumes after a simulated crash
12. **Refund clawback** — sufficient and insufficient remaining balance; each `onSpentCredits` policy
13. **Ledger reconciliation** — Σ ledger === wallet balance after a randomized op sequence
14. **Bucket consumption** — order policies, exact cost withdrawal, no drift after 10k random spends
15. **§6.4 accounting identity** — `Σ net = recognized + deferred + refunded + forfeited` after a randomized simulation. *This is the single highest-value test in the suite.*
16. **Bonus-credit attribution** — a $9.99/1200-credit pack yields 83,250 micros on a 10-credit unlock, not 100,000
17. **Grant-funded spend** — attributes exactly 0
18. **Bulk unlock pro-rata** — discounted cash splits by list price and sums to the debit
19. **Gate stacking** — each mode against the existing engagement gate
20. **Purchased-chapter delete guard** — each `onChapterDelete` policy
21. **Kill switch** — `monetizationEnabled: false` frees every chapter and blocks the store

---

## 12. Phased delivery

**Phase 0 — Pre-flight (§4).** Webhook mount point + maintenance guard fix, replica-set test harness, `serializeChapter`, rate limiting, `publishedAt` / `wordCount` / `originalNumber` migrations, `optionalAuth` on `listChapters`. Small, independently valuable, unblocks everything.

**Phase 1 — Credits core, no money.** `Wallet`, `CreditBucket` (with cost basis), `CreditTransaction`, `ChapterAccess`, `PricingRule`, price resolution, unlock + bulk unlock, `MonetizationSettings`, gate integration, grant campaigns + audience resolver, profile balance/history UI, notifications. Fully shippable — you could run a free-credits-only beta on this alone.

**Phase 2 — PayPal + currency.** `CreditPack`, `Currency`, `Order`, `WebhookEvent`, FX service + cron, order/capture/webhook flow, store page, PayPal JS SDK, receipts, refund workflow, tax.

**Phase 3 — Admin portal.** Every section of the [admin portal spec](./admin-portal-spec.md), including the rollup jobs and all analytics.

**Phase 4 — Growth.** Coupons, subscriptions, rentals, auto-unlock, referrals, author payouts, cohort analytics.

Each phase ends with tests green and prior phases untouched.

---

## 13. Environment variables

```bash
# PayPal
PAYPAL_ENV=sandbox                # sandbox | live
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_API_BASE=                  # optional override

# FX
FX_PROVIDER_URL=https://open.er-api.com/v6/latest/USD
FX_API_KEY=
FX_REFRESH_CRON=0 */6 * * *

# Behaviour
MONETIZATION_ENABLED=true
TRANSACTIONS_ENABLED=true         # false for standalone mongod without a replica set
GEO_HEADER=CF-IPCountry           # see admin spec → Geo

# Frontend
VITE_PAYPAL_CLIENT_ID=
VITE_PAYPAL_CURRENCY=USD
```

**Dependencies.** Backend: `express-rate-limit` (required — nothing exists today), `node-cron` for scheduled jobs; PayPal REST can be called with native `fetch` on Node 22, consistent with the codebase's dependency-light style, or optionally `@paypal/paypal-server-sdk` for typed helpers and built-in webhook verification. Frontend: `@paypal/react-paypal-js` and `recharts` for the analytics charts.

---

*Sources: [PayPal Currency Codes](https://developer.paypal.com/api/codes/currency) · [PayPal Webhooks](https://developer.paypal.com/api/rest/webhooks/rest/) · [PayPal Subscriptions](https://developer.paypal.com/docs/subscriptions/integrate/) · [Webhook signature verification](https://developer.paypal.com/community/blog/paypal-has-updated-its-webhook-verification-endpoint/)*
