# 002 — Nine pre-existing test failures across five suites

**Severity:** Medium — the suite cannot be used as a release gate until these are green or explicitly quarantined
**Found:** 15 Aug 2026
**Related to spaces:** No. Established by the evidence below, not by assumption.

---

## Summary

```
npm test -- grants chapterAccess stage1 rollups fxAndLimits
Tests: 9 failed, 147 passed, 156 total
```

| Suite | Failures | What breaks |
|---|---|---|
| `grants.test.js` | 3 | Expects `Wallet.findOne(...)` to be `null` for an untouched user |
| `stage1.test.js` | 3 | Email queue retry count, failure recording, per-user daily cap |
| `chapterAccess.test.js` | 1 | `PUT /api/wallet/auto-unlock` returns 403 where 200 is expected |
| `fxAndLimits.test.js` | 1 | INR `settlementMode` is `local`, expected `usd` |
| `rollups.test.js` | 1 | Author earnings 17 cents, expected 16 |

## Evidence that the community work is not the cause

Every service and model these suites exercise is **byte-identical to HEAD**: `rollupService`, `analyticsService`, `creditService`, `grantService`, `emailQueue`, `fxService`, `accessService`, `utils/mailer`, and the `Wallet`, `Currency`, `Novel`, `Author`, `CreditTransaction`, `ChapterStatsDaily` models.

The community work touches seven tracked files: `app.js`, `config/constants.js`, `config/settingsRegistry.js`, `middlewares/auth.js`, `middlewares/rateLimit.js`, `models/User.js`, `server.js`.

Of those, the only two in these suites' dependency graphs are `constants.js` and `User.js`, and **both diffs are purely additive** — `git diff` shows zero removed lines other than one import statement that grew. No hook, method, or existing field was changed.

## Two causes traced precisely

### `grants.test.js` — wallet provisioning

The test asserts no wallet exists for an untouched user:

```js
expect(await Wallet.findOne({ user: users[0]._id })).toBeNull();
```

But `models/User.js` has had a `post('save')` hook since before this work (line 54 at HEAD) that provisions a wallet for **every** new user:

```js
userSchema.post('save', async function provisionWallet() {
  if (!this.$locals.wasNew) return;
  const Wallet = require('./Wallet');
  await Wallet.getOrCreate(this._id);
});
```

`createUser()` therefore always produces a wallet, and the assertion cannot pass. Either the hook post-dates the test, or the test was written against a mocked path.

**Fix direction:** decide which is authoritative. If universal provisioning is intended, the test should assert `balance === 0` rather than absence. If it is not, the hook should be conditional.

### `rollups.test.js` — round vs floor

```js
expect(rows[0].revenueUsdCents).toBe(16); // two unlocks at 83,250 micros
```

Two unlocks × 83,250 micros = 166,500 micros. With `MICROS_PER_CENT = 10000` that is **16.65 cents**. `Math.round` gives 17, `Math.floor` gives 16. `rollupService` rounds; the test expects truncation.

**Fix direction:** decide the rounding policy for revenue attribution and apply it consistently. Rounding up across many rows inflates reported revenue; truncating deflates it. Banker's rounding or accumulating in micros and converting once at the end are both defensible — picking one and documenting it matters more than which.

## The other five

Not traced. Each sits in unchanged code with an unchanged test, so each is a genuine pre-existing behaviour/expectation mismatch:

- **`stage1.test.js` ×3** — email queue: retries once instead of three times, records zero failures instead of one, sends five instead of the two the daily cap allows. All three suggest the queue's retry and cap logic diverged from the test, or the drain does not complete before assertions run. Likely entangled with [issue 001](./001-emailqueue-teardown-crash.md).
- **`chapterAccess.test.js`** — `PUT /api/wallet/auto-unlock` with `maxPriceCredits: 9999` returns 403; the test expects 200 with the value clamped to 25. Something now rejects rather than clamps.
- **`fxAndLimits.test.js`** — an update path that bypasses the document does not run the settlement-mode sanitizer, so INR keeps `local` when it should be forced to `usd` (INR is not a PayPal settlement currency).

## Environment note

The run was on **Node v25.8.2**, well ahead of what `mongoose@8.5` and `jest@29` target. That is unlikely to explain the arithmetic and wallet cases, but it is worth eliminating as a variable before investigating the email-queue timing failures.

## Why deferred

Unrelated to the community feature in progress, and each needs a product decision (what is the rounding policy, should every user get a wallet) rather than just a code change.

## Suggested next step

Establish a true baseline on a clean tree without disturbing the working directory:

```
git worktree add /tmp/novelhub-baseline HEAD
cd /tmp/novelhub-baseline/backend && npm ci && npm test
```

If the same nine fail there, they are confirmed pre-existing and can be triaged on their own schedule.
