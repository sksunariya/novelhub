# 001 — `emailQueue` timer crashes the test process after teardown

**Severity:** Medium
**Found:** 15 Aug 2026, during the first full `npm test` run of the community work
**Related to spaces:** No. `src/services/emailQueue.js` is untouched by that work.

---

## Symptom

`npm test` ends with an **unhandled exception that kills the Node process**, rather than a clean jest exit:

```
MongoNotConnectedError: Client must be connected before running operations
    at model.getDoc (src/models/AppSettings.js:114:13)
    at loadFresh (src/services/settingsService.js:55:15)
    at Object.snapshot (src/services/settingsService.js:82:7)
    at drain (src/services/emailQueue.js:77:22)
Node.js v25.8.2
```

## Why it matters beyond the noise

- **It kills the process**, so jest's exit code and summary are unreliable. CI cannot distinguish this from a real failure.
- **It masks other failures.** In the full run, `fxAndLimits.test.js` reported "Test suite failed to run" twice with this same stack — those may be reporting artifacts rather than genuine suite failures.
- It makes every run end in a wall of stack trace, which trains people to ignore the end of the output.

## Cause

`emailQueue.drain()` runs on a timer. `tests/setup.js` disconnects mongoose in its `afterAll`:

```js
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
```

If a drain timer is still pending when that runs, it fires afterwards, calls `settingsService.snapshot()`, which calls `AppSettings.getDoc()`, which hits a disconnected client. Nothing catches it.

`tests/setup.js` already does exactly this kind of cleanup for two other modules:

```js
require('../src/services/settingsService').clearCache();
require('../src/middlewares/rateLimit')._buckets.clear();
require('../src/services/paypalService').resetTokenCache();
```

`emailQueue` was simply never added to that list — because unlike the other three it owns a **timer**, not just cached state, so it needs a `stop()` rather than a reset.

## Proposed fix

Two parts.

**1. Give `emailQueue` a `stop()`** that clears its pending timer and marks it drained:

```js
const stop = () => {
  if (timer) { clearTimeout(timer); timer = null; }
  draining = false;
};
```

**2. Call it from `tests/setup.js`**, in `afterAll` and *before* `mongoose.disconnect()`:

```js
afterAll(async () => {
  require('../src/services/emailQueue').stop();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
```

**Also worth doing:** `drain()` should tolerate a disconnected client rather than throwing — a background flush must never be able to take down the process. Wrapping the `snapshot()` call and bailing when `mongoose.connection.readyState !== 1` is a two-line guard that makes this class of bug impossible.

The same pattern was applied to the new `counterService` and `jobDispatcher` deliberately: both `unref()` their timers and expose a drain called from `server.js`'s shutdown sequence. `emailQueue` predates that convention.

## Why deferred

It is unrelated to the community feature currently being built, and fixing it means touching the shared test harness mid-feature. Cheap to do standalone.

## Verification

After fixing, `npm test` should exit cleanly with a jest summary and no Node stack trace, and `fxAndLimits.test.js` should report a normal pass/fail rather than "Test suite failed to run".
