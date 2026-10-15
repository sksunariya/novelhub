# Remaining implementation plan

**Date:** 2026-08-09
**Status:** backend complete through Phase 2 (33 models, 138 routes, 735 tests); frontend untouched

## Confirmed context

Four answers that shape the stages below.

| | Decision | Consequence |
|---|---|---|
| **Authors** | Multiple novels, different authors. You want per-novel and per-chapter earnings **to negotiate deals yourself** | No payout engine. Stage 6 collapses from an automated payments system into a reporting dimension — roughly 3 days saved. Adds an author grouping to analytics |
| **Deployment** | Single instance, self-hosted standalone `mongod` | No replica set, so transactions are genuinely unavailable. The credit service was built for this. `TRANSACTIONS_ENABLED=false`, keep the test harness on standalone, and **backups become the single biggest operational risk** |
| **Data** | Live users, content still small | Backfills are cheap but real. Wallet provisioning and a staged paywall rollout matter — existing readers must not wake up to a wall |
| **Growth order** | Subscriptions first | Stage 5 reorders. It is the largest item and the only one touching PayPal again |

### What "standalone mongod" means for the code

Already correct, worth stating so nothing later assumes otherwise:

- **No transactions anywhere.** `grep startSession src/` returns nothing. Correctness comes from atomic conditional updates, unique idempotency keys and compensating rollbacks instead. Do not introduce a session in any new service.
- **In-process rate limiter and settings cache are exactly right.** No shared store needed.
- **Job locks are insurance, not load-bearing.** Keep them — they cost nothing and make a second instance safe if that ever happens.
- **Durability is on you.** The `CreditTransaction` ledger is now the source of truth for money. A single unreplicated `mongod` with no backup is the largest risk in this project, and it is not a code problem. Add `mongodump` on a schedule before switching monetization on.
**Related:** [`monetization-architecture.md`](./monetization-architecture.md) · [`admin-portal-spec.md`](./admin-portal-spec.md) · [`pre-implementation-audit.md`](./pre-implementation-audit.md) · [`dynamic-configuration-audit.md`](./dynamic-configuration-audit.md)

---

## The three decisions that shape everything below

Most of the remaining work is UI, and UI is where a project this configurable usually goes wrong. Three decisions keep it from doing so.

### 1. Admin forms are generated from the registry, never hand-written

`GET /api/admin/config/registry` already returns, per setting: type, label, help, unit, min, max, options, `dependsOn`, `requiresConfirmation`, `secret`. That is everything a form control needs.

So the admin portal ships **one `<SettingField>` component** that switches on `type`, plus a tab manifest naming which sections appear where. 171 settings become ~19 lines of manifest. Setting number 172 requires **zero** frontend work — declare it in `config/settings/*.js` and it renders, validates, searches and audits itself.

Hand-writing 171 form fields would be roughly 4,000 lines of JSX that drifts out of sync with the backend the first time anyone changes a bound. This is the single highest-leverage decision remaining.

### 2. Every new feature declares its settings before it reads them

Coupons, subscriptions, rentals and referrals all arrive with knobs. Each one goes into the registry first, then the service reads it through `settingsService.snapshot()`. No feature is allowed to introduce a hardcoded constant, because that is exactly how the current ~150 inert settings problem was created in the first place.

### 3. Read paths get rollups before they get charts

Analytics currently aggregates raw `ChapterRead`, `ChapterAccess` and `GateImpression` on every request. Correct today, unusable once a novel has a few hundred thousand rows. The rollup collections land **before** the pages that query them, not after.

---

## Stage 0 — Close out verification (half a day)

Nothing else should start on an unverified suite.

| Step | Work | Done when |
|---|---|---|
| 0.1 | Run `npx jest tests/community.test.js tests/admin.test.js --runInBand` in isolation | We know whether the two failures are a real regression or cross-file interference |
| 0.2 | If they pass in isolation: move `mongodb-memory-server` to a Jest `globalSetup`/`globalTeardown` so all suites share one **standalone** instance with per-file database names | Suite runs well under 175s; 39 mongod processes become 1 |
| 0.3 | If they fail in isolation: trace and fix properly | 735/735 |
| 0.4 | Add `npm run test:unit` for the pure-logic suites | Sub-5-second feedback loop for logic changes |
| 0.5 | Set `TRANSACTIONS_ENABLED=false` in `.env.example` and document why | Nobody later adds a session and breaks production on standalone Mongo |

**Scalability note.** 39 separate in-memory servers is the reason the suite takes three minutes. A shared instance with per-file database names keeps isolation and cuts most of that. Deliberately **not** a replica set — the test harness should match the production topology, so an accidental `startSession` fails in CI rather than in production.

---

## Stage 1 — Phase 0 stragglers (1–2 days)

Small, independent, each fixes something real. Do them before building UI on top.

| Step | Work | Why it matters |
|---|---|---|
| 1.1 | Add a multikey index on `User.library` | Every chapter publish currently scans the user collection |
| 1.2 | Implement `guardTransactedUser` in `deleteUser`, honouring `safety.onTransactedUserDelete` (block / anonymize / full delete) | Deleting a paying user strands their orders and tax records; the setting exists with nothing behind it |
| 1.3 | Route `notifyLibraryUsers` through `dispatchNotification` | New-chapter alerts — the ones users get most — currently ignore every global toggle and per-user preference |
| 1.4 | Build `services/emailQueue.js`: bounded concurrency from `notifications.emailConcurrency`, retry with backoff, per-user daily cap, failure recording | A 12k-recipient grant campaign currently fires 250 concurrent SMTP sends and mostly fails into a `console.error` |
| 1.5 | Point `sendNotificationEmail` and `dispatchCampaign` at the queue | Delivery becomes observable instead of best-effort |

**Maintainability note.** The email queue is a service with the same shape as the others — settings-driven, one entry point, testable in isolation. Do not scatter throttling logic into callers.

### 1.6 Live-data migration (half a day) — new, because there are real users

`backend/scripts/migrateForMonetization.js`, idempotent and resumable so it can be run repeatedly without harm:

- Backfill `publishedAt` from `createdAt` for published chapters that have none.
- Backfill `wordCount` by stripping HTML from existing content.
- Backfill `originalNumber` from the current `number`. **Run this before anyone renumbers anything**, or the renumber guard protects the wrong value.
- Provision a `Wallet` for every existing user. The lazy `getOrCreate` covers reads, but a complete table makes the admin wallet list and audience queries honest.

Verify with a dry-run count first, then apply.

### 1.7 Backups before money (half a day) — non-negotiable on standalone Mongo

The ledger is the source of truth for real money on a single unreplicated instance. Before `monetization.enabled` is ever switched on:

- Scheduled `mongodump` with off-machine retention.
- One rehearsed restore. An untested backup is not a backup.
- The existing `ledger.reconcile` job already runs nightly and reports drift — make sure someone sees its output.

This is the largest operational risk in the project and it is not a code problem.

---

## Stage 2 — Reader experience (4–6 days)

The shortest path from "engine works" to "you can click through a purchase". Do this before the admin portal: it is smaller, it proves the API design, and it will surface response-shape problems that no backend test can.

### 2.1 Seed script (half a day)

`backend/scripts/seedMonetization.js` — creates a few credit packs, enables USD plus two other currencies, sets a chapter price and free-chapter count, grants the admin some credits.

Without this you cannot exercise the store until the admin portal exists, and that dependency would force the two stages into the wrong order.

### 2.2 Frontend foundations (1 day)

```
frontend/src/api/wallet.js        getWallet, getTransactions, setAutoUnlock
frontend/src/api/store.js         getConfig, getPacks, createOrder, captureOrder, getOrders
frontend/src/api/access.js        getChapterAccess, unlockChapter, quoteBulk, unlockBulk
frontend/src/context/MonetizationContext.jsx
frontend/src/components/credits/CreditAmount.jsx
frontend/src/components/credits/CreditBalance.jsx
```

- **One API module per domain**, not `client.get` scattered through components. When a response shape changes, one file changes.
- **`MonetizationContext`** reads the `config` block already returned by `GET /api/settings` — `credits.perUsd`, the credit label, `monetization.enabled`, `store.enabled`. One fetch, no prop drilling.
- **`<CreditAmount value={10} />`** renders "10 credits" or "10 gems" from the configured label. Every price in the app goes through it, so rebranding stays a settings change rather than a find-and-replace.

### 2.3 Chapter gate credits branch (1 day)

Extend `components/ChapterGate.jsx` with a `reason === 'credits'` branch. Do **not** rewrite the component — the login and engagement branches already work.

Shows price, balance, an Unlock button when affordable, a Buy Credits link when not, and the early-access branch with `availableAt`. On success, re-fetch the chapter rather than reloading the page.

Add a client-generated idempotency key to the unlock request so a double-click is one request, not two racing ones.

### 2.4 Store page (1–2 days)

`pages/Store.jsx` + `components/store/PackCard.jsx`, `CurrencyPicker.jsx`, `CreditCalculator.jsx`.

- PayPal via `@paypal/react-paypal-js`, `createOrder` → our API, `onApprove` → our capture.
- **The estimate disclosure is not optional.** When `isEstimate` is true the card must say "Charged as $9.99 USD — your bank's rate may differ". Silently showing ₹860 and charging what lands as ₹871 is the top source of payment support tickets.
- The credit calculator is a pure function of `credits.perUsd`; hide it when `credits.showCalculator` is off.

### 2.5 Profile wallet (1 day)

Balance, lifetime stats, paginated transaction history, auto-unlock toggle clamped to the admin ceiling, purchase history with receipts.

### 2.6 Chapter list and bulk unlock (1 day)

`listChapters` already returns `locked`/`owned`/`priceCredits` inline and is paginated. Add lock icons, prices, and an "unlock all remaining" flow using the existing quote-then-commit endpoints.

**Scalability note.** A 3,000-chapter novel must not render 3,000 DOM nodes. Use windowed rendering or load-on-scroll against the existing pagination.

---

## Stage 3 — Admin portal shell and settings (5–7 days)

### 3.1 Navigation restructure (1 day)

Replace the flat seven-link sidebar in `AdminLayout.jsx` with the six collapsible groups from admin-portal-spec §2. Pure IA, no new features — but it makes everything after it cheaper, so it goes first.

### 3.2 The generated settings engine (2 days)

```
admin/settings/SettingField.jsx     one component, switches on type
admin/settings/SettingSection.jsx   groups fields, master toggle, dirty tracking
admin/settings/SettingsPage.jsx     tab rail, sticky save bar, reset-to-default
admin/settings/sections.js          the ~19-line tab manifest
admin/settings/useSettings.js       fetch registry + values, PATCH, per-field errors
```

`SettingField` handles: boolean, integer, number, money, string, text, enum, multiselect, color, cron, json. It reads `dependsOn` to hide conditional fields and `requiresConfirmation` to trigger the impact dialog.

Per-field errors from the API already come back keyed by setting, so the save bar can highlight exactly what failed. The whole patch rejects together, so a form never half-saves.

### 3.3 Impact previews (1 day)

New endpoint `POST /api/admin/config/preview-impact { key, value }` returning a human sentence plus the numbers behind it. Resolvers named by the registry's `impact` field:

- `revalueBalances` — "Outstanding balances (2.4M credits) revalue from $24,000 to $48,000 of content"
- `repriceChapters` — "1,204 currently-paid chapters become free across 18 novels"
- `monetizationKillSwitch` — "Every chapter becomes free and the store is hidden"
- `previewRankings` — the resulting top 20

**Flexibility note.** Resolvers live in one map keyed by name. A new impactful setting names an existing resolver, or adds one.

### 3.4 Settings search (half a day)

`⌘K` palette over `GET /api/admin/config/search`. With 171 settings this is how anyone finds anything; it is not a nicety.

### 3.5 Catalogue CRUD pages (2 days)

Packs, currencies (with the live price preview column), pricing rules with a drag-ordered priority list, wallets with the manual adjustment dialog, orders with refund, grant campaigns with the live audience counter and dry-run, notification templates.

Every API for these already exists — this is UI over endpoints that are already tested.

---

## Stage 4 — Rollups and analytics (4–5 days)

### 4.1 Rollup collections (1–2 days)

Build `ChapterRevenueDaily`, `NovelRevenueDaily`, `RevenueDaily` from architecture §5.16. Two write paths:

- **Incremental** — bump counters at unlock/capture time, as `ChapterStatsDaily` already does.
- **Nightly rebuild** — a job that recomputes the trailing N days from source, so drift self-heals.

Then repoint `analyticsService` at the rollups, keeping the raw collections for cohort work.

**Scalability note.** This is the difference between an admin dashboard that stays fast and one that times out at 100k unlocks. It lands before the pages that read it.

### 4.2 Chart layer (1 day)

Add `recharts`. Build `admin/analytics/charts/` with `TrendArea`, `RankedBars`, `ComboRetention`, `FunnelBars`, `Treemap`, `Sankey`, `CohortHeatmap` — each taking data plus a config object, none knowing which endpoint fed it.

### 4.3 Analytics pages (2 days)

Money Overview, Novel Performance with the drill-down (the retention-vs-paywall combo chart is the headline), Chapter Performance, Credit Economy with the Sankey, Conversion Funnel. Shared toolbar for date range, comparison period, currency and revenue basis.

---

## Stage 5 — Growth features (6–8 days)

Each follows the identical pattern already established: **registry settings → model → service → controller → routes → tests → admin UI**. That repetition is the point; a new feature should be boring to add.

Ordered as requested: subscriptions first.

| Step | Feature | Notes |
|---|---|---|
| 5.1 | ~~**Subscriptions**~~ **DONE** | See "Stage 5.1 as built" below |
| 5.2 | **Coupons** (1–2 days) | `Coupon` + `CouponRedemption`, validate endpoint (rate-limited, already configured), bulk generation, reuse `audienceResolver` for targeting |
| 5.3 | **Auto-unlock engine** (1 day) | Preference is stored but nothing acts on it. Honour it on next-chapter navigation, within the admin ceiling, with an explicit confirmation above a threshold |
| 5.4 | **Rentals purchase flow** (1 day) | Schema and sweeper exist; add the buy path, upgrade-to-permanent, and the expiry warning notification |
| 5.5 | **Referrals** (1 day) | Reward amounts, qualification event, fraud caps — all settings-driven |

### Stage 5.1 as built

Landed: registry settings (`subscriptions.*`, 9 keys including an admin-editable sweep cron), `SubscriptionPlan` and `Subscription` models, PayPal Catalog Product / Billing Plan / Subscription client methods, `subscriptionService`, reader routes (`/api/subscriptions` — plans, me, subscribe, confirm, cancel), admin routes (plan CRUD, sync, subscriber list, MRR summary), six webhook handlers wired into the dispatch and into replay, entitlement folded into every pricing path, the `subscriptions.expire` job, `PlansAdmin` and the reader `Subscribe` page, and `tests/subscriptions.test.js` (~45 cases).

Four decisions worth recording, because each was a bug avoided rather than a preference:

**A metered allowance is not coverage.** `up_to_n_per_cycle` deliberately does *not* make `coversNovel` return true. Had it done so, the chapter would resolve free on every read and the allowance would never be spent — the limit would be decoration. Instead the chapter stays locked, the gate advertises `freeUnlocksLeft`, and `claimFreeUnlock` spends one atomically (the limit is in the update predicate, so two tabs cannot both see "4 of 5 used").

**The one-live-subscription index excludes `approval_pending`.** Including it looked tidier but permanently locked out any reader who opened checkout and closed the PayPal tab — the abandoned row held the slot forever. Pending rows are now cheap and unconstrained; if two somehow activate, `subscriptionService.activate` cancels the second at PayPal rather than letting them be billed twice.

**Every pricing path shares one `subscriptionContext`.** The single-chapter resolver, the chapter list, bulk quote and bulk commit all read the same helper. A chapter list quoting a discount the unlock endpoint does not honour is worse than no discount at all.

**A 100% chapter discount resolves to free**, not to the 1 credit that `Math.max(1, …)` would otherwise floor it to.

### Two subscription traps worth naming up front

**PayPal billing plans are effectively immutable once active.** A price change means creating a new plan and migrating subscribers; there is no edit. The admin UI must say so before someone discovers it with live subscribers. Keep `paypalPlanId` on the local plan and treat a repriced plan as a new row.

**Subscription revenue attribution is a real modelling choice, and it lands straight on your author deals.** A subscriber reading a chapter spends no credits, so without a rule that chapter earns nothing.

Implemented as follows. A **metered** allowance knows its denominator up front, so each claimed unlock carries `cycleNet / freeUnlockLimit` micro-USD immediately. An **unmetered** tier cannot — the reader might open one chapter or eighty — so `attributeCycle` settles it at cycle close, splitting the cycle's net cash evenly across the chapters first read during that period, with the last chapter absorbing the rounding remainder so the parts sum exactly to the cash. It is keyed on the cycle number and claims the cycle before posting, so a redelivered webhook cannot double-post revenue. It runs on renewal and from the hourly sweep for subscriptions that lapse.

The consequence for author conversations: in-cycle subscriber reads show no attributed revenue until the cycle closes. That is honest — the money genuinely is not divisible yet — but the earnings UI should label it *pending attribution* rather than implying zero.

---

## Stage 6 — Author earnings reporting and cohorts (2 days)

Reduced from an automated payout system to a reporting dimension, because you are negotiating deals yourself rather than paying authors through the platform. **No `AuthorPayout` model, no PayPal Payouts, no tax forms, no statements.** That is about three days removed.

What you actually need is the earnings picture per author, and most of it already exists — `analyticsService.novelLeaderboard` and `novelChapterPerformance` give per-novel and per-chapter attributed revenue today.

| Step | Work |
|---|---|
| 6.1 | **Author dimension** (half a day). `Novel.author` is free text, so "Sci-Fi" versus "Sci Fi" typos would split an author's earnings across rows. Add a light `Author` collection (name, contact, notes, current deal terms as free text) and a `Novel.authorRef`, purely for grouping. No payout fields |
| 6.2 | **Author earnings page** (1 day). Group the existing per-novel revenue by author: attributed cash, credits earned, unlocks, unique payers, subscription-attributed share, trend over time. Drill into the per-novel and per-chapter breakdown already built |
| 6.3 | **Export** (half a day). CSV per author over a date range — what you actually take into a negotiation |
| 6.4 | Cohort analytics — LTV curves, whale concentration (Lorenz + Gini), repeat-purchase triangle |

**Keep the `revenueShare.*` settings.** They are inert and cost nothing, and if you later agree a revenue-share deal the attribution to compute it is already recorded per novel. Do not delete the ability to backfill something you cannot reconstruct.

**One caveat on the numbers you will negotiate from.** Attributed cash excludes unlocks paid with granted credits, because those generated no revenue. If you run a large free-credit campaign, an author's chapters may be read heavily while earning little — that is accurate, but be ready to explain it. The per-chapter funding mix (paid versus granted versus subscription) is in the data, so show it alongside.

---

## Stage 7 — Wire the inert settings (ongoing, 3–4 days total)

~150 settings are declared and read by nothing. Each is now a small, isolated change because the registry already validates and serves them. Batch by area:

| Batch | Settings | Consumer to migrate |
|---|---|---|
| 7.1 | `limits.*` | Mongoose `maxlength` → validation at controller level |
| 7.2 | `auth.*` | Password rules, OTP attempts, lockout, reserved usernames, admin 2FA |
| 7.3 | `ranking.*` | The scoring formula, Bayesian prior, minimum votes, decay — with the top-20 preview |
| 7.4 | `views.*` | Dedup window, minimum dwell |
| 7.5 | `community.*` | Banned words, rate limits, edit window, reply depth, review-requires-unlock |
| 7.6 | `reader.*`, `discovery.*` | Themes, fonts, section order and counts |

**Maintainability note.** Ranking is the highest-value batch: it fixes a live product problem (one 5-star review outranking 500 at 4.8) and turns homepage curation into a settings change.

---

## Sequencing and parallelism

```
Stage 0 ─┬─ Stage 1 (backend stragglers)
         └─ Stage 2 (reader UI)          ← needs 2.1 seed script only
                    │
                    ▼
              Stage 3 (admin portal)
                    │
                    ▼
              Stage 4 (rollups → analytics)
                    │
         ┌──────────┴──────────┐
    Stage 5 (growth)      Stage 7 (inert settings)
         │
         ▼
    Stage 6 (payouts, cohorts)
```

Stages 1 and 2 are independent and can run in parallel. Stage 7 can be interleaved with anything after Stage 3, since the admin UI is what makes each newly-wired setting visible.

Rough total: **25–35 working days** for one developer, with Stage 2 and Stage 3 as the bulk.

---

## Definition of done, per stage

Every stage ends with the same four checks, not just "it renders":

1. `npm test` green, with new tests for anything added.
2. No new hardcoded constant — anything an operator might want to change is in the registry.
3. No new field leaks — new model fields are absent from responses until deliberately added to a serializer.
4. The scalability question answered explicitly: what does this do at 100k users, a 3,000-chapter novel, or a 50k-recipient campaign?

---

## What I would not build

Worth stating, so the backlog stays honest:

- **Price A/B experiments.** Genuinely valuable and genuinely a project of its own — bucketing, exposure logging, significance. Not worth starting until there is enough traffic for a result to mean anything.
- **Full i18n.** Currency is handled; language is not. Route strings through a catalogue when a second language is actually planned, not before.
- **Tax computation.** The rules table is designed. Whether you must register for EU VAT or India GST is an accountant's question, and building the engine before that answer risks building the wrong one.
