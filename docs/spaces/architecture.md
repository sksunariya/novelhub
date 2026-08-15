# Community Architecture — User-Created Spaces, Posts, Voting, Moderation

**Status:** Design proposal v1 — for review before implementation
**Date:** 2026-08-14
**Companion docs:** [`platform-readiness.md`](./platform-readiness.md) — legal, safety, security, accessibility and SEO requirements, with the authoritative phase plan · [`scalability.md`](./scalability.md) — capacity model, scalable database design, and the staged growth runbook · [`monetization-phase2.md`](./monetization-phase2.md) · [`monetization-architecture.md`](../monetization-architecture.md) · [`admin-portal-spec.md`](../admin-portal-spec.md)
**Scope:** A Reddit-class community system layered onto Apex NovelHub — user-created spaces, four post types, full up/down voting with karma, threaded comments, a two-tier moderation model, and total admin control expressed through the existing settings registry.

> **The community is general-purpose.** A space is about whatever its creator wants — cooking, code, a city, a game, or a novel. Nothing in the data model assumes novels. The catalogue is reachable through one optional, generic linking mechanism (§4.13) that treats a novel as one registered entity type among others, and that mechanism can be switched off entirely from the admin portal without affecting anything else.

---

## 1. Read this first — five constraints that shape everything

**1. This is a write-heavy system bolted onto a read-heavy one.**
The novel platform's hot path is "read a chapter": a few reads, almost no writes. A community's hot path is a vote — one small write per user per item, at the highest frequency of anything on the site. `Vote` will become the largest collection by row count within months, larger than `ChapterRead`. Every design decision below that looks paranoid about the vote path is paranoid on purpose.

**2. Ranked feeds cannot be computed at read time.**
Reddit's "hot" is a pure function of `(score, createdAt)`. Because it is pure, it is stored on the post and updated on write, then served by an index scan. If it were computed in an aggregation at read time, the home feed would table-scan every post in every joined community on every page load. **`hotScore` is a persisted, indexed field. This is not an optimization to add later — a feed built without it has to be rewritten, not tuned.**

**3. Offset pagination breaks on a live feed.**
`skip(40).limit(20)` on a feed where new posts arrive between requests shows duplicates and skips items, and `skip` cost grows linearly with depth. Every community feed uses **keyset (cursor) pagination** on the sort field plus `_id` as a tiebreaker.

**4. "Everything controllable from the admin portal" has an existing, correct answer here.**
`config/settingsRegistry.js` already derives validation, coercion, admin form metadata, the public projection, search indexing and audit diffs from a single declaration. Community configuration goes in `config/settings/spaces.js` and gets all of that for free. **Any community value that is hardcoded is a bug.** No new admin settings UI is written — the registry-driven `ConfigPage` renders it.

**5. Two tiers of authority, not one.**
Community moderators are users with power inside one community. Site admins have power everywhere and can override any moderator. These need separate audit trails: `ModAction` (per-community, visible to that community's mods, part of the product) and the existing `AdminAuditLog` (site-wide, immutable, compliance). Conflating them means either mods can read the site audit log or admins' actions vanish from the community's own record.

---

## 2. Design principles

| Principle | Why |
|---|---|
| **Ranking scores are persisted and indexed, never computed at read time.** | A feed is an index scan or it does not scale. |
| **Counters are denormalized; the ledger of votes is truth.** | `Post.score` is a cache. A nightly rebuild job recomputes it from `Vote`, so any drift is recoverable. |
| **Cursor pagination everywhere.** | Correctness on a live feed, and constant-cost deep paging. |
| **Every limit, weight, threshold and toggle is a registry declaration.** | Tuning a community is a settings save, never a deploy. |
| **Per-community settings are sparse overrides of global defaults.** | A community stores only what it changed. Changing a global default moves every community that never overrode it. |
| **Soft delete for content, hard rows for votes.** | Removed posts must be restorable and auditable. Votes are high-volume and disposable on delete. |
| **Admin is a superset of moderator, which is a superset of author.** | One permission resolver, checked in one place, rather than role checks scattered across controllers. |
| **Moderation is reversible and recorded.** | Every removal stores who, why, when, and the original content. |
| **Media limits are enforced at the edge from live settings.** | Multer instances are built per request from the registry, not from require-time constants. |
| **No domain assumptions in the schema.** | A space is about anything. Links to platform content go through one generic, registry-driven reference type — never a hardcoded `novel` field. |

---

## 3. Naming and URL scheme

A community is a **space**, addressed at `/c/:slug`. This avoids collision with the existing `/api/community` mount, which serves chapter comments and reviews and is left untouched.

| Surface | Path |
|---|---|
| Public API | `/api/spaces/*`, `/api/posts/*`, `/api/feed/*` |
| Admin API | `/api/admin/spaces/*`, `/api/admin/posts/*`, `/api/admin/reports/*` |
| Frontend hub | `/community` |
| A space | `/c/:slug` |
| A post | `/c/:slug/p/:postId/:titleSlug` |
| Composer | `/c/:slug/submit` |
| Mod tools (community mods) | `/c/:slug/mod` |
| User profile | `/u/:username` |

Existing chapter comments/reviews at `/api/community/*` keep working exactly as they do today. They are a different feature with a different data model and are deliberately not merged.

---

## 4. Data model

Eleven new collections, plus three small additions to `User`. All paths are `backend/src/models/`.

### 4.1 `Space.js` — a user-created community

```js
{
  slug:            String,   // unique, lowercased, immutable after creation
  name:            String,   // display name, editable
  tagline:         String,   // 120 chars, shown in search results
  description:     String,   // rich text HTML, the "about" panel
  descriptionText: String,   // stripped plain text, feeds the search index

  // Identity
  iconUrl:         String,
  bannerUrl:       String,
  theme: {                   // per-space accent, constrained to the site palette
    primary: String,         // hex, validated
    banner:  String,         // 'image' | 'gradient' | 'solid'
  },

  // Governance
  owner:           ObjectId(User),
  visibility:      String,   // 'public' | 'restricted' | 'private'
  joinPolicy:      String,   // 'open' | 'request' | 'invite'
  status:          String,   // 'pending' | 'active' | 'archived' | 'quarantined' | 'banned'
  statusReason:    String,
  nsfw:            Boolean,

  // Content policy — sparse overrides of the global registry defaults
  overrides:       Mixed,    // { 'spaces.posting.maxTitleLength': 200, ... }
  allowedPostTypes:[String], // subset of ['text','image','link','poll']
  rules: [{ order, title, description, appliesTo }],  // embedded, max 15

  // Classification — admin-curated taxonomy, not free tags
  topics:          [String],

  // Optional, generic platform link. See §4.13. Empty for most spaces.
  linkedRefs: [{ type: String, id: ObjectId, url: String, label: String }],

  // Admin levers
  featured:        Boolean,  // surfaces in Popular / discovery rails
  verified:        Boolean,  // badge
  locked:          Boolean,  // read-only, no new posts or comments
  pinnedGlobally:  Boolean,

  // Denormalized counters (rebuildable)
  memberCount:     Number,
  postCount:       Number,
  activeCount7d:   Number,
  lastPostAt:      Date,
}
```

Indexes:

```js
{ slug: 1 }                                        // unique, partial on deletedAt:null
{ status: 1, visibility: 1, memberCount: -1 }      // discovery / browse
{ featured: -1, memberCount: -1 }                  // curated rails
{ topics: 1, memberCount: -1 }                     // topic browse
{ 'linkedRefs.type': 1, 'linkedRefs.id': 1 }       // sparse — entity → its spaces
{ name: 'text', descriptionText: 'text', tagline: 'text' }  // search
```

Plugin: `softDelete`.

**Why `overrides` is a sparse `Mixed` map rather than typed fields:** it mirrors `AppSettings`. A space stores only the keys it changed; everything else resolves to the global registry default at read time. Adding a new per-space-tunable setting then costs one registry declaration and zero schema changes. Keys are validated against the registry on write, and only keys flagged `spaceOverridable: true` are accepted.

### 4.2 `SpaceMember.js` — membership and per-space authority

```js
{
  space:       ObjectId(Space),
  user:        ObjectId(User),
  role:        String,   // 'member' | 'moderator' | 'owner'
  status:      String,   // 'active' | 'pending' | 'banned' | 'muted'
  permissions: {         // granular, only meaningful for moderators
    managePosts: Boolean, manageMembers: Boolean, manageSettings: Boolean,
    manageFlair: Boolean, manageRules:  Boolean, manageMods: Boolean,
  },
  flair:       ObjectId(Flair),
  flairText:   String,
  karma:       Number,   // reputation earned inside this space
  bannedUntil: Date,     // null = permanent when status is 'banned'
  banReason:   String,
  mutedUntil:  Date,
  joinedAt:    Date,
  lastSeenAt:  Date,
}
```

Indexes:

```js
{ space: 1, user: 1 }                     // unique
{ user: 1, role: 1 }                      // "my spaces" + "spaces I moderate"
{ space: 1, role: 1, status: 1 }          // mod list, ban list, member list
{ space: 1, karma: -1 }                   // per-space leaderboard
{ user: 1, status: 1, space: 1 }          // home feed source set
```

**Why granular permissions rather than a role enum alone:** the owner of a large space wants a flair moderator who cannot ban people. A single enum forces every mod to be all-powerful, which is exactly how community moderation goes wrong.

### 4.3 `Post.js`

```js
{
  space:       ObjectId(Space),
  author:      ObjectId(User),
  type:        String,   // 'text' | 'image' | 'link' | 'poll'

  title:       String,   // required for every type
  titleSlug:   String,   // for the canonical URL
  body:        String,   // rich text HTML (TipTap), text posts
  bodyText:    String,   // stripped, for search + banned-word scanning

  media: [{              // image / gallery posts
    url, thumbUrl, mime, bytes, width, height, caption, order,
  }],

  link: {                // link posts
    url, domain, title, description, imageUrl, fetchedAt, fetchStatus,
  },

  poll: {                // poll posts
    options: [{ _id, text, votes }],
    allowMultiple: Boolean,
    endsAt: Date,
    totalVoters: Number,
    hideResultsUntilEnd: Boolean,
  },

  // Classification
  flair:       ObjectId(Flair),
  flairText:   String,
  nsfw:        Boolean,
  spoiler:     Boolean,
  linkedRefs:  [{ type, id, url, label }],   // optional, generic — see §4.13

  // State
  status:      String,   // 'published' | 'pending' | 'removed' | 'hidden'
  locked:      Boolean,  // no new comments
  pinnedInSpace:  Boolean,
  pinnedGlobally: Boolean,
  removal:     { by, byRole, reason, note, at },
  editedAt:    Date,

  // Ranking — denormalized, rebuildable, indexed
  upvotes:     Number,
  downvotes:   Number,
  score:       Number,   // upvotes - downvotes
  hotScore:    Number,
  bestScore:   Number,   // Wilson lower bound
  controversyScore: Number,
  commentCount:Number,
  viewCount:   Number,
  reportCount: Number,
  lastActivityAt: Date,
}
```

Indexes — these are the feed, and there are exactly as many as the feed needs:

```js
{ space: 1, status: 1, hotScore: -1, _id: -1 }        // space feed, hot
{ space: 1, status: 1, createdAt: -1, _id: -1 }       // space feed, new
{ space: 1, status: 1, score: -1, _id: -1 }           // space feed, top
{ space: 1, pinnedInSpace: -1, hotScore: -1 }         // pinned first
{ status: 1, hotScore: -1, _id: -1 }                  // global "all" feed
{ pinnedGlobally: -1, hotScore: -1 }                  // admin-pinned rail
{ author: 1, createdAt: -1 }                          // user profile
{ 'linkedRefs.type': 1, 'linkedRefs.id': 1, createdAt: -1 }  // sparse
{ status: 1, reportCount: -1 }                        // moderation queue
{ 'poll.endsAt': 1 }                                  // poll-closing job
{ title: 'text', bodyText: 'text' }                   // search
```

Plugin: `softDelete`. Note the distinction — `status: 'removed'` is a moderation state that stays queryable by mods and admins; `deletedAt` is the author deleting their own post. Both are recoverable, and they are not the same event.

### 4.4 `PostComment.js` — threaded comments

Deliberately a **separate model from the existing `Comment`**. Chapter comments are flat-ish, tied to a chapter, and already carry pinning, likes and the reading-gate probe index. Overloading that model with a threading path, vote aggregates and a mod-removal state would slow the reading gate's hot query for no benefit.

```js
{
  post:      ObjectId(Post),
  space:     ObjectId(Space),     // denormalized for mod queues
  author:    ObjectId(User),
  parent:    ObjectId(PostComment),  // null = top level
  ancestors: [ObjectId],          // materialized path, root → parent
  depth:     Number,
  sortPath:  String,              // for a single-query ordered tree fetch

  body:      String,              // rich text HTML
  bodyText:  String,

  status:    String,              // 'published' | 'removed' | 'hidden' | 'pending'
  removal:   { by, byRole, reason, note, at },
  editedAt:  Date,
  isPinned:  Boolean,             // mod or OP pins one reply to the top
  isOp:      Boolean,             // author === post author, denormalized for the badge

  upvotes: Number, downvotes: Number, score: Number,
  bestScore: Number, controversyScore: Number,
  replyCount: Number, reportCount: Number,
}
```

Indexes:

```js
{ post: 1, sortPath: 1 }                     // ordered tree, one query
{ post: 1, parent: 1, bestScore: -1 }        // "load more replies" under a node
{ post: 1, isPinned: -1, bestScore: -1 }     // default comment sort
{ ancestors: 1 }                             // cascade removal of a subtree
{ author: 1, createdAt: -1 }                 // profile
{ space: 1, status: 1, reportCount: -1 }     // mod queue
```

**Why both `ancestors` and `sortPath`:** `ancestors` makes "remove this comment and everything under it" a single `updateMany({ ancestors: id })`. `sortPath` — a fixed-width encoding of each ancestor's rank, e.g. `0007.0002.0011` — makes "fetch the first 200 comments of this post already in tree order" a single indexed range scan instead of N recursive queries. Deep threads are fetched lazily by `parent`.

### 4.5 `Vote.js` — the highest-volume collection

```js
{
  user:       ObjectId(User),
  targetType: String,        // 'post' | 'comment'
  target:     ObjectId,
  space:      ObjectId(Space),  // denormalized: per-space karma recompute
  value:      Number,        // 1 | -1
  createdAt:  Date,
}
```

Indexes:

```js
{ user: 1, targetType: 1, target: 1 }   // unique — one vote per user per item
{ target: 1, value: 1 }                 // counter rebuild
{ user: 1, createdAt: -1 }              // "my upvoted" + fraud detection
{ space: 1, user: 1 }                   // per-space karma rebuild
```

No `softDelete` — unvoting deletes the row. There is nothing to audit in a removed vote, and the plugin's read hook would add a filter to the single most frequent query on the site.

**Write path (one round trip, idempotent):** an `updateOne` with `upsert: true` on the unique key returns whether it inserted or matched, and the delta (`+1`, `-1`, `+2`, `-2`, or `0`) is derived from the previous value. The post counter update, the hotScore recompute and the author-karma increment are then a single `findOneAndUpdate` with `$inc` and a computed `$set`. Two writes per vote, no transaction, no read-modify-write race.

### 4.6 `Flair.js`

```js
{
  space:    ObjectId(Space),
  kind:     String,   // 'post' | 'user'
  text:     String,
  textColor: String, bgColor: String,
  modOnly:  Boolean,  // only mods can assign it
  order:    Number,
  useCount: Number,
}
```

Index: `{ space: 1, kind: 1, order: 1 }`.

### 4.7 `Report.js` — one queue for everything reportable

```js
{
  targetType: String,   // 'post' | 'comment' | 'space' | 'user'
  target:     ObjectId,
  space:      ObjectId(Space),   // null for site-level reports
  reporter:   ObjectId(User),
  reason:     String,            // key from an admin-configurable reason list
  details:    String,
  source:     String,            // 'user' | 'automod' | 'banned_word' | 'threshold'
  status:     String,            // 'open' | 'actioned' | 'dismissed' | 'escalated'
  handledBy:  ObjectId(User),
  handledAt:  Date,
  resolution: String,
  snapshot:   Mixed,             // content as it was when reported
}
```

Indexes: `{ space: 1, status: 1, createdAt: -1 }`, `{ status: 1, createdAt: -1 }`, `{ targetType: 1, target: 1 }`, `{ reporter: 1, createdAt: -1 }` (catches report-brigading).

**`snapshot` matters:** a user who reports a post, then watches the author edit it into something innocuous, must not have their report silently invalidated. The queue shows what was reported.

### 4.8 `ModAction.js` — the per-space moderation log

```js
{
  space:      ObjectId(Space),
  actor:      ObjectId(User),
  actorLabel: String,           // survives account deletion
  actorRole:  String,           // 'owner' | 'moderator' | 'admin'
  action:     String,           // 'post.remove', 'member.ban', 'space.settings', …
  targetType: String,
  target:     ObjectId,
  targetLabel:String,
  reason:     String,
  changes:    [{ key, before, after }],
}
```

Indexes: `{ space: 1, createdAt: -1 }`, `{ space: 1, action: 1, createdAt: -1 }`, `{ actor: 1, createdAt: -1 }`. Immutable, same pre-hooks as `AdminAuditLog`.

**Site-admin actions are written to both** `ModAction` (so the community can see that an admin acted in their space — opacity here is how trust dies) **and** `AdminAuditLog` (so compliance has one immutable trail).

### 4.9 `PollVote.js`

```js
{ post, user, options: [ObjectId], votedAt }
```

Index: `{ post: 1, user: 1 }` unique. Option tallies live denormalized on `Post.poll.options[].votes`.

### 4.10 `SavedItem.js`

```js
{ user, targetType, target, space, collection: String, savedAt }
```

Index: `{ user: 1, targetType: 1, target: 1 }` unique, `{ user: 1, savedAt: -1 }`.

### 4.11 `SpaceStatsDaily.js` — rollups for admin analytics

```js
{ space, date, members, joins, leaves, posts, comments, votes,
  activeUsers, reports, removals, viewCount }
```

Index: `{ space: 1, date: -1 }` unique, `{ date: -1 }`. Written by a nightly job, mirroring the existing `ChapterStatsDaily` / `rollupService` pattern. Admin charts read rollups, never raw collections.

### 4.12 Additions to `User.js`

```js
karma: {
  post:    { type: Number, default: 0 },
  comment: { type: Number, default: 0 },
  awarded: { type: Number, default: 0 },   // admin-granted
  total:   { type: Number, default: 0 },   // indexed
},
communityBannedUntil: { type: Date, default: null },  // site-wide community ban
communityBanReason:   { type: String, default: '' },

// Per-user override of the global space-creation gate. See §4.14.
spaceCreation: {
  policy: { type: String, enum: ['default', 'always', 'never'], default: 'default' },
  reason: { type: String, default: '' },
  setBy:  { type: ObjectId, ref: 'User', default: null },
  setAt:  { type: Date, default: null },
},
```

Plus `notificationPreferences`: `inAppPostReply`, `emailPostReply`, `inAppCommentReply`, `emailCommentReply`, `inAppSpaceAnnouncement`, `inAppModAction`.

Index: `{ 'karma.total': -1 }`.

A **site-wide community ban** is distinct from `User.banned`. Banning someone from the whole platform also cuts off their paid chapter access — an unreasonable penalty for being rude in one thread, and one that has a refund liability attached. A community ban is the proportionate tool.

### 4.13 Generic linked references

A space or post can optionally point at something else on the platform. Rather than a `linkedNovel` field — which would bake the novel domain into a general-purpose forum and require a schema change for every future entity — this is one polymorphic array driven by a registry of **link types**:

```js
linkedRefs: [{
  type:  String,     // key from spaces.links.enabledTypes
  id:    ObjectId,   // internal entity, when the type is internal
  url:   String,     // external target, when the type is external
  label: String,     // denormalized display text, so rendering needs no join
}]
```

Link types are declared in `backend/src/config/linkTypes.js`, one small object each:

```js
{
  key: 'novel',
  label: 'Novel',
  model: 'Novel',
  lookup: (query) => Novel.find({ title: new RegExp(query,'i') }).limit(10),
  toLabel: (doc) => doc.title,
  href:    (doc) => `/novel/${doc.slug}`,
  icon:    'BookOpen',
}
```

`novel` and `chapter` ship as the two registered types because the platform already has them. Adding another later — an author page, an event, a product — is one entry in that file and zero schema or UI changes. Which types are enabled at all is `spaces.links.enabledTypes`, a multiselect the admin controls; setting it to `[]` removes linking from the product entirely.

What this buys, concretely: a novel's detail page can show a "Discussion" tab querying `{ 'linkedRefs.type': 'novel', 'linkedRefs.id': novelId }` — but a space about cooking, or a city, or nothing in particular, carries an empty array and never touches any of it. The default state of the system is generic.

Both indexes on `linkedRefs` are **sparse**, so spaces and posts with no links cost nothing to store or maintain in them.

### 4.14 Who may create a space — resolution order

The creation gate resolves through a chain, most specific first, so an admin can override the global policy for one person without changing it for everyone:

```
User.spaceCreation.policy === 'never'   → denied, always
User.spaceCreation.policy === 'always'  → allowed, bypasses every gate below
otherwise → spaces.creation.mode:
    'open'         → any signed-in, non-banned user
    'karma_gated'  → karma, account age and verified-email thresholds
    'approval'     → allowed to submit; the space is created with status 'pending'
    'admin_only'   → denied unless the requester is a site admin
then, in every case → per-user cooldown, owned-space cap and site-wide cap
```

`communityBannedUntil` short-circuits the whole chain. One resolver, `spacePermissionService.canCreateSpace(user)`, returns `{ allowed, requiresApproval, reason }` — the `reason` string is what the UI shows, so a blocked user is told *why* rather than seeing a dead button.

---

## 5. Ranking engine

`backend/src/services/rankingService.js`. Every constant below is a registry setting, not a literal.

### 5.1 Hot

```
hot = log10(max(|score|, 1)) + sign(score) * (createdAtSeconds - EPOCH) / gravitySeconds
```

`gravitySeconds` (default `45000`, ~12.5h) is `spaces.ranking.hotGravitySeconds`. Lower it and the feed churns faster; raise it and good posts persist. This is the single most consequential dial in the product, which is precisely why it belongs in the admin portal.

Recomputed on every vote (it is arithmetic on two numbers already in hand — no extra read) and on post creation. Stored as a `Double`, indexed descending.

### 5.2 Best — Wilson score lower bound

```
n = up + down
p = up / n
best = (p + z²/2n - z * sqrt((p(1-p) + z²/4n) / n)) / (1 + z²/n)
```

`z` is `spaces.ranking.confidenceZ` (default `1.281655`, an 80% confidence interval). This is the default comment sort: it asks "given this sample, what is the worst plausible true approval rate", so a 5/0 comment does not outrank a 300/20 one.

### 5.3 Controversial

```
if up <= 0 or down <= 0: 0
balance = min(up, down) / max(up, down)
controversy = (up + down) ^ balance
```

Magnitude weighted by how evenly split it is.

### 5.4 Rising

Velocity over a short window: `score / max(ageMinutes, floor)`, restricted to posts newer than `spaces.ranking.risingWindowHours` (default 6) with at least `spaces.ranking.risingMinScore` votes. Computed at read time — the candidate set is small and bounded by the window, so it does not need a stored field.

### 5.5 Top

`score`, filtered by timeframe (`hour | day | week | month | year | all`) against the existing `{ space, status, score, _id }` index.

### 5.6 Vote weighting and abuse resistance

Three admin-tunable guards, all off by default so they can be switched on when the site is big enough to be worth gaming:

- `spaces.voting.minAccountAgeHours` — new accounts cannot vote.
- `spaces.voting.minKarmaToDownvote` — downvoting requires standing.
- `spaces.voting.perMinuteLimit` — rate limiter, via the existing `createLimiter` factory.

Self-votes are rejected server-side, not silently ignored, so the UI can say why.

---

## 6. Feed composition

`backend/src/services/feedService.js`.

| Feed | Source set | Notes |
|---|---|---|
| **Home** | Posts from the user's joined spaces | Falls back to Popular when the user has joined fewer than `spaces.feed.homeMinSpaces` |
| **Popular** | Public, non-quarantined spaces above `spaces.feed.popularMinMembers`, plus every `featured` space | The signed-out landing feed |
| **All** | Every public space | Firehose; admin can hide spaces from it with `excludeFromAll` |
| **Space** | One space | Pinned posts prepended, outside the cursor |
| **Linked entity** | Posts matching a `linkedRefs` entry | Powers a "Discussion" tab on any linkable entity's page. Sparse index; unused by spaces that link to nothing |
| **User** | Posts and comments by one author | Respects the viewer's permissions |
| **Saved** | `SavedItem` join | Private to the user |

**Home feed query shape.** The user's space list comes from `SpaceMember` (indexed `{ user, status, space }`) and is cached on the request. The feed itself is then one query:

```js
Post.find({
  space: { $in: spaceIds },
  status: 'published',
  ...cursorClause,          // { hotScore: { $lt: c.hotScore } } OR tie-break on _id
})
.sort({ hotScore: -1, _id: -1 })
.limit(limit + 1)           // +1 to detect "hasMore" without a count
```

This is an index scan on `{ space, status, hotScore, _id }`. No aggregation, no `$lookup`, no `skip`. Author and space display data are hydrated with two batched `find({_id: {$in: […]}})` calls on lean projections, not per-row `populate`.

**Cursor encoding:** base64 of `{ v: sortValue, id: lastId }`, opaque to the client, validated server-side. Changing the sort resets the cursor.

**Viewer state** (did I vote on this, did I save it) is a single `Vote.find({ user, target: { $in: postIds } })` merged into the response — never a per-post query.

---

## 7. API surface

### 7.1 Public — `/api/spaces`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/spaces` | optional | Browse/search, filters: topic, sort, visibility |
| `POST` | `/api/spaces` | user | Gated by karma/age/verification settings; may land in `pending` |
| `GET` | `/api/spaces/:slug` | optional | 404s private spaces to non-members |
| `PATCH` | `/api/spaces/:slug` | mod:manageSettings | Only registry-declared `spaceOverridable` keys |
| `POST` | `/api/spaces/:slug/icon` \| `/banner` | mod:manageSettings | Dynamic multer, live size caps |
| `POST` | `/api/spaces/:slug/join` \| `/leave` | user | Honours `joinPolicy` |
| `GET` | `/api/spaces/:slug/members` | mod / public per visibility | Cursor-paginated |
| `PATCH` | `/api/spaces/:slug/members/:userId` | mod:manageMembers | Role, flair, ban, mute |
| `GET/POST/PATCH/DELETE` | `/api/spaces/:slug/rules` | mod:manageRules | |
| `GET/POST/PATCH/DELETE` | `/api/spaces/:slug/flairs` | mod:manageFlair | |
| `GET` | `/api/spaces/:slug/modlog` | mod (public if space opts in) | |
| `GET` | `/api/spaces/:slug/queue` | mod:managePosts | Reported + pending items |

### 7.2 Public — `/api/posts` and `/api/feed`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/feed/:type` | optional | `home\|popular\|all`, `?sort=&t=&cursor=&limit=` |
| `GET` | `/api/spaces/:slug/posts` | optional | Same params |
| `POST` | `/api/posts` | user | Type-specific validation; content guard runs here |
| `GET` | `/api/posts/:id` | optional | Increments view via existing `viewTracking` dedup |
| `PATCH` | `/api/posts/:id` | author within edit window, or mod | Title immutable after `spaces.posting.titleLockMinutes` |
| `DELETE` | `/api/posts/:id` | author or mod | Soft delete |
| `POST` | `/api/posts/:id/vote` | user | `{ value: 1 \| -1 \| 0 }`, idempotent |
| `POST` | `/api/posts/:id/save` \| `/unsave` | user | |
| `POST` | `/api/posts/:id/report` | user | |
| `POST` | `/api/posts/:id/poll-vote` | user | Rejected after `endsAt` |
| `POST` | `/api/posts/:id/lock` \| `/pin` \| `/nsfw` \| `/spoiler` \| `/flair` | mod:managePosts | |
| `POST` | `/api/posts/:id/remove` \| `/approve` \| `/restore` | mod:managePosts | Reason required, writes `ModAction` |
| `POST` | `/api/posts/:id/move` | admin | Reassign to another space |

### 7.3 Public — comments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/posts/:id/comments` | `?sort=best\|top\|new\|controversial\|old&cursor=`; returns a flat array with `depth` + `sortPath`, the client assembles the tree |
| `GET` | `/api/comments/:id/replies` | Lazy expansion below the initial depth cap |
| `POST` | `/api/posts/:id/comments` | `{ body, parent }` |
| `PATCH`/`DELETE` | `/api/comments/:id` | Author within edit window, or mod |
| `POST` | `/api/comments/:id/vote` \| `/report` \| `/pin` \| `/remove` \| `/restore` | As above |

### 7.4 Media

`POST /api/uploads/community-image` — accepts one image, enforces live size/type/dimension caps, returns `{ url, thumbUrl, width, height, bytes }`. Backed by the existing `storage.js` public tier, so S3 or the local fallback both work with no new configuration.

### 7.5 Admin — `/api/admin/*`

Mounted under the existing `router.use(protect, adminOnly)` in `adminRoutes.js`. **Every moderator capability above also exists here without the membership requirement**, plus:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/spaces` | Every space including private, pending, banned |
| `POST` | `/api/admin/spaces` | Create on any user's behalf |
| `PATCH` | `/api/admin/spaces/:id` | **Any** field, including keys not `spaceOverridable` |
| `POST` | `/api/admin/spaces/:id/approve` \| `/quarantine` \| `/archive` \| `/ban` \| `/restore` | Lifecycle |
| `POST` | `/api/admin/spaces/:id/transfer` | Reassign ownership |
| `POST` | `/api/admin/spaces/:id/mods` | Install or remove any moderator |
| `POST` | `/api/admin/spaces/:id/recount` | Rebuild counters from source |
| `GET` | `/api/admin/posts` | Cross-site: filter by space, author, type, status, score, report count, date |
| `POST` | `/api/admin/posts/bulk` | Bulk remove / restore / lock / pin / move / reflair |
| `GET` | `/api/admin/reports` | Global queue with the same filters |
| `POST` | `/api/admin/reports/bulk` | Bulk action + resolution note |
| `GET` | `/api/admin/community/users/:id` | Full history: posts, comments, votes, reports filed and received, bans |
| `POST` | `/api/admin/community/users/:id/ban` \| `/unban` \| `/karma` | Site-wide community ban; manual karma adjustment |
| `GET` | `/api/admin/community/analytics` | Rollup-backed charts |
| `GET` | `/api/admin/community/modlog` | Every `ModAction` across every space |
| `POST` | `/api/admin/community/rebuild` | Recompute scores, karma and counters |

### 7.6 Permission resolution

One resolver, `backend/src/services/spacePermissionService.js`:

```js
resolve(user, space, membership) -> {
  isAdmin, isOwner, isModerator, isMember, isBanned, isMuted,
  can: {
    view, post, comment, vote, managePosts, manageMembers,
    manageSettings, manageFlair, manageRules, manageMods, viewModlog,
  }
}
```

Controllers call `resolve` once and check a boolean. Site admin short-circuits every `can.*` to `true`. This is the only place role logic lives.

---

## 8. Moderation

### 8.1 Automated pre-publish guard

`backend/src/services/communityGuardService.js`, extending the pattern already established by `contentGuardService`. Runs on every post and comment before it is saved:

1. **Rate limits** — posts/hour, comments/hour, per user, per space.
2. **Account gates** — minimum age, minimum karma, email verified.
3. **Banned words** — reuses the existing `community.bannedWords` list plus a new per-space list; action is `block | flag | hide`, exactly as the existing setting already defines.
4. **Link policy** — block links entirely, allowlist domains, or require minimum karma to post links.
5. **Duplicate detection** — same URL in the same space within `spaces.moderation.duplicateWindowHours`.
6. **Media validation** — count, per-file bytes, total bytes, mime, dimensions.
7. **New-user approval queue** — first `N` posts land in `pending` when the space enables it.

Any trip either rejects with a specific reason, or publishes with an auto-generated `Report` of `source: 'automod'`.

### 8.2 Threshold auto-hide

`Post.reportCount >= spaces.moderation.autoHideReports` flips `status` to `hidden` and escalates the report. Already precedented by the existing `reports before auto-hiding` setting for comments.

### 8.3 Removal semantics

Removing a post soft-hides it from feeds but keeps it reachable by direct link for the author and mods, with a removal banner — matching Reddit, and avoiding the "my post vanished with no explanation" failure mode. Removing a comment with replies keeps the subtree and replaces the body with a tombstone; the `ancestors` index makes cascading a single query when a full subtree removal is chosen instead.

### 8.4 Reason taxonomy

`spaces.moderation.reportReasons` is a registry `json` setting — an array of `{ key, label, appliesTo, severity }`. Admins edit the list without a deploy; the client renders the report modal from it; the moderation queue groups by it.

---

## 9. Settings registry — `backend/src/config/settings/spaces.js`

Wiring: three lines in `settingsRegistry.js` (`require`, spread into `SECTIONS`, spread into `DECLARATIONS`) and one new tab group in `frontend/src/admin/settings/sections.js`. Nothing else. The existing `ConfigPage`, search, audit diff and impact preview pick it up automatically.

**Why the namespace is `spaces.*` and not `community.*`.** Nine `community.*` keys already exist and govern chapter comments and reviews — including `community.bannedWords`, `community.bannedWordAction` and `community.reportsToAutoHide`. Putting the new settings under the same prefix would give the admin portal's settings search two near-identically-named results for "banned words" controlling different subsystems, which is a real usability failure in a surface this size. `spaces.*` matches the `Space` model and the `/api/spaces` mount, and needs no migration of existing stored overrides. Renaming the nine legacy keys to `chapterComments.*` is a worthwhile future cleanup, but it is a breaking rename with a data migration and does not belong in this project.

New sections:

```js
const SECTIONS = {
  CORE:       'spaces.core',
  CREATION:   'spaces.creation',
  POSTING:    'spaces.posting',
  MEDIA:      'spaces.media',
  VOTING:     'spaces.voting',
  RANKING:    'spaces.ranking',
  MODERATION: 'spaces.moderation',
  FEED:       'spaces.feed',
  KARMA:      'spaces.karma',
};
```

### 9.1 Core

| Key | Type | Default | Purpose |
|---|---|---|---|
| `spaces.enabled` | boolean | `false` | Master kill switch. Off = routes 404, nav hidden. Ship dark. |
| `spaces.publicBrowsing` | boolean | `true` | Can signed-out visitors read? |
| `spaces.entryPoint` | enum | `nav` | `nav \| footer \| hidden` |
| `spaces.defaultLandingFeed` | enum | `popular` | `home \| popular \| all` |
| `spaces.core.topics` | json | Seeded list of `{ key, label, order }` | The browse taxonomy. Fully generic — admin defines the categories |
| `spaces.links.enabledTypes` | multiselect | `['novel','chapter']` | Which entity types can be linked. `[]` removes linking entirely |
| `spaces.links.maxPerPost` | integer | `3` | |
| `spaces.links.showDiscussionTab` | boolean | `true` | Render the Discussion tab on linked entities' pages |

### 9.2 Creation

| Key | Type | Default | Purpose |
|---|---|---|---|
| `spaces.creation.mode` | enum | `karma_gated` | `open \| karma_gated \| approval \| admin_only`. Switchable at any time; per-user overrides always win (§4.14) |
| `spaces.creation.minKarma` | integer | `50` | |
| `spaces.creation.minAccountAgeHours` | integer | `72` | |
| `spaces.creation.requireVerifiedEmail` | boolean | `true` | |
| `spaces.creation.maxPerUser` | integer | `3` | Owned spaces per user |
| `spaces.creation.maxTotalSpaces` | integer | `0` | Site-wide cap, 0 = unlimited |
| `spaces.creation.slugMinLength` / `slugMaxLength` | integer | `3` / `24` | |
| `spaces.creation.reservedSlugs` | multiselect | `['admin','api','mod','help','about','store','novel']` | |
| `spaces.creation.defaultVisibility` | enum | `public` | |
| `spaces.creation.allowNsfwSpaces` | boolean | `false` | |
| `spaces.creation.cooldownHours` | integer | `24` | Between creations by one user |
| `spaces.creation.autoApproveAboveKarma` | integer | `0` | In `approval` mode, skip the queue above this karma. 0 = never |
| `spaces.creation.pendingExpiryDays` | integer | `14` | Unreviewed requests auto-reject, so the queue cannot rot |

### 9.3 Posting

| Key | Type | Default |
|---|---|---|
| `spaces.posting.allowedTypes` | multiselect | `['text','image','link','poll']` |
| `spaces.posting.minTitleLength` / `maxTitleLength` | integer | `3` / `300` |
| `spaces.posting.maxBodyLength` | integer | `40000` |
| `spaces.posting.maxCommentLength` | integer | `10000` |
| `spaces.posting.editWindowMinutes` | integer | `0` (unlimited) |
| `spaces.posting.titleLockMinutes` | integer | `5` |
| `spaces.posting.deleteWindowMinutes` | integer | `0` |
| `spaces.posting.maxCommentDepth` | integer | `10` |
| `spaces.posting.initialCommentDepth` | integer | `4` — how deep the first payload goes |
| `spaces.posting.postsPerHour` / `commentsPerHour` | integer | `10` / `60` |
| `spaces.posting.minAccountAgeHours` | integer | `0` |
| `spaces.posting.minKarmaToPost` / `ToComment` | integer | `0` / `0` |
| `spaces.posting.allowLinksInPosts` | boolean | `true` |
| `spaces.posting.linkDomainAllowlist` | multiselect | `[]` (empty = all) |
| `spaces.posting.linkDomainBlocklist` | multiselect | `[]` |
| `spaces.posting.fetchLinkPreviews` | boolean | `true` |
| `spaces.posting.linkPreviewTimeoutMs` | integer | `4000` |
| `spaces.posting.maxPollOptions` | integer | `6` |
| `spaces.posting.maxPollDurationDays` | integer | `7` |
| `spaces.posting.requireFlair` | boolean | `false` |

### 9.4 Media — explicitly admin-capped, as requested

| Key | Type | Default | Purpose |
|---|---|---|---|
| `spaces.media.enabled` | boolean | `true` | Master switch for uploads |
| `spaces.media.maxImageBytes` | integer | `5242880` | **Per file.** Enforced by a per-request multer instance |
| `spaces.media.maxGifBytes` | integer | `10485760` | GIFs get their own cap |
| `spaces.media.maxImagesPerPost` | integer | `10` | Gallery size |
| `spaces.media.maxTotalPostBytes` | integer | `26214400` | Sum across one post |
| `spaces.media.maxDailyBytesPerUser` | integer | `104857600` | Storage-cost brake |
| `spaces.media.allowedMimeTypes` | multiselect | `['image/jpeg','image/png','image/webp','image/gif']` | SVG excluded — it executes script |
| `spaces.media.maxImageWidth` / `maxImageHeight` | integer | `4096` / `4096` | Rejects decompression bombs |
| `spaces.media.stripExif` | boolean | `true` | Removes GPS from user photos |
| `spaces.media.generateThumbnails` | boolean | `true` | |
| `spaces.media.thumbnailWidth` | integer | `640` | |
| `spaces.media.allowInlineEditorImages` | boolean | `true` | Images inside a text post body |
| `spaces.media.avatarMaxBytes` / `iconMaxBytes` / `bannerMaxBytes` | integer | `2097152` / `1048576` / `5242880` | |

**Enforcement note.** `middlewares/upload.js` builds its multer instances at require time from `UPLOAD_LIMITS` constants, so changing a limit today needs a restart. Community uploads get `middlewares/dynamicUpload.js`: a middleware that reads the snapshot, constructs multer with those limits, and runs it — so a size cap changed in the admin portal applies to the very next upload. Dimension and total-bytes checks run post-multer in the controller, where the buffer is already in hand.

### 9.5 Voting

| Key | Type | Default |
|---|---|---|
| `spaces.voting.enabled` | boolean | `true` |
| `spaces.voting.allowDownvotes` | boolean | `true` |
| `spaces.voting.showScoreBeforeHours` | integer | `0` — hide scores on new posts to reduce bandwagoning |
| `spaces.voting.minAccountAgeHours` | integer | `0` |
| `spaces.voting.minKarmaToDownvote` | integer | `0` |
| `spaces.voting.perMinuteLimit` | integer | `60` |
| `spaces.voting.allowVoteChange` | boolean | `true` |
| `spaces.voting.hideDownvoteCount` | boolean | `true` — show net score only |

### 9.6 Ranking

| Key | Type | Default |
|---|---|---|
| `spaces.ranking.defaultSort` | enum | `hot` |
| `spaces.ranking.defaultCommentSort` | enum | `best` |
| `spaces.ranking.hotGravitySeconds` | integer | `45000` |
| `spaces.ranking.confidenceZ` | number | `1.281655` |
| `spaces.ranking.risingWindowHours` | integer | `6` |
| `spaces.ranking.risingMinScore` | integer | `5` |
| `spaces.ranking.pinnedSlots` | integer | `3` |
| `spaces.ranking.rescoreCron` | cron | `0 */6 * * *` |
| `spaces.ranking.feedWeights` | json | `{ score: 1, comments: 0.5, recency: 1, spaceAffinity: 0.3 }` — `requiresConfirmation: true` |

### 9.7 Moderation

| Key | Type | Default |
|---|---|---|
| `spaces.moderation.autoHideReports` | integer | `5` |
| `spaces.moderation.reportReasons` | json | Seeded list of `{ key, label, appliesTo, severity }` |
| `spaces.moderation.bannedWords` | multiselect | `[]` (max 2000) |
| `spaces.moderation.bannedWordAction` | enum | `flag` |
| `spaces.moderation.newUserApprovalPosts` | integer | `0` |
| `spaces.moderation.duplicateWindowHours` | integer | `24` |
| `spaces.moderation.maxModsPerSpace` | integer | `20` |
| `spaces.moderation.maxRulesPerSpace` | integer | `15` |
| `spaces.moderation.publicModlogDefault` | boolean | `false` |
| `spaces.moderation.removalReasonRequired` | boolean | `true` |
| `spaces.moderation.notifyOnRemoval` | boolean | `true` |
| `spaces.moderation.maxReportsPerUserPerDay` | integer | `20` |
| `spaces.moderation.shadowbanEnabled` | boolean | `false` |

### 9.8 Feed and karma

| Key | Type | Default |
|---|---|---|
| `spaces.feed.pageSize` / `maxPageSize` | integer | `25` / `100` |
| `spaces.feed.homeMinSpaces` | integer | `3` |
| `spaces.feed.popularMinMembers` | integer | `10` |
| `spaces.feed.showNsfwByDefault` | boolean | `false` |
| `spaces.feed.infiniteScroll` | boolean | `true` |
| `spaces.feed.defaultDensity` | enum | `card` (`card \| compact \| classic`) |
| `spaces.karma.enabled` | boolean | `true` |
| `spaces.karma.postUpvoteValue` / `commentUpvoteValue` | number | `1` / `1` |
| `spaces.karma.downvotePenalty` | number | `1` |
| `spaces.karma.perPostCap` | integer | `0` (uncapped) |
| `spaces.karma.showOnProfile` / `ShowOnPost` | boolean | `true` / `true` |
| `spaces.karma.recomputeCron` | cron | `30 3 * * *` |
| `spaces.analytics.rollupCron` | cron | `15 2 * * *` |
| `spaces.analytics.retainRawDays` | integer | `90` |

Roughly **95 declarations**. Every one is searchable, audited, resettable to default, and rendered without writing a form.

### 9.9 Which settings a space owner may override

Declarations carry a new optional flag, `spaceOverridable: true`. `Space.overrides` accepts only those keys, validated through `registry.coerceAndValidate`. This needs one line added to `registry.describe()` — `spaceOverridable: Boolean(def.spaceOverridable)` — so the admin UI and the space settings page can tell which keys an owner may touch. It is the only change required to an existing settings file. Resolution order for any community value:

```
space override → global registry value (env → stored → default)
```

`spacePermissionService` exposes `spaceSettings(space)` returning a resolved reader with the same `get(key)` shape as `settingsService.snapshot()`, so controllers read one interface regardless of where the value came from. Admins can set any key on a space, overridable or not, via the admin endpoint.

---

## 10. Admin portal

### 10.1 Navigation

`AdminLayout.jsx` gains a **Community** group (the existing group of that name is renamed **People** to avoid ambiguity):

```
Community
  ├─ Spaces           /admin/spaces
  ├─ Requests         /admin/spaces/requests     (badge = pending count)
  ├─ Posts            /admin/community/posts
  ├─ Reports          /admin/community/reports
  ├─ Mod log          /admin/community/modlog
  └─ Insights         /admin/community/insights
People
  ├─ Users            /admin/users
  ├─ Moderation       /admin/moderation      (existing: chapter comments/reviews)
  └─ Notifications    /admin/notifications
```

### 10.2 `SpacesAdmin.jsx` — the space registry

Table: icon, name, slug, owner, members, posts/7d, status, visibility, flags, created. Filters on status, visibility, topic, NSFW, flags, size, activity. Search across name/slug/description.

Row actions: view, edit, approve, feature, verify, quarantine, archive, ban, restore, transfer ownership, recount, delete. Bulk selection with a confirmation dialog that names the affected spaces. Every action prompts for a reason and writes both `ModAction` and `AdminAuditLog`.

Header actions: **Create space** (on any user's behalf) and **Export CSV**.

**`SpaceRequestsAdmin.jsx`** — the approval queue, live only when `spaces.creation.mode` is `approval`. Each row shows the requested slug and name, the requester with their karma, account age and prior moderation history, and the stated purpose. Approve, reject with a reason (the requester is notified either way), or approve-and-grant so that user bypasses the queue in future. Requests older than `spaces.creation.pendingExpiryDays` auto-reject, so an unattended queue degrades gracefully instead of leaving people waiting indefinitely.

### 10.3 `SpaceDetailAdmin.jsx` — one space, seven tabs

| Tab | Contents |
|---|---|
| **Overview** | Stats cards, 30-day sparklines, recent mod actions, danger zone |
| **Settings** | Every `spaceOverridable` key, rendered by the existing `SettingField` component; each row shows whether it is overridden or inheriting, with a one-click revert to global. Admins additionally see a "force" panel for non-overridable keys |
| **Members** | Search, filter by role/status, promote, demote, edit granular permissions, ban with duration and reason, mute, assign flair |
| **Posts** | The space's posts with inline moderation |
| **Rules** | Reorder, edit, add, delete |
| **Flairs** | Post and user flair editors with live colour preview |
| **Mod log** | This space's `ModAction` stream |

### 10.4 `CommunityPostsAdmin.jsx` — every post on the site

Filters: space, author, type, status, flair, NSFW/spoiler, score range, report count, comment count, date range, has-media, linked entity. Sorts on any of them. Density toggle between table and preview.

Bulk actions: remove, restore, approve, lock, unlock, pin, unpin, mark NSFW/spoiler, change flair, **move to another space**, delete. Each writes an audit entry with the full selection.

Inline: expand a post to read its body, media and comment tree without leaving the page; jump to the live post.

### 10.5 `CommunityReportsAdmin.jsx` — the global queue

Left rail groups by reason and severity, with counts. Centre shows the reported content **as it was when reported** (`Report.snapshot`) beside its current state, so an edit-after-report is visible. Right rail shows the author's history: karma, prior removals, prior bans, reports filed against them, reports they have filed (surfacing report-brigading).

Actions: remove content, approve and dismiss, ban from space, ban site-wide from community, warn (sends a notification), escalate, dismiss and mark the reporter as abusive. Keyboard shortcuts for triage throughput (`a` approve, `r` remove, `d` dismiss, `j`/`k` navigate).

### 10.6 `CommunityModlogAdmin.jsx`

Every `ModAction` across every space, filterable by space, actor, action type, target type, date. This is how an admin finds a moderator abusing their space — no other view answers that question.

### 10.7 `CommunityInsights.jsx`

Reads `SpaceStatsDaily` rollups only. Charts: space growth, new spaces per week, posts and comments per day, votes per day, DAU in community vs. the reader base, top spaces by growth/engagement/reports, moderation throughput (reports opened vs. resolved, median time to resolution), the karma distribution curve, and a retention cohort for "joined a space → still posting in 30 days". Added as a tab inside the existing `AnalyticsAdmin` shell so the chart primitives and date-range control are reused.

### 10.8 `UsersAdmin.jsx` additions

A **Community** tab on the existing user detail: karma breakdown with manual adjustment, spaces joined, spaces owned, spaces moderated, posts, comments, reports filed and received, ban history, and site-wide community ban/unban with duration and reason.

Plus a **space-creation control** row implementing §4.14: a three-way selector (`Follow global policy` / `Always allow` / `Never allow`) with a required reason. This is how an admin grants creation rights to a trusted user while the global mode is `admin_only`, or revokes them from one abuser without tightening the gate on everyone. Both directions write to `AdminAuditLog`.

### 10.9 Config additions

One new tab in `frontend/src/admin/settings/sections.js`:

```js
{
  id: 'community',
  label: 'Community',
  groups: [
    { section: 'spaces.core',       title: 'Core' },
    { section: 'spaces.creation',   title: 'Space creation' },
    { section: 'spaces.posting',    title: 'Posting and comments' },
    { section: 'spaces.media',      title: 'Media and uploads' },
    { section: 'spaces.voting',     title: 'Voting' },
    { section: 'spaces.ranking',    title: 'Ranking and sorting' },
    { section: 'spaces.moderation', title: 'Moderation and safety' },
    { section: 'spaces.feed',       title: 'Feeds' },
    { section: 'spaces.karma',      title: 'Karma' },
  ],
}
```

The existing `platform.community` section (chapter comments and reviews) is renamed in the UI to "Chapter comments and reviews" and stays where it is.

### 10.10 The admin-control checklist

Every one of these is reachable from the portal, which is what "every single thing controllable" resolves to concretely:

- Turn the entire community off, or hide it from navigation, without a deploy
- Decide who may create a space — open, karma-gated, approval queue or admin-only — and switch between those at any time
- Grant or revoke space-creation rights for one individual, independent of the global policy
- Approve or reject each space request, with the requester's full history in view
- Define the topic taxonomy the directory is browsed by
- Choose which entity types can be linked from a post or space, or disable linking entirely
- Create, edit, rename, retheme, transfer, archive, quarantine, ban or delete any space
- Override any setting on any space, including ones its owner cannot touch
- Install or remove any moderator, and set each one's granular permissions
- Read, edit, remove, restore, lock, pin, reflair or relocate any post or comment on the site
- Ban any user from one space or from the whole community, with an expiry
- Adjust any user's karma, and audit where it came from
- Tune every ranking weight, gravity constant, sort default and feed rule
- Set every size, count, rate and length limit — including all media caps
- Edit the banned-word list, the link policy and the report reason taxonomy
- Read every moderator action taken by anyone, anywhere
- Rebuild every denormalized counter and score from source
- See who did what, when, before and after — permanently

---

## 11. Frontend architecture

### 11.1 Routes

Added to `App.jsx`, all lazy-loaded so a reader who never opens the community pays nothing for it — the same reasoning already applied to the PayPal SDK.

```
/community                        Feed hub (Home | Popular | All)
/community/spaces                 Directory + search
/community/create                 Space creation wizard
/community/submit                 Composer with space picker
/c/:slug                          Space feed
/c/:slug/about                    Rules, mods, stats
/c/:slug/submit                   Composer, space preselected
/c/:slug/p/:postId/:titleSlug     Post detail
/c/:slug/mod                      Moderator tools (community mods, not admins)
/u/:username                      Profile: overview, posts, comments, karma
/community/saved                  Saved items
```

### 11.2 Component tree

```
components/community/
  PostCard/            Card | Compact | Classic renderers behind one API
  VoteControl          Optimistic, rolls back on error, respects hidden-score window
  PostMedia            Gallery, lightbox, blur-until-click for NSFW/spoiler
  LinkPreview          Domain chip, thumbnail, safe external target
  PollWidget           Vote, live results bar, countdown, closed state
  CommentTree          Recursive, collapsible, continuation threads
  CommentNode          Vote rail, byline, OP/mod badges, actions
  CommentComposer      TipTap, reused from the chapter comment editor
  PostComposer         Type tabs, drag-drop upload with live limit feedback
  SpaceHeader          Banner, icon, join button, member count
  SpaceSidebar         Description, rules, mods, related spaces
  SortBar              Sticky, sort + timeframe + density
  FlairPill            Colour-aware, contrast-checked
  ReportModal          Reasons rendered from the registry setting
  ModActionMenu        Shown only when the resolver grants the permission
  SpaceCard            Directory and search results
  KarmaBadge
  FeedSkeleton         Layout-stable loading state
```

### 11.3 State

- `CommunityContext` — joined spaces, per-space permission cache, feed preferences (sort, density, NSFW), persisted per user.
- Feed pages held in a cursor-keyed map so navigating into a post and back restores scroll position and does not refetch.
- Votes are optimistic against a local delta layer merged over server state; a failure rolls back and surfaces the reason.
- No global store library — this matches the existing `AuthContext` / `SettingsContext` / `MonetizationContext` pattern already in the codebase.

### 11.4 UI direction

Built on the existing dark-gothic tokens (`night`, `crimson`, `silver`, `line`, Cinzel display face) so the community reads as part of Apex NovelHub rather than a bolted-on forum. On top of that:

- **Layered surfaces.** `night` → `night-surface` → `night-raised` with hairline `line` borders and the existing `shadow-card`, rather than boxes-inside-boxes.
- **A single crimson accent per view.** Vote state, active tab and primary action. Everything else is silver. Restraint is what makes it read as modern.
- **Per-space accent theming.** A space's `theme.primary` overrides `--color-primary` within its own routes only, so each community feels distinct without fragmenting the site.
- **Motion with intent.** `framer-motion` (already a dependency): vote springs, comment collapse height animation, skeleton→content crossfade, page transitions via the existing `PageTransition`. No decorative animation on scroll.
- **Density is the user's choice.** Card, compact and classic. Power users get compact; newcomers get cards.
- **Keyboard-first.** `j`/`k` navigate, `Enter` open, `u`/`d` vote, `c` comment, `s` save, `?` help. This is the single strongest signal of a serious community product.
- **Layout-stable loading.** Skeletons match final dimensions exactly — no cumulative layout shift.
- **Mobile is a first-class layout, not a reflow.** Bottom sheet composer, swipe-to-vote, sticky sort bar, one-handed reach for the primary action.
- **Accessible by construction.** Vote controls are real buttons with `aria-pressed`, the comment tree is a `tree` role with arrow-key traversal, focus is visible and trapped in modals, contrast is checked against the palette including custom space accents.

---

## 12. Notifications, jobs and search

**Notifications** reuse `notificationService.dispatchNotification` with new `NOTIFICATION_TYPES`: `POST_REPLY`, `COMMENT_REPLY`, `POST_MENTION`, `SPACE_INVITE`, `SPACE_JOIN_REQUEST`, `MOD_ACTION`, `SPACE_ANNOUNCEMENT`, `POST_MILESTONE`. Each gets an in-app/email default in the existing channel matrix and a per-user preference toggle. Reply notifications are batched — ten replies in a minute is one notification, not ten.

**Jobs** added to `jobs/index.js`, each with its own admin-editable schedule key, following the existing pattern exactly:

| Job | Schedule key | Purpose |
|---|---|---|
| `community.rescore` | `spaces.ranking.rescoreCron` | Recompute `hotScore` for active posts so time decay advances without a vote |
| `community.karmaRecompute` | `spaces.karma.recomputeCron` | Rebuild karma from `Vote`, correcting any drift |
| `community.rollup` | `spaces.analytics.rollupCron` | Write `SpaceStatsDaily` |
| `community.closePolls` | `*/5 * * * *` | Finalize polls past `endsAt` |
| `community.expireBans` | `0 * * * *` | Lift `bannedUntil` / `mutedUntil` |
| `community.linkPreviews` | `*/10 * * * *` | Retry failed preview fetches |
| `community.recount` | manual trigger | Rebuild every denormalized counter |

**Search** starts as MongoDB text indexes on `Space` and `Post` — adequate to roughly the low hundreds of thousands of posts and requiring no new infrastructure. The query path is isolated behind `searchService.searchCommunity()` so swapping in Atlas Search or Meilisearch later is one file.

---

## 13. Implementation phases

Each phase is independently shippable and leaves the app working. `spaces.enabled` defaults to `false`, so phases 1–6 can ship to production dark and be exercised by admins before anyone sees them.

| Phase | Deliverable | Backend | Frontend |
|---|---|---|---|
| **0** | Foundations | `config/settings/spaces.js`, registry wiring, new constants (roles, statuses, post types, notification types, and `'post'` added to `VIEW_TARGET_TYPES` so post views reuse `ViewEvent`), `dynamicUpload.js`, `models/index.js` registration, `scripts/syncIndexes.js` run | Config tab entry |
| **1** | Spaces and membership | `Space`, `SpaceMember`, `Flair`, `spacePermissionService` (including `canCreateSpace` and the approval queue), `config/linkTypes.js`, space CRUD, join/leave, rules, flairs | — |
| **2** | Posts, votes, feeds | `Post`, `Vote`, `rankingService`, `feedService`, post CRUD, vote endpoint, cursor pagination | — |
| **3** | Comments | `PostComment`, threaded fetch, lazy replies, comment votes | — |
| **4** | Rich content | Media upload + limits, link preview fetcher, `PollVote`, poll lifecycle | — |
| **5** | Moderation | `Report`, `ModAction`, `communityGuardService`, mod endpoints, auto-hide, bans | — |
| **6** | Admin portal | Admin controllers and routes | `SpacesAdmin`, `SpaceDetailAdmin`, `CommunityPostsAdmin`, `CommunityReportsAdmin`, `CommunityModlogAdmin` |
| **7** | Public UI | — | Feed hub, space page, post detail, composer, comment tree, profiles, mod tools |
| **8** | Polish and scale | Notifications, karma, jobs, search, rollups, `CommunityInsights` | Keyboard shortcuts, density modes, mobile refinement |
| **9** | Hardening | Jest + Supertest suites, load test on the vote and feed paths, index verification, rebuild-job validation | Accessibility audit |

Phases 6 and 7 can run in parallel once 1–5 are merged; they share no files.

> **This table is superseded.** The authoritative, per-phase plan is [`implementation-plan/`](./implementation-plan/); the summary it expands on is [`platform-readiness.md`](./platform-readiness.md) §13. That version inserts the legal, safety, security, accessibility, SEO and scalability work into these same phases and adds a Phase 10 for compliance. Items marked BLOCKING must ship with their phase — most urgently the SSRF hardening on the link preview fetcher (Phase 4) and perceptual-hash CSAM scanning before any user-uploaded image goes live. Items marked SCALE come from [`scalability.md`](./scalability.md) and add no infrastructure; they are interfaces and schema fields that are free now and expensive to retrofit.

---

## 14. Testing

Following the existing `backend/tests` conventions (Jest, Supertest, `mongodb-memory-server`):

- **Permission matrix** — the resolver is table-tested across every role × action × space-state combination. This is the highest-value test in the system; a gap here is a security hole.
- **Vote idempotency** — double-submit, rapid flip, self-vote, concurrent votes on one post converge to correct counters.
- **Ranking** — `hotScore`, Wilson and controversy checked against known reference values.
- **Feed correctness** — cursor pagination returns every item exactly once while new posts are inserted mid-page.
- **Guards** — every automod rule and every media cap, including the boundary at exactly the limit.
- **Settings** — every declaration's default validates (already enforced at require time by the registry), and `spaceOverridable` rejects non-overridable keys.
- **Moderation** — removal, restore, cascade to a subtree, and the audit trail written for each.
- **Counter rebuild** — deliberately corrupt counters, run the rebuild job, assert convergence.

Load targets to validate before launch: feed page under 100ms at 1M posts, vote round trip under 50ms, post detail with 500 comments under 200ms.

---

## 15. Risks and how each is contained

| Risk | Containment |
|---|---|
| Vote volume overwhelms the primary | Two writes per vote, no transactions, no read-modify-write. If it still bites, votes move to a queue with batched counter flushes — the write path is already isolated in one service |
| Counter drift | Nightly rebuild job plus an on-demand admin trigger; `Vote` is truth |
| A space becomes a moderation liability | Quarantine (hidden from all feeds, direct link only, interstitial warning) before the blunter ban |
| Moderator abuse | Granular permissions, full mod log visible to admins, admin override of any action |
| Brigading and vote manipulation | Account-age and karma gates, vote rate limits, `Vote` retains `createdAt` and `user` for pattern analysis |
| Media storage cost | Per-file, per-post and per-user-per-day byte caps, all admin-tunable at runtime |
| Empty-directory launch | Admin seeds the first spaces via the portal before flipping `spaces.enabled`, and `spaces.core.topics` gives the directory structure from day one. `admin_only` creation mode is the launch setting; loosen once there is culture to imitate |
| A general forum drifts from the platform's purpose | This is acceptable and intended — it is a general community. The optional `linkedRefs` mechanism means novel discussion still routes back to the catalogue when it happens, without the schema assuming it will |
| Scope | `spaces.enabled` ships `false`. Everything can land in production unseen and be switched on when it is genuinely ready |


---

## 16. Decisions taken

Resolved 14 Aug 2026. Recorded here so the reasoning survives the conversation.

| # | Question | Decision |
|---|---|---|
| 1 | Naming and URL scheme | **Space**, addressed at `/c/:slug`. Model `Space`, API `/api/spaces`, settings namespace `spaces.*`. The nav entry is still labelled "Community" — that is the place; a space is the unit |
| 2 | Domain scope | **Fully generic.** A space is about anything. Novels are reachable only through the optional `linkedRefs` mechanism (§4.13), which is one registered entity type and can be disabled entirely |
| 3 | Who may create a space | **All four modes ship, all admin-switchable at runtime**, plus per-user `always`/`never` overrides (§4.14). Default is `karma_gated`; launch with `admin_only` and loosen. Admin retains complete control over who can create, and can revoke it from an individual without changing global policy |
| 4 | Monetization | **Not in v1.** Communities are free. The three candidate mechanisms are specced separately in [`monetization-phase2.md`](./monetization-phase2.md) and deliberately excluded from every phase in §13 |
| 5 | Karma visibility | Public by default, via `spaces.karma.showOnProfile` and `spaces.karma.showOnPost` — both admin toggles, so this is reversible without a deploy and needs no decision now |
| 6 | Chapter comments | Stay entirely separate. Different model, different hot path, no migration. Now clearly correct given the community is generic |
| 7 | Rendering *(15 Aug 2026)* | **Client-side only. No SSR, no prerendering.** The community ships as part of the existing Vite SPA. Accepted cost: generic link previews, absence from AI crawlers, unreliable search indexing. Two codebase constraints made full SSR unattractive anyway — auth is a `localStorage` JWT, so a server render can never know the user, and Express does not currently serve the frontend. Cost detail and the reversal path (cheapest first: metadata injection ≈1 week) are in [Phase 7](./implementation-plan/phase-07-public-ui.md) |

### Raised by the readiness research — decide before the phase they affect

| Decision | Affects | Why it is expensive later |
|---|---|---|
| **Which jurisdictions are in scope** | Phase 10 | An EU or UK audience pulls the DSA statement-of-reasons and appeals work forward, and may require age assurance |
| **Redis, or not** | Phases 0, 8 | Rate limiting across instances, feed caching and session revocation all want it. All three degrade without it |
| **MongoDB text search, or a real engine** | Phase 8 | Non-Latin content or more than a few hundred thousand posts forces the answer. Migrating is far easier before there is data |

### Still to confirm before Phase 4

**Is S3 configured in production?** `storage.js` falls back to the local `uploads/` directory when `S3_BUCKET` and `AWS_REGION` are unset. That fallback is a development convenience and will not survive user-uploaded image volume — it fills the app server's disk and does not survive a redeploy on most hosts. Media upload (Phase 4) should not ship without object storage behind it. Phases 0–3 are unaffected.
