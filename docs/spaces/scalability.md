# Community Scalability Playbook

**Status:** Reference document. Most of it is deliberately **not** being built now.
**Date:** 2026-08-14
**Parent docs:** [`architecture.md`](./architecture.md) · [`platform-readiness.md`](./platform-readiness.md)

**How to use this document.** Section 4 is the part that matters today: database and code decisions that cost nothing now and are expensive or impossible to retrofit. Everything from §6 onward is a runbook for later — when a specific thing gets slow, find the symptom in §8, and it points at the fix and the section explaining it.

**The constraint this document respects:** we stay a modular monolith. No Redis, no queue, no search cluster, no extracted services until a measured problem forces it. What we do instead is draw the seams so that each of those is a swap behind an existing interface rather than a rewrite.

---

## 1. Read this first — the shape of the problem

**Three facts determine everything below.**

**1. Votes dominate. Nothing else is close.**

At 100k daily active users averaging 20 votes each, that is 2M vote writes per day — 730M rows per year. Posts at 2% participation are ~2,000/day. Comments at 10% × 3 are ~30,000/day. The vote collection will exceed every other collection by two orders of magnitude in row count, and its unique index will exceed available RAM long before anything else does.

**Every scaling decision in this document is really a decision about votes.**

**2. The feed must remain an index scan.**

`hotScore` is persisted and indexed precisely so a feed page is a bounded range scan on a compound index. The moment a feed needs an aggregation, a `$lookup`, or a sort on a non-indexed field, it stops being O(page size) and becomes O(collection). There is no amount of hardware that fixes that.

**3. The current architecture already scales further than the traffic will need for a while.**

A single Node process against a well-indexed MongoDB replica set handles a community with tens of thousands of daily actives. The failure mode is not "the architecture is wrong", it is "one query lost its index" or "one document became hot". §8 is written for that reality.

---

## 2. Principles

| Principle | Consequence |
|---|---|
| **Design the schema for a shard key you may never use.** | Resharding a live 700M-row collection is a project. Including the field now is free. |
| **No unbounded arrays. Ever.** | A 16 MB document limit is a hard wall, and a growing array rewrites the whole document on every push. |
| **Denormalized counters are caches; the ledger is truth.** | Any counter can be wrong and rebuilt. This is what makes async and batched updates safe later. |
| **Keyset pagination everywhere. `skip` nowhere.** | `skip(n)` is O(n). It is also incorrect on a live feed. |
| **Every hot path is one indexed query plus batched hydration.** | No `populate` in a loop, no `$lookup`, no per-row queries. |
| **Interfaces at the seams, no-op implementations behind them.** | Cache, rate-limit store, counter writer and job dispatcher each get an interface now and a real backend later, without touching call sites. |
| **Stateless application processes.** | Any state in process memory is a barrier to running a second instance. Know exactly where it is. |
| **Measure before you fix.** | Every stage transition in §6 has a numeric trigger. Moving early adds operational cost for no benefit. |

---

## 3. Capacity model

Rough figures, deliberately pessimistic. Use them to know which stage you are in.

### 3.1 Per-row storage, including indexes

| Collection | Doc size | Indexes | Total per row |
|---|---|---|---|
| `Vote` | ~120 B | 4 | **~500 B** |
| `PostComment` | ~1 KB | 6 | ~1.5 KB |
| `Post` | ~3 KB | 11 | ~4 KB |
| `SpaceMember` | ~250 B | 5 | ~600 B |
| `Space` | ~4 KB | 6 | ~5 KB |

### 3.2 Growth at three scales

| | 10k DAU | 100k DAU | 1M DAU |
|---|---|---|---|
| Votes/day | 200k | 2M | 20M |
| Vote storage/year | **36 GB** | **365 GB** | **3.6 TB** |
| Comments/day | 3k | 30k | 300k |
| Comment storage/year | 1.6 GB | 16 GB | 160 GB |
| Posts/day | 200 | 2k | 20k |
| Post storage/year | 0.3 GB | 3 GB | 30 GB |
| Peak writes/sec (3× average) | ~7 | ~70 | ~700 |

### 3.3 The number that actually matters: working set vs RAM

MongoDB is fast while the indexes you query fit in RAM. The vote unique index `{user, targetType, target}` is roughly 60 bytes per entry:

| Votes stored | Unique index size | Verdict |
|---|---|---|
| 50M | ~3 GB | Comfortable on a 16 GB instance |
| 200M | ~12 GB | Tight — needs 32 GB, or archival |
| 730M (100k DAU × 1yr) | **~44 GB** | **Exceeds a normal instance. Archive or shard.** |
| 3B | ~180 GB | Sharded, no alternative |

**This single table is the reason §4.5 exists.** Everything else has years of headroom; votes have roughly one year at 100k DAU.

---

## 4. Database design — decisions to make now

These are the only parts of this document that affect current work.

### 4.1 Shard keys — choose the field now, shard later

You cannot cheaply change a shard key on a large live collection. Including a suitable field in the schema costs nothing and preserves the option.

| Collection | Shard key when the time comes | Why |
|---|---|---|
| `Vote` | `{ user: 'hashed' }` | Even distribution; the hot query (`did I vote on these`) is by user, so it stays a single-shard query. Counter rebuilds by target become scatter-gather — acceptable, they are batch jobs. |
| `Post` | `{ space: 1, _id: 1 }` | Space feeds are the dominant query and stay single-shard. Ranged, so a giant space can be split. |
| `PostComment` | `{ post: 1, _id: 1 }` | An entire comment tree lives on one shard. This is the whole game for comments. |
| `SpaceMember` | `{ user: 'hashed' }` | "My spaces" is the hot query and drives the home feed. |
| `Report`, `ModAction` | `{ space: 1, _id: 1 }` | Moderation is always scoped to a space. |
| `SpaceStatsDaily` | `{ space: 1, date: 1 }` | Already the natural key. |

**What this means for schema work now:**

- **`Vote.space` must be populated on every write**, even though nothing queries it yet. It is what makes per-space karma rebuilds and per-space anomaly detection a targeted query instead of a full scan.
- **`PostComment.post` is denormalized on every comment including deep replies** — never derived by walking `ancestors`.
- **`Post.space` is immutable in practice.** Admin "move to another space" is a delete-and-recreate under the hood once sharded, because a shard key value cannot be updated in place. Build the move endpoint that way from the start.

### 4.2 ObjectId, monotonicity, and why it is fine

MongoDB `ObjectId` is monotonically increasing, so a **ranged** shard key starting with `_id` sends every insert to the same chunk — a write hotspot. Two of the keys above start with `_id`-adjacent fields, which is why:

- `Vote` and `SpaceMember` use **hashed** keys — no hotspot, and neither needs `_id` range scans.
- `Post` and `PostComment` use a **compound** key whose leading field (`space`, `post`) is high-cardinality and non-monotonic, so inserts spread across chunks naturally.

Keep `ObjectId`. Custom snowflake IDs buy nothing here and cost compatibility with every existing model.

### 4.3 No unbounded arrays — audit of the current design

A growing array rewrites the entire document on each push, fragments storage, and eventually hits the 16 MB ceiling.

| Field | Bound | Enforced by |
|---|---|---|
| `Space.rules` | 15 | `spaces.moderation.maxRulesPerSpace` |
| `Space.linkedRefs` | 5 | `spaces.links.maxPerSpace` |
| `Post.media` | 10 | `spaces.media.maxImagesPerPost` |
| `Post.poll.options` | 20 | `spaces.posting.maxPollOptions` |
| `Post.linkedRefs` | 3 | `spaces.links.maxPerPost` |
| `PostComment.ancestors` | 50 | `spaces.posting.maxCommentDepth` |
| `Space.topics` | small | taxonomy size |

**All bounded. Keep it that way.** The rule for any future field: if a user action can append to it without limit, it belongs in its own collection.

> **The anti-pattern to avoid is already in the codebase.** The legacy `Comment` model stores `likes: [ObjectId]` and `dislikes: [ObjectId]` inline. On a chapter comment with a few dozen likes that is fine. On a community post with 50,000 upvotes it would be a 600 KB document rewritten on every vote, and it would fail entirely past ~350k votes. This is exactly why community votes are a separate collection with a unique index rather than an array on the post. Do not "simplify" it back.

`User.library` is an existing unbounded array. It is not part of this project, but it is the same shape of problem and worth flagging if a user ever gets tens of thousands of entries.

### 4.4 Index strategy

**ESR — Equality, Sort, Range.** Compound index field order must be: fields matched by equality first, then the sort field, then range fields. Every feed index in the architecture doc follows it:

```
{ space: 1, status: 1, hotScore: -1, _id: -1 }
   equality   equality    sort        tiebreak
```

Getting this order wrong produces an index that MongoDB will use but which still performs an in-memory sort — it looks indexed in `explain()` at a glance and is not. **Assert `IXSCAN` and `SORT_MERGE`-free plans in tests for the feed queries**, not just that an index exists.

**Partial indexes to keep index size down.** Most posts are `published`; a partial index on the moderation queue is a fraction of the size:

```js
{ status: 1, reportCount: -1 },
  { partialFilterExpression: { reportCount: { $gt: 0 } } }
```

Same for `linkedRefs` (sparse — most posts link to nothing) and for any admin-only query path.

**Index count discipline.** `Post` carries 11 indexes. Every index is a write amplification on every insert and update. Before adding a twelfth, check whether an existing compound index has a prefix that serves the query. The cheapest performance win available on a write-heavy collection is deleting an index nobody uses — `$indexStats` tells you which.

**Covered queries where it is free.** A query answered entirely from an index never touches the document. The `did I vote on these` lookup is a natural candidate: project only `{ target: 1, value: 1, _id: 0 }` from `{ user: 1, targetType: 1, target: 1 }`.

### 4.5 The vote collection — the one real scaling problem

§3.3 shows the unique index outgrowing RAM at roughly 730M rows. Three mitigations, in the order they should be applied:

**A. Archive cold votes (do this first — simplest, biggest win).**

Votes older than N months on posts older than N months are never read again except by a rebuild job. Move them to `VoteArchive` with only `{ target, value, count }` aggregated, or to cold storage entirely. A post from two years ago does not need 40,000 individual vote rows online to display a score it will never change.

- Keep: every vote on a post newer than `spaces.scale.voteHotWindowDays` (default 180), plus every vote by a user active in that window.
- Archive: everything else, aggregated.
- This alone keeps the online vote collection roughly flat instead of growing forever.

**B. Drop `Vote.createdAt` retention to the abuse-detection window.**

Vote timestamps exist for manipulation detection. That analysis looks at days, not years. A retention purge on the timestamp field is not possible per-field, but archival (A) achieves the same thing.

**C. Shard on `{ user: 'hashed' }`.**

Only when A is exhausted. Adds real operational cost — config servers, balancer, backup complexity.

**Not recommended: moving votes out of MongoDB.** A separate vote store is a service extraction with cross-store consistency problems, for a workload MongoDB handles well. Archive first.

### 4.6 Hot document contention

A post on the front page receives thousands of `$inc` operations against **one document**. WiredTiger uses document-level concurrency control: concurrent writers to the same document conflict and retry. Past a few hundred writes per second on a single document, throughput collapses and latency spikes.

This will not happen at 10k DAU. It will happen the first time a post goes genuinely viral.

**Build the interface now, the implementation later.** All counter updates go through one module:

```js
// services/counterService.js
counterService.increment('post', postId, { score: +1, upvotes: +1 });
```

Today it is a direct `updateOne` with `$inc`. When contention appears, the same call becomes either:

- **Bucketed counters** — `PostCounter` rows keyed `{ post, bucket }` where bucket is `random(0..N)`. Writes spread across N documents; reads sum N rows, or a rollup job folds them back into `Post.score` every few seconds. Standard solution, well understood.
- **Batched in-process aggregation** — accumulate deltas in memory for 1–2 seconds and flush one `$inc`. Simpler, and loses at most a couple of seconds of counts on a crash, which for a vote counter is acceptable.

**Because the call site never changes, this is a one-file swap.** That is the entire reason for the interface.

### 4.7 Read preference — annotate now, switch later

Adding read replicas is a configuration change **only if** the code already knows which queries tolerate stale reads. Retrofitting that judgement across a hundred call sites is the expensive part.

Mark every community query at the call site:

| Read | Preference | Note |
|---|---|---|
| Feeds (hot/new/top) | `secondaryPreferred` | Seconds of staleness is invisible |
| Space and profile pages | `secondaryPreferred` | |
| Post detail | `secondaryPreferred` | |
| Comment tree | `secondaryPreferred` | |
| **My vote state** | **`primary`** | Read-your-writes. A vote that visually bounces back is the most reported bug on every voting site |
| **Post-after-create redirect** | **`primary`** | Same reason |
| Permission checks | `primary` | Never authorize against a stale ban |
| Moderation queue | `primary` | Two mods must not both action a stale item |

### 4.8 Home feed fan-in has a ceiling

The home feed is `Post.find({ space: { $in: spaceIds }, … })`. That is a fine plan while `spaceIds` is small. At several hundred joined spaces the index scan degrades into many scans merged.

**Now:** cap joined spaces (`spaces.feed.maxJoinedSpaces`, default 500 — high enough that nobody notices) and cap the `$in` to the user's most-active N spaces.

**Later, only if needed:** precomputed per-user feed rows (fan-out on write). This is a large, expensive machine and almost certainly never necessary at this scale. Do not build it speculatively.

### 4.9 What not to do

| Tempting | Why it is wrong here |
|---|---|
| Embed comments inside the post document | 16 MB ceiling, whole-document rewrites, no per-comment queries |
| Store voter IDs as an array on the post | Precisely the legacy `Comment.likes` anti-pattern (§4.3) |
| `$lookup` to join author and space into a feed query | Turns an index scan into a per-row nested loop. Batch hydration is faster and stays fast |
| Compute `hotScore` at read time | O(collection) per page load |
| `skip`/`limit` pagination | O(n) and incorrect on a live feed |
| A materialized "everything" feed collection | Doubles write volume to solve a problem you do not have |
| Sharding early | Operational cost with no benefit under ~200M rows |
| Denormalizing username onto every post | A username change becomes a million-document update. Batch-hydrate and cache instead |

---

## 5. Low-level design — the seams

Four interfaces, each with a trivial implementation today, each a swap point later. **This is the whole strategy for "scalable without more services".**

### 5.1 Cache — `services/cacheService.js`

```js
cacheService.wrap(key, ttlSeconds, () => expensiveThing());
cacheService.invalidate(keyOrPrefix);
```

**Today:** an in-process `Map` with TTL and a size cap. Works, and is correct for a single instance. `spaces.feed.cacheSeconds` already exists as the control.

**Later:** the same interface backed by Redis. Call sites unchanged.

**What to cache first, in order of value:** the anonymous Popular feed page 1, space metadata by slug, the resolved settings snapshot (already cached by `settingsService`), and per-space permission resolution for the duration of a request.

**Important:** because the in-process cache is per-instance, cached values must tolerate being stale for `cacheSeconds` on one instance and fresh on another. Never cache anything authorization-related for longer than a request.

### 5.2 Rate limit store — `middlewares/rateLimit.js`

The existing limiter keeps counters in a process-local `Map` and documents that the effective limit is N× the configured value behind N instances. Fine for payments; not fine for public write endpoints.

**Now:** extract the storage behind `{ incr(key, windowMs) -> count }`, keeping the in-memory implementation. Set community limits deliberately conservatively so that N× still lands somewhere sane.

**Later:** Redis `INCR` with `EXPIRE`. One file.

### 5.3 Counter writer — `services/counterService.js`

Covered in §4.6. The single most important seam in the system, because it is the one that will actually be needed.

### 5.4 Job dispatcher — `services/jobDispatcher.js`

```js
jobDispatcher.enqueue('post.linkPreview', { postId });
```

**Today:** executes inline, or writes a row that the existing cron picks up. The codebase already has `JobLock`, `JobRun` and a scheduler.

**Later:** a real queue (BullMQ on Redis). Call sites unchanged.

**Use it now for:** link preview fetching (slow, external, must not block the post response), thumbnail generation, notification fan-out, and CSAM hash checks. Writing these as dispatched jobs from day one is free and means the queue swap is invisible.

### 5.5 Module boundaries = future service boundaries

Keep the community code in directories that could be lifted out whole:

```
services/community/
  feedService.js          ← read-heavy, cacheable, first extraction candidate
  voteService.js          ← write-heavy, isolated, second candidate
  rankingService.js       ← pure functions, no I/O, trivially extractable
  spacePermissionService.js
  moderationService.js
```

`rankingService` must stay **pure** — score in, score out, no database access. That keeps it testable, cheap to call, and portable.

**No service is extracted now.** The rule is only: no community module reaches into another module's collections directly. Cross-module access goes through the owning module's functions. That discipline is what makes extraction a possibility rather than a rewrite, and it costs nothing to maintain.

### 5.6 Stateless processes — where state currently hides

Running a second instance requires knowing every piece of process-local state:

| State | Location | Multi-instance behaviour |
|---|---|---|
| Settings cache | `settingsService` | **Safe.** Version-poll converges within `SETTINGS_CACHE_MS` |
| Rate limit buckets | `rateLimit.js` | **Degrades.** Effective limit is N× configured |
| Job locks | `JobLock` in MongoDB | **Safe.** Already designed for it |
| Sessions | JWT, stateless | **Safe** |
| Feed cache (new) | `cacheService` | **Safe if TTLs are short.** Different instances serve slightly different pages |
| Multer buffers | per request | **Safe** |

Nothing here blocks a second instance today except the rate limiter's precision. That is a good position to be in.

---

## 6. High-level design — staged evolution

Each stage lists the trigger that justifies moving to it. **Do not move early.**

### Stage 0 — now

```
Browser → Node (single process) → MongoDB replica set
                                → S3
```

Handles roughly **10k DAU**. Everything in §4 applies at this stage; nothing in §6 does.

### Stage 1 — indexes and queries

**Trigger:** p95 API latency > 300ms, or any query in the slow log > 100ms.

Not a topology change. Fix the query. In practice this resolves 80% of "we need to scale" moments: a missing index, a wrong ESR order, an accidental `$lookup`, or an N+1 that crept in.

### Stage 2 — multiple app instances

**Trigger:** CPU sustained > 70% on the app process, or a single process cannot absorb peak.

```
Browser → Load balancer → Node ×N → MongoDB replica set
```

**Prerequisites:** rate limiter accepts N× imprecision or moves to a shared store (§5.2); in-process caches have short TTLs (§5.1). Both already true if §5 was followed. **No code changes needed.**

### Stage 3 — read replicas

**Trigger:** MongoDB primary CPU > 60%, and the read/write ratio is above ~10:1.

Point feed reads at secondaries. **This is a configuration change only because §4.7 annotated read preferences up front.** Without that, it is a survey of every query in the codebase.

### Stage 4 — shared cache

**Trigger:** the same feed query appears repeatedly in the slow log, or instance count is high enough that per-instance caches are wasteful (roughly 4+ instances).

Add Redis. `cacheService` swaps implementation; the rate limiter follows; sessions and feed pages move in. **One dependency, three problems solved.** This is the highest-value single infrastructure addition available, and the first one worth making.

### Stage 5 — async workers

**Trigger:** write endpoints blocked on slow work (link previews, thumbnails, notification fan-out), or p95 on `POST /api/posts` > 500ms.

`jobDispatcher` swaps to a real queue; the same Node image runs as a worker with a different entrypoint. **Still not a new service** — same codebase, different process role.

### Stage 6 — search extraction

**Trigger:** search p95 > 500ms, non-Latin search quality complaints, or the need for facets and typo tolerance.

MongoDB text indexes stop being adequate somewhere in the low hundreds of thousands of posts. `searchService` already isolates this; swap in Atlas Search (zero new infrastructure if already on Atlas) or Meilisearch.

### Stage 7 — vote path extraction

**Trigger:** vote writes > 1,000/sec sustained, or vote latency dominates the p99 despite §4.6.

The last resort, and the first genuine service split. `voteService` is already isolated with a narrow interface, so this is an extraction rather than an excavation.

### Stage 8 — sharding

**Trigger:** working set exceeds the largest practical instance — realistically 200M+ vote rows after archival (§4.5) has already been applied.

Shard keys are already chosen (§4.1) and the fields are already populated. This is the stage that is genuinely hard, which is why §4.5's archival step exists to postpone it indefinitely.

---

## 7. Settings to add for scale control

Add to `config/settings/spaces.js` when the corresponding work lands, so a scaling lever never needs a deploy:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `spaces.scale.voteHotWindowDays` | integer | `180` | Archival boundary (§4.5) |
| `spaces.scale.voteArchiveCron` | cron | `0 4 * * 0` | Weekly archival sweep |
| `spaces.scale.maxJoinedSpaces` | integer | `500` | Bounds the home feed `$in` (§4.8) |
| `spaces.scale.homeFeedMaxSpaces` | integer | `100` | Most-active subset used in the query |
| `spaces.scale.counterMode` | enum | `direct` | `direct \| batched \| bucketed` (§4.6) |
| `spaces.scale.counterFlushMs` | integer | `1000` | Batch window when `batched` |
| `spaces.scale.commentTreeMaxNodes` | integer | `500` | Cap on one comment payload |
| `spaces.scale.slowQueryMs` | integer | `100` | Slow-log threshold surfaced in admin |
| `spaces.scale.readPreference` | enum | `primary` | `primary \| secondaryPreferred` — flips Stage 3 without a deploy |

`counterMode` is the important one: it lets Stage 4.6 be switched on under load, observed, and switched back, without shipping code during an incident.

---

## 8. Runbook — symptom to fix

The table this document exists for.

| Symptom | Likely cause | Where to look | Fix |
|---|---|---|---|
| Feed slow, worsens with page depth | `skip` pagination crept in | `feedService` cursor handling | Restore keyset pagination (§2) |
| Feed slow at all depths | Missing or mis-ordered index | `explain()` — look for `COLLSCAN` or a `SORT` stage | Fix ESR order (§4.4) |
| Feed slow only for some users | Home feed `$in` too large | Count of joined spaces for that user | Cap with `homeFeedMaxSpaces` (§4.8) |
| Post detail slow on popular posts | Comment tree unbounded | Comment count on that post | Cap with `commentTreeMaxNodes`, lazy-load deeper (§4.5 of arch doc) |
| Vote latency spikes on one post only | Hot document contention | `writeConflicts` in `serverStatus` | Switch `counterMode` to `batched` (§4.6) |
| Vote latency high across the board | Index no longer fits RAM | `db.votes.totalIndexSize()` vs instance RAM | Archive cold votes (§4.5) |
| Scores visibly wrong | Counter drift | Compare `Post.score` against `Vote` aggregate | Run the rebuild job; investigate the write path |
| A user's vote bounces back visually | Reading vote state from a secondary | Read preference on that query | Force `primary` (§4.7) |
| Writes slow across all collections | Too many indexes, or index build in progress | `$indexStats`, `currentOp` | Drop unused indexes (§4.4) |
| Memory climbs until restart | In-process cache without a size cap | `cacheService` | Enforce max entries; move to Redis (Stage 4) |
| Rate limits ineffective | Per-instance counters × N instances | Instance count | Shared store (§5.2 / Stage 4) |
| Post creation slow | Synchronous link preview or thumbnailing | Timing inside the create handler | Dispatch as a job (§5.4 / Stage 5) |
| Search slow or poor quality | MongoDB text index at its limit | Post count, query language | Extract search (Stage 6) |
| Notification fan-out blocks a publish | Synchronous per-recipient writes | `notificationService` | Batch insert; dispatch async (§5.4) |
| Admin analytics slow | Querying raw collections instead of rollups | The analytics query | Read `SpaceStatsDaily` only (arch doc §4.11) |
| Everything slow after a deploy | New query without an index | Slow log since deploy | Add the index; add a test asserting the plan |

---

## 9. Monitoring — seeing it coming

Track these from Phase 2, because every trigger in §6 references one:

**Database:** working set vs RAM, `totalIndexSize` per collection, write conflicts per second, replication lag, slow queries per minute, connection pool saturation.

**Application:** p50/p95/p99 per endpoint (feed, post detail, vote, create), queries per request per endpoint (this is the N+1 alarm), cache hit rate, error rate.

**Product:** votes/sec, posts/hour, comments/hour, largest comment tree, largest space by post count, and the joined-space distribution's 99th percentile.

**Two alarms worth setting early**, because both are silent until they are severe:

1. **Queries per request** on the feed endpoint. It should be a small constant. The day it starts scaling with page size, an N+1 has been introduced.
2. **Vote index size as a percentage of instance RAM.** Crossing 60% is the signal to schedule archival, months before it becomes an incident.

---

## 10. What we are deliberately not building

Recorded so that a future reader knows these were considered and rejected for now, not overlooked:

| Not building | Why not | Revisit at |
|---|---|---|
| Redis | One more thing to operate; in-process caching is correct for one instance | Stage 4 |
| Message queue | Cron plus `JobLock` covers current needs | Stage 5 |
| Search cluster | MongoDB text search is adequate to ~100k posts | Stage 6 |
| Microservices | A modular monolith with clean seams is faster to build and easier to operate at this size | Stage 7, and only for the vote path |
| Sharding | Real operational cost, no benefit below ~200M rows | Stage 8 |
| GraphQL | REST with batch hydration is simpler and the client is ours | Never, probably |
| Precomputed per-user feeds | Doubles write volume to solve a problem we do not have | Only if §4.8's cap proves insufficient |
| CQRS / event sourcing | The vote ledger already provides the one rebuild guarantee that matters | Never |

**The through-line:** every deferred item above is deferred *behind an interface that already exists*. That is what makes "scalable" true today without adding a single service.

---

## 11. What moved into the implementation plan

Everything in this document that costs nothing today now sits in the phase plan at [`platform-readiness.md`](./platform-readiness.md) §13, marked **FREE**:

| Item | Section here | Lands in |
|---|---|---|
| `cacheService`, `counterService`, `jobDispatcher`, rate-limit store interfaces | §5.1–5.4 | Phase 0 |
| Shard-key fields on every model | §4.1 | Phase 1 |
| `services/community/` module boundaries | §5.5 | Phase 1 |
| Bounded arrays enforced on write | §4.3 | Phase 1 |
| `Vote.space`, `Vote.nullified`, `Vote.fingerprint` | §4.1, readiness §2.1 | Phase 2 |
| ESR index order plus plan assertions in tests | §4.4 | Phase 2 |
| Partial and sparse indexes | §4.4 | Phase 2 |
| Read preference annotated per call site | §4.7 | Phase 2 |
| Batch hydration, no `$lookup`, queries-per-request test | §4.9 | Phase 2 |
| Pure `rankingService` | §5.5 | Phase 2 |
| Post move as delete-and-recreate | §4.1 | Phase 2 |
| `maxJoinedSpaces` cap on the home feed `$in` | §4.8 | Phase 2 |
| `PostComment.post` denormalized on deep replies | §4.1 | Phase 3 |
| `commentTreeMaxNodes` | §4.5 | Phase 3 |
| Slow work dispatched as jobs, never inline | §5.4 | Phase 4 |

**What remains here is only what has a real cost**: archival, bucketed counters, Redis, read replicas, queues, search extraction, service extraction and sharding. Each is triggered by a number in §6 and reached through an interface that already exists by the end of Phase 4.

The practical consequence: **there is no scalability work to schedule.** There is a runbook (§8), a set of triggers (§6), and a monitoring list (§9). Nothing here needs building until a measurement says so.
