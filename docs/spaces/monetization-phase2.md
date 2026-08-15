# Community Monetization — Phase 2

**Status:** Deferred design. **Not in v1.**
**Date:** 2026-08-14
**Depends on:** [`architecture.md`](./architecture.md) phases 0–8 shipped and stable
**Companion:** [`monetization-architecture.md`](../monetization-architecture.md) — the credit ledger, buckets, cost basis and revenue share this builds on

---

## Why this is a separate document

Communities ship free. Adding money to a forum before it has a culture kills the culture — people post for status first and payment second, and reversing that order is close to impossible once it has set in. Every mechanism below is worth building; none is worth building before there is something to monetize.

This doc exists so the v1 schema does not paint us into a corner. Three small forward-compatibility notes in §5 are the only thing v1 owes phase 2.

---

## 1. What already exists and is reusable

The monetization system is the most developed part of the platform, and none of it needs rewriting:

| Existing piece | What it gives phase 2 |
|---|---|
| `creditService.debit/credit` | Idempotent, keyed spends and grants. Every mechanism below is one call |
| `CreditBucket` cost basis | Real cash attribution — a tip funded by granted credits correctly contributes $0 revenue |
| `CreditTransaction` ledger | Append-only truth; wallet balance is a rebuildable cache |
| `Wallet` | Already provisioned for every user at signup |
| `accessService` | Entitlement checks, directly analogous to space access |
| `subscriptionService` | Recurring billing, cycle grants, PayPal webhooks |
| `revenueShare` settings | Author payout split, applies unchanged to creator payouts |
| `RevenueDaily` / rollups | Reporting surface; new revenue types are new rows, not new pipelines |
| Settings registry | Every price, cut, floor and cap below is a declaration |

**The rule that governs all three mechanisms: credit face value is not revenue.** A tip funded by a granted credit is worth exactly $0 of real money. `creditService` already tracks this per-bucket, and phase 2 must not work around it.

---

## 2. Mechanism A — Tipping a post or comment

The lightest of the three, and the recommended first move. No access control, no entitlement state, no refund surface.

### Flow

1. Reader taps the tip control on a post or comment.
2. Picks an amount from `spaces.tips.presetAmounts` or enters a custom one within min/max.
3. `creditService.debit` on the tipper, keyed `tip:{targetType}:{targetId}:{userId}:{nonce}`.
4. `creditService.credit` on the author, less the platform cut, keyed off the same transaction.
5. A `Tip` row records both sides and the cost basis consumed.
6. Post shows a tip badge and total; the author is notified.

### Model

```js
// backend/src/models/Tip.js
{
  from:        ObjectId(User),
  to:          ObjectId(User),
  targetType:  String,       // 'post' | 'comment'
  target:      ObjectId,
  space:       ObjectId(Space),
  credits:     Number,       // gross, what the tipper spent
  creditsNet:  Number,       // what the author received
  platformCut: Number,
  costBasisMicros: Number,   // real cash behind it, from the consumed buckets
  message:     String,       // optional, max 200
  anonymous:   Boolean,
  reversedAt:  Date,         // fraud/chargeback clawback
}
```

Indexes: `{ to: 1, createdAt: -1 }`, `{ targetType: 1, target: 1 }`, `{ from: 1, createdAt: -1 }`, `{ space: 1, createdAt: -1 }`. No `softDelete` — financial records are immutable, consistent with the rest of the ledger.

Denormalized onto `Post` / `PostComment`: `tipCredits`, `tipCount`.

### Settings — `spaces.tips.*`

| Key | Type | Default |
|---|---|---|
| `enabled` | boolean | `false` |
| `presetAmounts` | json | `[5, 10, 25, 100]` |
| `minCredits` / `maxCredits` | integer | `1` / `10000` |
| `platformCutPercent` | number | `20` |
| `allowOnComments` | boolean | `true` |
| `allowAnonymous` | boolean | `true` |
| `minAuthorKarmaToReceive` | integer | `0` |
| `payoutMode` | enum | `credits` (`credits \| cash`) |
| `dailyLimitPerUser` | integer | `1000` |
| `allowSpaceOverride` | boolean | `true` — a space can disable tips |

### The hard parts

- **Self-tipping and ring-tipping.** Trivially blocked for self; ring-tipping between alts is laundering granted credits into cash if `payoutMode` is `cash`. Mitigation: cash payout draws only against `costBasisMicros`, so granted credits can never become money — the ledger already makes this structurally impossible.
- **Cashing out.** `payoutMode: 'cash'` is a full KYC, tax-form and payout-rail problem. Start with `credits` only; the recipient can spend them on chapters. Cash payout is its own project.
- **Refunds.** A tip is final. This must be stated in the confirm dialog, because the alternative is unbounded support load.

---

## 3. Mechanism B — Credit-gated spaces

The heaviest of the three: it introduces entitlement state, expiry, and a refund surface.

### Access modes

```js
Space.access = {
  mode: 'free' | 'credits' | 'subscription' | 'invite',
  priceCredits:    Number,   // one-time, mode 'credits'
  periodDays:      Number,   // 0 = lifetime, else a recurring pass
  requiredPlans:   [ObjectId(SubscriptionPlan)],   // mode 'subscription'
  previewPostCount:Number,   // free posts visible before the wall
  ownerRevSharePercent: Number,
}
```

### Model

```js
// backend/src/models/SpaceAccess.js
{
  space, user, source,       // 'credits' | 'subscription' | 'grant' | 'owner'
  creditsSpent, costBasisMicros,
  grantedAt, expiresAt,      // null = permanent
  revokedAt, revokeReason,
}
```

Index `{ space: 1, user: 1 }` unique, `{ expiresAt: 1 }` for the expiry sweep. This mirrors `ChapterAccess` almost exactly — the same shape, the same expiry job pattern, the same guard concerns.

### Settings — `spaces.paid.*`

| Key | Type | Default |
|---|---|---|
| `enabled` | boolean | `false` |
| `whoCanCharge` | enum | `admin_only` (`admin_only \| verified \| any`) |
| `minPrice` / `maxPrice` | integer | `10` / `5000` |
| `platformCutPercent` | number | `30` |
| `maxPeriodDays` | integer | `365` |
| `requirePreview` | boolean | `true` — a wall with no preview converts badly and reads as a scam |
| `refundWindowHours` | integer | `48` |
| `onSpaceDelete` | enum | `refund_prorated` (`block \| refund_full \| refund_prorated \| allow`) |

### The hard parts

- **Content people paid for can be deleted.** This is the exact problem `contentGuardService` already solves for chapters, and it needs the same treatment: a `guardSpaceDeletion` that blocks, refunds or prorates by policy. Building paid spaces without it repeats a bug the codebase has already fixed once.
- **The owner abandons the space.** Someone charges 500 credits for lifetime access, then stops moderating. Needs an inactivity policy: auto-refund, transfer, or admin takeover. Decide before launch, not after the first complaint.
- **Search and preview leakage.** A paid space's posts must not leak through global search, the `all` feed, or a linked-entity Discussion tab. Every feed query needs the access filter, which is a meaningful widening of the permission resolver's hot path.
- **Fragments the community.** Paywalls cut against the network effects that make a forum work. Worth restricting to `whoCanCharge: 'admin_only'` for a long time.

---

## 4. Mechanism C — Awards and premium flair

The best margin and the least risk: purely cosmetic, no entitlement, no refunds, no leakage.

### Models

```js
// backend/src/models/Award.js — admin-defined catalogue
{
  key, name, description, iconUrl, animationUrl,
  priceCredits, tier,              // 'basic' | 'premium' | 'legendary'
  recipientCredits,                // credits granted to the recipient
  recipientKarma,                  // karma granted
  grantsHighlight: Boolean,        // visual treatment on the post
  active, order, limitedUntil,     // seasonal availability
}

// backend/src/models/AwardGrant.js — an award actually given
{
  award, from, to, targetType, target, space,
  creditsSpent, costBasisMicros, message, anonymous,
}
```

`Post` and `PostComment` denormalize `awards: [{ award, count }]` and `awardCount` so rendering a feed needs no join.

### Settings — `spaces.awards.*`

| Key | Type | Default |
|---|---|---|
| `enabled` | boolean | `false` |
| `allowOnComments` | boolean | `true` |
| `recipientSharePercent` | number | `0` — awards are pure platform margin by default |
| `showGiverByDefault` | boolean | `true` |
| `maxPerUserPerDay` | integer | `50` |
| `karmaPerAward` | integer | `0` |

Premium flair is the same machinery with a different render target: a user buys a flair from the space's catalogue, `SpaceMember.flair` points at a purchased `Flair` with `priceCredits > 0`, and the space owner takes a cut.

### Why this one is the safest

No entitlement to track, no refunds to process, no content to gate, no leakage risk, and it creates a credit sink that raises the value of every credit sold. An `AwardGrant` row is append-only and never needs to be revisited. This is the mechanism to build first if the goal is revenue rather than creator payouts.

---

## 5. What v1 owes phase 2

Three forward-compatibility notes, all of which cost nothing now and are expensive to retrofit:

1. **Do not make `Space.access` implicit.** v1 has `visibility` (`public | restricted | private`) for *who can see*. Do not overload it with *who has paid* — those are different axes and merging them is the retrofit that hurts. Leave room for a separate `access` object.
2. **Keep the permission resolver the single choke point.** `spacePermissionService.resolve()` returning `can.view` means adding a paid check later is one function, not fifty controllers. Any controller that inlines its own role check is a future bug.
3. **Denormalize award and tip counters when the fields are added, not before.** But do reserve the names — `tipCredits`, `tipCount`, `awardCount`, `awards[]` on `Post` and `PostComment` — so the field-name bikeshed happens once.

---

## 6. Recommended sequence, when the time comes

| Order | Mechanism | Rationale |
|---|---|---|
| 1 | **Awards** | Best margin, lowest risk, no entitlement state, creates a credit sink. Proves whether the community will spend at all |
| 2 | **Tipping (credits payout)** | Rewards creators without a cash-out rail. Needs the anti-laundering property the ledger already provides |
| 3 | **Premium flair** | Same machinery as awards, gives space owners their first revenue |
| 4 | **Credit-gated spaces** | Only if 1–3 show real demand. Needs `guardSpaceDeletion`, an abandonment policy, and access filtering in every feed query |
| — | **Cash payout** | A separate project: KYC, tax forms, payout rails, fraud. Not a community feature |

### Preconditions before any of it

- The community has sustained activity — the target to define is daily posters, not registered users
- Moderation is keeping up: reports resolved faster than they arrive
- `spaces.enabled` has been on long enough for norms to form
- Credit purchase volume shows readers already buy credits comfortably
