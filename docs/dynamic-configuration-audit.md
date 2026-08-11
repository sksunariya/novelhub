# Dynamic configuration audit — what else should the admin control?

**Date:** 2026-08-08
**Question:** is everything highly dynamic and admin-controllable?
**Short answer:** the monetization design is. The platform around it is not, and my own spec left several things static that shouldn't be.

**Related:** [`monetization-architecture.md`](./monetization-architecture.md) · [`admin-portal-spec.md`](./admin-portal-spec.md) · [`pre-implementation-audit.md`](./pre-implementation-audit.md)

---

## 0. Three structural gaps before any individual setting

### 0.1 There is no settings infrastructure — only a hand-written singleton

`SiteSettings` is one document with ~25 fields, and `updateSettings` is 70 lines of manual coercion. Adding 200+ monetization settings on that pattern gives ~600 lines of hand-rolled `=== 'true'` checks with no validation, no defaults registry, no metadata, and no way to build a settings search.

**What's needed is a settings registry** — declare each setting once:

```js
{
  key: 'credits.perUsd',
  section: 'monetization.general',
  type: 'integer', default: 100, min: 1, max: 100000,
  label: 'Credits per USD', help: '…',
  public: true,                    // included in the public settings projection
  secret: false,                   // masked in admin responses, env-backed
  requiresConfirmation: true,      // triggers an impact preview
  impact: 'revalueBalances',       // named impact-preview resolver
  scope: ['global', 'novel'],      // where it can be overridden
}
```

Everything else derives from that declaration: the validator, the coercion, the admin form, the public projection, the `⌘K` search index, the audit diff, the export/import format, and the reset-to-default action. This is the single highest-leverage piece of infrastructure in the whole project — without it, "everything is configurable" becomes unmaintainable by about setting number 60.

### 0.2 Settings are read from the database on every request, uncached

`SiteSettings.getSettings()` is called in `maintenanceGuard` — which runs on **every** `/api` request — and again in `readChapter`, and again inside `dispatchNotification`. That's already 2–3 uncached round trips per request. Adding a second `MonetizationSettings` singleton, plus per-novel and per-chapter override resolution, multiplies it.

**Needed:** an in-process settings cache with a version counter, invalidated on write and re-checked cheaply. Without it, "more configuration" directly means "slower site".

### 0.3 There is no scheduler, so time-based configuration silently doesn't work

Covered as C3 in the pre-implementation audit, but here's the proof it's already biting:

**`weeklyViews` is never reset.** It's incremented in `chapterController` and `novelController`, and no code anywhere sets it back to zero. `TRENDING_WINDOW_DAYS = 7` is exported from `constants.js` and imported by nothing.

So the "Trending" ranking is a permanently accumulating counter — functionally identical to "Popular", just with a different starting date. Every trending list on the site is wrong today, and no admin setting can fix it because the reset job doesn't exist. Any future setting expressed as "per week", "expires after", or "scheduled for" has the same dependency.

---

## 1. Currently hardcoded — should be admin-controlled

### 1.1 Ranking and discovery — the biggest missed opportunity

Rankings are single-field sorts:

```js
trending: { weeklyViews: -1 },
popular:  { views: -1 },
rating:   { ratingAvg: -1, ratingCount: -1 },
```

This has two consequences worth fixing. First, a novel with one 5-star review outranks a novel with 500 reviews averaging 4.8 — there's no minimum-votes threshold or Bayesian prior. Second, you have no way to tune what the homepage promotes without a deploy.

**Make dynamic:** a weighted scoring formula per ranking type, editable in admin —

```
score = w_views·views + w_recent·recentViews + w_rating·bayesianRating
      + w_engage·(comments + reviews) + w_revenue·revenue
      + w_completion·completionRate − w_age·ageDecay
```

with a **preview panel showing the resulting top 20 before saving**. Plus: trending window (days), Bayesian prior strength and minimum vote count, per-ranking item counts, decay half-life, manual pin/boost/bury per novel, and whether revenue influences ranking at all (a real editorial decision — do you promote what sells or what's loved).

Also hardcoded: featured limit (10), rankings default limit (10), carousel auto-fill threshold (`slides.length < 4`) and target (`5 - slides.length`), and homepage section **order** and per-section item counts — currently only visibility is toggleable.

### 1.2 Content limits and validation

All in Mongoose schemas, so every change is a deploy:

| Limit | Current |
|---|---|
| Novel title / author / synopsis | 200 / 100 / 5000 |
| Chapter title | 300 |
| Comment / review / reply | 2000 / 2000 / 5000 |
| Username | 3–30 |
| Password minimum | 6 |
| Image / document upload | 5 MB / 20 MB |
| Rating scale | 1–5 fixed |
| Notification message | 500 (silently truncated) |
| Mentions parsed per comment | 10 |

Mongoose `maxlength` can be driven from settings at validation time rather than schema definition. The rating scale is the interesting one — 1–5 vs 1–10 vs thumbs up/down is a product decision currently welded into `constants.js` and the `StarRating` component.

### 1.3 Auth and security policy

Hardcoded in `authController`: `RESEND_COOLDOWN_MS = 60000`, `MAX_OTP_ATTEMPTS = 5`, username 3–30, password min 6. JWT expiry is env-only (`7d`).

**Missing entirely:** login attempt lockout, password complexity rules, breached-password checking, disposable-email blocking, allowed/blocked email domains, reserved usernames, session/device limits, forced re-auth for sensitive actions (which matters once wallets exist — a stolen session can spend real money), and 2FA for admin accounts. **Admin 2FA should arguably be mandatory rather than configurable** once the portal can move money.

### 1.4 Reader experience

`READER_THEMES` (4), `FONTS` (2), and `DEFAULT_SETTINGS` are frontend constants. Admin should control: which themes exist and their colors, which fonts are offered, defaults for new readers, font-size min/max bounds, and whether readers may override at all.

**Missing:** auto-scroll, text-to-speech, reading-time estimates, per-chapter progress bar, keyboard shortcut config, "continue reading" prompt behaviour, and chapter prefetch (which interacts with monetization — you must not prefetch locked content).

### 1.5 Notifications

Hardcoded: history limit 50 (in two places), campaign batch size 250, message truncation 500, max mentions 10. No retention or cleanup policy exists, so the collection grows forever.

**Missing:** digest mode (batch a day's notifications into one email), quiet hours, per-type retention, max notifications per user per day, and unsubscribe-link handling.

### 1.6 View and engagement tracking

`VIEW_DEDUP_WINDOW_SECONDS = 1800` is a constant. Beyond making it configurable: whether anonymous views count at all, bot/crawler filtering (none exists — your view counts include every scraper), minimum dwell time before a view registers (currently a page load counts, so a misclick is a "read"), and whether view counts are public.

### 1.7 Moderation and community

No automated moderation exists. Worth making configurable: banned-word list with action (block / flag / shadow-hide), link posting rules, minimum account age or chapters-read before commenting, per-user comment rate limits, comment edit and delete windows, reply nesting depth, report thresholds for auto-hide, and — directly relevant to monetization — **whether reviewing a chapter requires having unlocked it.** Otherwise paid chapters accumulate reviews from people who never read them.

### 1.8 Email templates and branding

Every email body is hardcoded HTML in `utils/mailer.js`. Admin should own subject lines, bodies, from-name, reply-to, footer, logo and colors, with variable insertion and test-send — the same template system the monetization spec already defines for notifications, extended to cover OTP, password reset and chapter alerts.

### 1.9 Genres and tags

Genres are free text on `Novel`, and `getGenres` runs `distinct`. So "Sci-Fi", "Sci Fi" and "sci-fi" become three genres, and there's no canonical list, ordering, description, icon, color, or merge/rename tool. For a browse experience this degrades quickly. Needs a managed `Genre` collection with an admin-curated list and a migration tool.

### 1.10 SEO and metadata

Nothing configurable: no meta description templates, no OG image strategy, no sitemap, no `robots.txt`, no canonical URL handling, no structured data. For a content site that depends on search traffic, this is a significant omission — and it's cheap to add as templated fields (`{{novelTitle}} — {{siteName}}`).

### 1.11 Localization

Roughly 60 user-facing strings are hardcoded in controllers, and the whole frontend is English-only. The brief says users are worldwide — currency is handled thoroughly by the monetization design, but **language isn't addressed at all.** Even if you don't translate now, routing strings through a message catalogue keyed by locale is much cheaper to do before there are 200 of them than after.

---

## 2. What I left static in my own monetization spec

Reviewing my own documents against "highly dynamic":

| Gap | What's missing |
|---|---|
| **Price experiments / A-B testing** | Not in the spec at all. The biggest one. You should be able to run "pack A at $9.99 vs $8.99" across a randomized cohort and read the conversion difference. Needs an `Experiment` model, deterministic user bucketing, exposure logging, and results in analytics. Without it, every pricing decision is a guess |
| **Referral program** | I listed `referral` as a credit-bucket source and never designed the program: reward amounts for referrer and referee, qualification event, fraud rules, caps |
| **Loyalty, streaks, daily rewards** | Absent. Daily login credits, reading-streak bonuses, milestone rewards — near-universal in this app category and a direct driver of the retention curve the analytics measure |
| **Ad-supported unlock** | My subscription perks include `adFree`, which implies ads exist, but there is no ad configuration anywhere. "Watch an ad to unlock one chapter" is a major revenue path for non-paying readers |
| **Wait-to-unlock timers** | I have `freeAfterDays` (global, per chapter). The Webtoon-style model is per-*user* timers — "this chapter unlocks free for you in 23 hours" — which is a different and very effective mechanic |
| **Gifting** | Give credits or a specific chapter to another user. Cheap to build on the existing ledger, meaningful for community |
| **Tipping authors** | Direct support, distinct from chapter unlocks. Relevant once revenue share exists |
| **Bundles and season passes** | Buy an arc or volume at a fixed price. My bulk unlock is quantity-discount only, not curated bundles |
| **Progressive/loyalty pricing** | The more chapters you own in a novel, the cheaper the next. Rewards commitment |
| **Purchasing-power pricing** | I put a `regionMultiplier` toggle in the Geo tab but never modelled the table properly, and never resolved how it interacts with the FX markup |
| **Admin alerting** | Entirely absent. Revenue drop vs forecast, failed-payment spike, refund-rate anomaly, webhook failures, FX staleness, ledger drift, liability threshold breach — with per-alert channel and threshold config |
| **Percentage rollouts** | My feature flags are boolean. Real flags need % rollout, cohort targeting, and per-country enablement |
| **Scheduled setting changes** | `PricingRule` has `validFrom`/`validUntil`, but general settings don't. "Turn on the sale Saturday 00:00" should not need someone awake |
| **Config versioning and rollback** | The audit log records changes; there's no one-click revert to a prior config snapshot |
| **Config export/import** | No way to move settings between staging and production, or to seed a known-good baseline |
| **Preview-as** | View the store as a user in India on mobile with no purchase history. With this much conditional logic — visibility rules, geo, cohorts, experiments — you cannot verify the config is right without it |

The first and last are the ones I'd prioritize: experiments make pricing empirical instead of guessed, and preview-as is the only practical way to test a configuration surface this large.

---

## 3. What should *not* be configurable

"Everything configurable" has real costs: config surface area, testing combinatorics (every toggle doubles the state space), support burden, and per-request settings reads. Some things should stay in code.

**Keep hardcoded:**

- **Anything that would break financial correctness.** The idempotency key format, the ledger append-only rule, the cost-basis formula, the accounting identity. An admin must not be able to switch off double-spend protection.
- **PayPal's supported-currency list.** Derived from a constant, read-only in the UI — an admin lying about it just generates orders PayPal rejects.
- **Security invariants.** Webhook signature verification, the atomic-debit pattern, unique index constraints, password hashing cost. Configurable security is a vulnerability with a settings page.
- **Anything with exactly one sensible value.** If you cannot articulate a scenario where someone changes it, it's a constant with extra steps.

**Rule of thumb:** make it configurable when a reasonable operator would plausibly want a different value, and the wrong value is recoverable. Everything else is code.

---

## 4. Enabling infrastructure, in dependency order

Almost everything above depends on the same five pieces:

1. **Settings registry** (§0.1) — the declaration format. Blocks essentially everything else.
2. **Settings cache** (§0.2) — or the site gets slower with every setting added.
3. **Scheduler + job locks** (§0.3) — blocks trending resets, scheduled config, expiry, rollups, campaigns.
4. **Experiment framework** — bucketing, exposure logging, results. Blocks price testing and any rollout percentage.
5. **Preview-as / impersonation** — read-only, heavily audited. The only way to QA a configuration surface this size.

Build 1–3 in Phase 0 alongside the audit's read tracking; 4–5 can follow in Phase 3 with the admin portal.

---

## 5. Suggested answer to the original question

Not yet — but the gap is smaller than it looks, because it's concentrated in infrastructure rather than in hundreds of individual settings. Ship the settings registry, the cache and the scheduler, and adding any specific control afterwards is a few lines of declaration rather than a code change.

The genuinely missing *capabilities* — as opposed to missing knobs — are: ranking formula control, experiments, alerting, localization, genre management, and the growth mechanics (referrals, streaks, ads, gifting, wait-to-unlock). Those are product decisions worth making deliberately rather than building all of them.
