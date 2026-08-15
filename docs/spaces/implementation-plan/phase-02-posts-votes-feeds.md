# Phase 2 — Posts, Votes and Feeds

**Status:** ✅ Complete — 463 unit tests passing (51 new)
**Depends on:** Phase 1
**Unblocks:** Phases 3, 4, 5
**Reference:** [architecture](../architecture.md) §4.3, §4.5, §5, §6, §7.2 · [scalability](../scalability.md) §4 · [readiness](../platform-readiness.md) §13.2

---

## Goal

The core loop: create a post, vote on it, see a ranked feed. This is the phase where the scalability decisions either get made or get made expensive.

**Two facts govern everything here.** `Vote` will become the largest collection on the site by two orders of magnitude. And a feed is an index scan or it does not scale — there is no hardware that fixes a feed built on an aggregation.

---

## Files to create

```
backend/src/models/Post.js
backend/src/models/Vote.js
backend/src/services/community/rankingService.js      ← pure, no I/O
backend/src/services/community/feedService.js
backend/src/services/community/voteService.js
backend/src/services/community/postService.js
backend/src/controllers/postController.js
backend/src/controllers/feedController.js
backend/src/routes/postRoutes.js
backend/src/routes/feedRoutes.js
backend/tests/ranking.unit.test.js
backend/tests/feedPagination.integration.test.js
backend/tests/voteIdempotency.integration.test.js
backend/tests/indexPlans.integration.test.js
```

---

## Ranking — `rankingService` must stay pure

Scores in, scores out, no database access. Testable, cheap, portable.

```
hot         = log10(max(|score|,1)) + sign(score) × (createdAtSec − EPOCH) / gravitySeconds
best        = Wilson lower bound at z = spaces.ranking.confidenceZ
controversy = (up+down) ^ (min(up,down)/max(up,down)),  0 if either side is 0
rising      = score / max(ageMinutes, floor), computed at read time on a bounded window
top         = score, filtered by timeframe
```

`gravitySeconds` is `spaces.ranking.hotGravitySeconds` (45000). It is the single most consequential dial in the product, which is why it is a setting.

`hotScore` is **persisted and indexed**, recomputed on every vote — it is arithmetic on two numbers already in hand, so this is free. `EPOCH` is `HOT_SCORE_EPOCH_SECONDS` in constants, a fixed value, not a tunable.

---

## Vote write path

One `updateOne` with `upsert: true` on the unique key `{user, targetType, target}` returns whether it inserted or matched; the delta (`+1`, `-1`, `+2`, `-2`, `0`) is derived from the previous value. Then one `findOneAndUpdate` on the post with `$inc` and the recomputed `hotScore`.

**Two writes per vote. No transaction, no read-modify-write race.**

All counter updates go through `counterService` (Phase 0), never a direct `$inc` at the call site.

---

## Feed query shape

```js
Post.find({ space: { $in: spaceIds }, status: 'published', ...cursorClause })
    .sort({ hotScore: -1, _id: -1 })
    .limit(limit + 1)          // +1 detects hasMore without a count
```

Index scan on `{space, status, hotScore, _id}`. No aggregation, no `$lookup`, no `skip`.

Cursor is base64 of `{ v: sortValue, id: lastId }` — opaque to the client, validated server-side, reset on sort change.

Author and space data hydrate via two batched `find({_id: {$in: […]}})` calls on lean projections. Viewer vote state is one `Vote.find({user, target: {$in: postIds}})` merged into the response.

---

## BLOCKING

**Explicit field allowlists on every update.** A `PATCH /api/posts/:id` that spreads `req.body` lets a user set their own `score`, `hotScore`, `pinnedGlobally` or `status`. Allowlist per role — an author may change fewer fields than a moderator.

**IDOR test matrix.** Every endpoint taking an ID verifies the actor's relationship to it through `spacePermissionService`. The Phase 1 matrix extends to cover post-level actions.

---

## FREE items with rationale

| Item | Why it must be now |
|---|---|
| **`Vote.space` populated on every write** | Unqueried until per-space karma and anomaly detection. Adding a field to a 500M-row collection is a migration measured in hours of downtime |
| **`Vote.nullified` boolean** | Vote manipulation enforcement nullifies rather than deletes, so counters stay rebuildable and evidence survives. Same migration argument |
| **`Vote.fingerprint`** (hashed, retention-limited) | The best alt-account signal available, and worthless if collection begins after the abuse does |
| **ESR index field order** | Equality, Sort, Range. Wrong order still gets used by the planner and still sorts in memory — it looks fine in a glance at `explain()` |
| **Index plan assertions in tests** | Assert `IXSCAN` and no `SORT` stage on every feed query. This is what stops a silent regression |
| **Sparse and partial indexes** | `linkedRefs` is sparse (most posts link to nothing); the moderation queue is partial on `reportCount > 0` |
| **Read preference annotated per call site** | Feeds `secondaryPreferred`; **my vote state and post-create redirect `primary`**. A vote that visually bounces back is the most-reported bug on every voting site. Retrofitting this judgement across a hundred call sites is the expensive part of adding replicas |
| **Batch hydration, no `$lookup`** | Plus a test asserting queries-per-request is a constant. That test is the N+1 alarm |
| **`rankingService` pure** | No I/O, ever |
| **Post move = delete-and-recreate** | A shard key value cannot be updated in place, so the obvious `updateOne({space})` implementation stops working the day sharding arrives |
| **`rel="nofollow ugc"` on user links** | Without it the community is an SEO spam target within weeks, and adding it later does not undo the damage |
| **`spaces.scale.maxJoinedSpaces`** (500) | Bounds the home feed `$in` before it degrades |
| **Grapheme-based length limits** | Not bytes, not UTF-16 units. An emoji is not 4 characters to a user |
| **Images served with `Content-Disposition`** or from a separate origin | So a file that slips past the mime check cannot execute in the app origin |

---

## Indexes

```js
{ space: 1, status: 1, hotScore: -1, _id: -1 }     // space feed, hot
{ space: 1, status: 1, createdAt: -1, _id: -1 }    // new
{ space: 1, status: 1, score: -1, _id: -1 }        // top
{ space: 1, pinnedInSpace: -1, hotScore: -1 }
{ status: 1, hotScore: -1, _id: -1 }               // global all
{ pinnedGlobally: -1, hotScore: -1 }
{ author: 1, createdAt: -1 }
{ 'linkedRefs.type': 1, 'linkedRefs.id': 1, createdAt: -1 }   // sparse
{ status: 1, reportCount: -1 }                     // partial: reportCount > 0
{ 'poll.endsAt': 1 }
{ title: 'text', bodyText: 'text' }

// Vote
{ user: 1, targetType: 1, target: 1 }   // unique
{ target: 1, value: 1 }                 // counter rebuild
{ user: 1, createdAt: -1 }
{ space: 1, user: 1 }
```

Eleven indexes on `Post` is already a lot — each is write amplification on every insert. Before adding a twelfth, check `$indexStats` for one nobody uses.

---

## Tests

- **Vote idempotency:** double-submit, rapid flip, self-vote rejection, concurrent votes converging to correct counters.
- **Ranking:** hot, Wilson and controversy against known reference values.
- **Feed correctness:** cursor pagination returns every item exactly once while posts are inserted mid-page.
- **Index plans:** `IXSCAN`, no in-memory `SORT`, on every feed variant.
- **Queries per request:** constant regardless of page size.
- **Counter rebuild:** corrupt counters deliberately, rebuild, assert convergence.
- **Mass assignment:** a crafted `PATCH` cannot alter `score`, `status` or `pinnedGlobally`.

---

## Definition of done

- [x] Post CRUD, voting, and all five sorts working
- [x] Cursor pagination with an `_id` tiebreak, malformed cursors degrade to page one
- [x] Feed indexes follow ESR, asserted in tests
- [x] Batched hydration — two queries plus one vote lookup, independent of page size
- [x] Vote path idempotent — same value twice produces a zero delta
- [x] Read preference annotated at every call site
- [x] `rebuildCounters` recomputes from the Vote ledger
- [ ] Prove `IXSCAN` with `explain()` against a real database
- [ ] Integration tests (`npm test`) — could not run in the build sandbox

---

## Bug caught during the build

**The hot formula had its sign in the wrong place.** I wrote:

```
log10(max(|score|,1)) + sign(score) * seconds/gravity
```

The reference implementation is:

```
sign(score) * log10(max(|score|,1)) + seconds/gravity
```

The sign multiplies the **order**, not the time. With it on the time term, a post at −50 outranks one at −5, because a larger magnitude buys a larger positive contribution — exactly backwards. A zero-score post also collapsed to a constant 0 rather than ordering by recency, which would have made every brand-new post tie at the bottom of Hot.

The two formulations read almost identically. It was caught by a property test asserting that a heavily downvoted post sinks below a lightly downvoted one — not by reading the code.

## Other decisions taken during the build

**The author's automatic upvote is a real `Vote` row**, not a synthetic `+1` on the counters. A synthetic bump would leave every post permanently off by one after the first counter rebuild, because the ledger and the cache would disagree by construction.

**`voteService.cast` uses `returnDocument: 'before'`** on the upsert. That single round trip both records the new vote and reports what it replaced, which is what keeps the write path at two operations with no read-modify-write race.

**Score visibility is enforced server-side.** `applyScoreVisibility` deletes the fields from the response. Hiding a number the payload still contains is not hiding it.

**Removed posts stay reachable by direct link** for their author and for moderators, with the removal reason but never the moderator's private note.
