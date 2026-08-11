# Pre-implementation audit

**Date:** 2026-08-08
**Method:** Full read of `backend/src` (3,607 lines across controllers, models, services, utils, middleware), the admin and reader frontend, the test harness and env config, then tracing each monetization flow end to end against what the code actually does.
**Related:** [`monetization-architecture.md`](./monetization-architecture.md) · [`admin-portal-spec.md`](./admin-portal-spec.md)

Findings are ordered by severity. Items marked **spec bug** are errors in my own design documents, not in your codebase.

---

## Critical — these break the design as written

### C1. There is no persistent record of who read which chapter — *spec bug*

Three things look like read history. None is.

| Source | Why it can't be used |
|---|---|
| `ViewEvent` | `expireAfterSeconds: VIEW_DEDUP_WINDOW_SECONDS` (30 min). It's a dedup key, deleted half an hour later. Not an analytics table |
| `Chapter.views` | A scalar counter. No time dimension, no user dimension. You can't ask "how many people read chapter 12 last week" |
| `ReadingProgress` | Unique on `{user, novel}` — stores only the latest chapter, overwritten on every read. Chapter 40 overwrites the fact that they ever read chapter 11 |

Everything reader-side in the analytics spec therefore has no data source:

- unique readers per chapter — **the retention curve, the chart I called the most actionable in the portal**
- reader → payer conversion
- paywall drop-off %
- unlock rate (there is no denominator)
- `ChapterRevenueDaily.readers` and `.unlockRate` — fields I specified with nothing to populate them
- time from publish to unlock

**Fix.** Add a persistent `ChapterRead` document, upserted on a successful read:

```js
{ user, chapter, novel, chapterNumber, firstReadAt, lastReadAt, readCount }
// unique (user, chapter) — one row per person per chapter, no TTL
```

Plus a `ChapterStatsDaily` counter rollup incremented at read time so the charts don't aggregate raw rows. For anonymous readers, key on the device id from C2's fix rather than user id.

Storage is the tradeoff: one row per user per chapter. A novel with 300 chapters and 50k readers is up to 15M rows if everyone reads everything — in practice far fewer because of the retention curve, but it needs an archival policy. `ChapterStatsDaily` alone (no per-user rows) is the cheap option, at the cost of losing cohort analysis.

### C2. Locked chapters leave no trace, so the paywall funnel has no top — *spec bug*

In `chapterController.readChapter`, the locked branch returns 403 **before** `registerView` is ever called:

```js
if (gateStatus.locked) {
  return res.status(403).json({ ... });   // no view registered, deliberately
}
const isNewView = await registerView(...)
```

Skipping the view count on a blocked read is correct. But it also means a reader who hits the paywall and leaves is completely invisible. The funnel in admin spec §5.7 starts at "chapter gate impression" — an event that does not exist and cannot be derived.

**Fix.** Record a `GateImpression` in the locked branch — `{ user | deviceId, chapter, novel, reason, priceCredits, at }` — before returning the 403. This is also what makes "64% of readers stop at the paywall" computable at all.

### C3. No scheduler exists, and the design needs at least six cron jobs

`server.js` is a bare `connectDB` + `app.listen`. There is no `node-cron`, no job model, no locking, no `SIGTERM` handler. The design assumes scheduled work for: FX refresh, nightly rollups, bucket expiry sweep, grant campaign runs, stale order expiry, rental expiry, subscription cycle reconciliation, author payout generation.

**The real risk is multi-instance deployment.** On any autoscaled host, every instance runs every cron. For FX refresh that's wasteful. For recurring grant campaigns and subscription cycle credits, **two instances create two runs and pay out twice.** The per-user idempotency key (`grant:<campaignId>:<runIndex>:<userId>`) protects within a run, but two concurrent instances each starting "run 5" is two distinct runs by the time the cursor advances.

**Fix.** A `JobLock` collection with an atomic claim and TTL:

```js
JobLock.findOneAndUpdate(
  { name, lockedUntil: { $lt: new Date() } },
  { lockedUntil: new Date(Date.now() + ttl), owner: instanceId },
  { upsert: true, new: true }
)   // null or a conflicting owner means another instance holds it
```

Plus a `Job` model recording runs, duration, outcome and error, surfaced in the admin System → Jobs page (which I specced without saying what backs it).

### C4. Deleting a user strands their financial records — and re-registration orphans the wallet

`deleteUser` soft-deletes the user and their comments/reviews. With monetization, three problems compound:

1. The `User` unique indexes use `partialFilterExpression: { deletedAt: null }`, so **the same email can re-register**, get a fresh `_id`, and get a fresh empty wallet. The old wallet, orders and tax records are stranded on a tombstone with no link.
2. The softDelete read hooks mean `populate('user')` returns `null` in any admin financial view. Moderation already hit this and worked around it with `options: { withDeleted: true }` in `MODERATION_POPULATE` — every ledger, order and payout view needs the same treatment.
3. Legally, deletion-on-request conflicts with transaction-record retention. You must keep order and tax records for years; you must also honour erasure requests. The answer is **anonymization** (null the PII, keep the financial rows) rather than deletion, and the delete path needs to branch on "has this user ever transacted".

**Fix.** A `guardTransactedUser` check in `deleteUser` mirroring `guardPurchasedContent`, with admin-configurable behaviour: block / anonymize-and-keep-records / full-delete-with-financial-export.

---

## Serious

### S1. New-chapter notifications bypass the notification service entirely

`notifyLibraryUsers` in `adminController` writes rows directly:

```js
await Notification.insertMany(users.map((user) => ({ user: user._id, type: NEW_CHAPTER, message, link })));
```

It never calls `dispatchNotification`, so it ignores `settings.enableChapterNotifications`, per-user `notificationPreferences`, the banned check, and email delivery entirely. The architecture doc claims all notifications route through the service — today the one users receive most often does not. Worth fixing before adding ten more notification types on the same assumption.

### S2. Email has no queue, no throttle, no retry

`sendNotificationEmail` calls `transport.sendMail` directly. `dispatchCampaign` fires them inside `Promise.all` over chunks of 250. That is up to 250 concurrent SMTP sends; essentially every provider will rate-limit, defer or block, and the failures vanish into `.catch(console.error)`.

A grant campaign to 12,483 users — the exact example in the admin spec — would largely fail to deliver, and nothing in the UI would say so. Needs a queue with bounded concurrency, retry with backoff, per-provider rate limits, bounce/complaint handling, and a delivery status the campaign page can show.

### S3. `User.library` is unindexed and queried on every chapter publish

`notifyLibraryUsers` runs `User.find({ library: novel._id })`. `userSchema` indexes `username`, `email`, `googleId` and `deletedAt` — not `library`. That's a collection scan per publish, and the audience resolver's `hasNovelInLibrary` filter would scan again. Add a multikey index on `library`.

### S4. `listChapters` returns every chapter with no pagination

`Chapter.find({...}).select('number title views createdAt').sort({ number: 1 })` — no limit. Web novels routinely run 1,000–3,000 chapters. The Reader already fetches this for the chapter panel. Adding per-chapter price, access type and ownership makes each row several times larger. Needs pagination or a windowed/virtualized response before monetization data goes on it.

### S5. Raw Mongoose documents are returned in at least six places

`readChapter` leaking `sourceFile.key` is the one I flagged before, but the pattern is everywhere: `listNovels`, `getNovel`, `listUsers`, `updateUser`, `getStats.topNovels`, `updateSettings` all `res.json` full documents. Once the new fields exist, this leaks by default:

| Field | Leaks via |
|---|---|
| `Novel.monetization.revenueShare.sharePct` | `listNovels`, `getNovel` — public endpoints |
| `Novel.revenueLifetimeUsdMicros` | same |
| `Chapter.sourceFile.key` | `readChapter` — already live |
| `User.taxId`, `User.country` | `listUsers`, `updateUser` |
| PayPal client secret, webhook id | `getAdminSettings`, `updateSettings` |

`getPublicSettings` and `serializeUser` already demonstrate the right pattern. This should become a convention with a serializer per model, not five one-off patches.

### S6. `updateSettings` won't scale to the monetization config

It is ~70 hand-written lines handling roughly 25 settings — a `stringFields` loop, a `boolFields` loop, per-field `=== 'true'` coercion, and bespoke JSON parsing for each nested object. The monetization surface is 200+ settings across 19 tabs. Continuing this pattern means ~600 lines of hand-rolled coercion with no validation.

**Fix.** Schema-driven: declare each setting once (type, default, min/max, enum, requires-confirmation, public-or-private), and derive the validator, the coercion, the admin form metadata and the public projection from that declaration. It also gives the `⌘K` settings search its index for free.

### S7. No graceful shutdown

No `SIGTERM`/`SIGINT` handler, no `server.close()`, no connection drain. A deploy during a PayPal capture kills the process mid-flight. The webhook is the safety net — which is precisely why the design has both paths — but combined with `TRANSACTIONS_ENABLED=false` (C-adjacent), an interrupted unlock can debit a wallet without writing `ChapterAccess`.

### S8. The axios client has no 401 handling and no idempotency-key support

`client.js` sets the bearer token on request and nothing else — no response interceptor, no refresh, no retry. `JWT_EXPIRES_IN=7d` makes mid-purchase expiry unlikely, so this is lower severity than it first looks, but two things still matter: a double-clicked "Unlock" fires two requests (the unique index saves correctness, the UI should still send a client-generated idempotency key), and a 401 anywhere leaves the user on a broken page with no redirect to login.

### S9. Anonymous view dedup is IP-based

`getViewerKey` returns `ip:${req.ip}` for logged-out readers. Behind a CDN, corporate NAT or mobile carrier NAT, thousands of distinct readers collapse into a single "viewer" for 30 minutes. Any funnel denominator or reader count built on this is wrong, and undercounts worst in exactly the markets with the most shared egress. Needs a signed anonymous device cookie.

---

## Moderate

- **`syncNovelChapterMeta` sorts by `createdAt`** to find `lastChapterAt` — wrong for chapters drafted then published later. Same root cause as the missing `publishedAt`; fix both together.
- **`bulkUploadChapters` awaits inside the loop** — 200 chapters is 200 sequential round trips inside one HTTP request, with no timeout guard. Adding per-chapter price resolution makes it slower. Should batch-insert and probably become a background job with progress.
- **`nextChapterNumber` is read-then-increment-in-memory.** Two concurrent bulk uploads to the same novel collide on the unique `{novel, number}` index; the second fails partway and leaves a half-imported novel with no rollback.
- **`getChapterSource` returns a presigned S3 URL** (`S3_SIGNED_URL_TTL=3600`). Admin-only so fine today — but the same mechanism must never be reused to deliver paid chapter content, because a signed URL is freely shareable for an hour. Paid content must stay behind the API.
- **`getStats` runs eight unfiltered `countDocuments` per dashboard load.** Adding revenue aggregates on top would make the admin landing page the slowest in the app. This is what the rollup collections are for — the dashboard must read rollups, never raw collections.
- **`seed.js` creates the admin user directly**, so it needs to create a wallet too, or the first manual balance adjustment hits a missing document. There are four `User.create` sites total (`seed.js`, two in `authController`, one for Google) — wallet creation must be centralized in a hook or a service, not added at each call site.
- **`parsePagination` caps at `MAX_LIMIT: 100`** — fine, but the ledger, orders and audit-log exports will want to stream rather than paginate.
- **`cors({ origin: process.env.CLIENT_URL || true })`** reflects any origin when `CLIENT_URL` is unset. Auth is a bearer token from `localStorage` rather than a cookie, so this isn't CSRF-exploitable today, but the webhook and admin routes should be explicitly locked down before money flows.
- **No health/readiness endpoint** — needed before running more than one instance, which C3 implies.

---

## Corrections to the design documents

| Doc | Correction |
|---|---|
| `admin-portal-spec.md` §5.4 | The retention-vs-paywall chart, unlock rate and drop-off % require C1 and C2 first. They are not derivable from current data |
| `admin-portal-spec.md` §5.7 | The conversion funnel's first stage ("gate impression") requires C2 |
| `monetization-architecture.md` §5.16 | `ChapterRevenueDaily.readers` and `.unlockRate` have no source until C1 lands |
| `monetization-architecture.md` §8.5 | Grant campaign execution needs the C3 job lock, not just a cron |
| `monetization-architecture.md` §4 | Add: `ChapterRead` + `GateImpression` models, `JobLock` + `Job`, user-deletion guard, `User.library` index, serializer convention, schema-driven settings |
| `monetization-architecture.md` §12 | Phase 0 grows; Phase 1 analytics depend on read tracking shipping alongside, not after |

---

## Revised Phase 0

Ordered by dependency. Everything here is independently valuable and none of it requires PayPal.

1. **Read tracking** — `ChapterRead`, `GateImpression`, `ChapterStatsDaily`. Ship first: it starts accumulating history immediately, and every day it isn't shipped is a day of analytics you can never backfill.
2. **Job infrastructure** — `JobLock`, `Job`, `node-cron` wiring, graceful shutdown, health endpoint.
3. **Serializer convention** — per-model serializers; fixes the live `sourceFile.key` leak.
4. **Schema-driven settings** — the declaration format plus validator, before 200 settings get hand-written.
5. **Webhook mount point + maintenance guard fix** (also fixes the dead admin exemption).
6. **Replica-set test harness.**
7. **Rate limiting.**
8. **Migrations** — `publishedAt`, `wordCount`, `originalNumber`, `User.library` index, wallet creation hook.
9. **Delete guards** — purchased chapters, transacted users.
10. **Notification consolidation** — route `notifyLibraryUsers` through `dispatchNotification`; add the email queue.

Item 1 is the one with a deadline attached. Everything else can be done whenever; read history cannot be reconstructed after the fact.
