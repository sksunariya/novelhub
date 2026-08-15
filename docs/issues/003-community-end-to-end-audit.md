# 003 — Community end-to-end audit

**Date:** 15 Aug 2026
**Scope:** every file added by Phases 0–7, frontend and backend
**Resolved:** 15 Aug 2026 — all 13 findings closed. See the resolution log at the
end of this file.
**Method:** API contract diff (frontend call sites vs. mounted routes), settings-key
cross-check against the registry, link-target vs. declared-route diff, empirical
Express route-matching test, read-through of the write paths.

Backend unit suite is green (609 passing) throughout. Nothing below is caught by
those tests, because they cover services in isolation — every finding here lives
in the wiring *between* layers, which is exactly where a system built in phases
tends to leak.

---

## A. Broken — will visibly fail in the browser

### A1. `/community/appeals` is a dead route (linked from two places)

`PostDetail.jsx:279` and `UserProfile.jsx:91` both link to it. No such route is
declared in `App.jsx`, so it falls through to `/community/:type` and renders
`CommunityHub` with `type="appeals"`, which then requests a feed named
`appeals` and errors.

**This is the DSA Article 17 appeals mechanism** — a BLOCKING legal item. The
whole back half exists already: `GET /reports/statements/mine`,
`POST /reports/appeals`, and `myStatements` / `submitAppeal` in
`api/spaces.js`. Only the page is missing.

The links are shown at precisely the moment they matter most: to someone whose
content was removed, and to someone who has been suspended.

**Fix:** build `pages/community/Appeals.jsx`, route it at `/community/appeals`.

---

### A2. `/c/:slug/modlog` is a dead route

`SpacePage.jsx:272` links to it. Not declared, and it does not match
`/c/:slug` (which is exact), so it hits the `*` catch-all 404.

**Fix:** either build the public modlog page or drop the link. A public modlog
is a transparency asset and the data already exists in `ModAction`.

---

### A3. `POST /reports/:id/claim` is shadowed and unreachable

`reportRoutes.js` registers `router.post('/:type/:id', …)` at line 22 and
`router.post('/:id/claim', …)` at line 28. Express matches in registration
order, and both are two-segment POSTs.

Verified empirically:

```
POST /reports/507f1f77bcf86cd799439011/claim
  -> {"handler":"submitReport","params":{"type":"507f...011","id":"claim"}}
```

So claiming a report from the mod queue runs `submitReport` instead, with a
target id of `"claim"`. `submitReport` does not validate `type` — anything that
is not `'comment'` silently becomes `POST` — so it proceeds to
`Post.findById('claim')` and dies on a CastError rather than saying anything
useful.

**Fix:** move `/:type/:id` below every literal-prefixed route in the file, and
have `submitReport` reject a `type` that is not `post` or `comment` instead of
defaulting.

---

### A4. `spaces.creation.allowNsfw` is not in the public projection

`CreateSpace.jsx:209` gates the NSFW option on it. The key is declared
`public: false`, so it never reaches the SPA, `settings?.[…]` is `undefined`,
and **the option never renders no matter what the admin sets.**

**Fix:** add `public: true` to the declaration. One line.

---

### A5. `spaces.creation.requirePurpose` is not public either

`CreateSpace.jsx:50` reads `settings?.['spaces.creation.requirePurpose'] !== false`.
Undefined `!== false` is `true`, so purpose is always required. That happens to
match the default, which is why it looks fine — but **the admin toggle does
nothing.** Turning it off changes no behaviour.

**Fix:** same one-line change.

> A4 and A5 are the same class of bug and worth a standing rule: *if the
> frontend reads a setting, the setting must be `public`.* Worth a lint or a
> test that diffs `grep 'spaces\.' frontend/` against `registry.publicKeys()`.

---

## B. Silent failures — the action fails and the user is told nothing

### B1. `submitComment` has no error handling

`PostDetail.jsx:160`. There is a `try`/`finally` but no `catch`. Every rejection
path — automod, rate limit, space ban, locked post, comment-too-long — resolves
to: spinner stops, draft still sits there, nothing said.

Automod rejection is not an edge case; it is the common case for a new user.
`PostComposer` and `CreateSpace` both handle this properly, so the pattern
already exists in the codebase.

**Fix:** `catch` and surface `err?.response?.data?.message`.

---

### B2. `voteError` is rendered on exactly one page

`CommunityHub.jsx:153` is the only consumer. `PostDetail` and `SpacePage` both
call `vote()` and neither renders the error.

The context's own header comment says *"a vote that silently reverts is worse
than one that never appeared."* On two of the three pages, that is what happens.

This directly undercuts the comment-vote fix: if a comment vote is rejected —
banned from the space, voting disabled, rate limited — the arrow springs back
with no explanation.

**Fix:** move the error banner into a shared component, or render it in
`CommunityProvider` so it covers every consumer by construction.

---

### B3. Vote deltas are never reconciled or cleared

`CommunityContext.vote()` discards the server response. The optimistic entry
stays in `voteDeltas` for the rest of the session, and `viewOf` prefers it over
fresh server data — so after navigating away and back, the displayed score is
the locally computed one, not the true one. Other people's votes in the interim
are invisible.

The map also grows unbounded for the session.

**Fix:** the vote endpoints already return the authoritative score. Write it
back into the delta on success rather than keeping the guess.

---

## C. Inert code — built, wired to nothing

### C1. `refreshJoined` is never called; `joined` is never read

`CommunityContext` exposes both. Nothing in `pages/community/` or
`components/community/` calls `refreshJoined()`, and nothing reads `joined`.
(`UserProfile.jsx:67` has the word "joined" but that is a signup date.)

So `joined` is permanently `null`. There is no "your communities" list, and
join state is not reflected anywhere outside the space page itself.

---

### C2. Comment sort is hardcoded

```js
useEffect(() => {
  api.getComments(postId, { sort: 'best' })   // always 'best'
  …
}, [postId, sort]);                            // but depends on the FEED sort
```

Two problems in three lines: changing the feed sort (hot/top/new) refetches the
comments for no reason and discards any lazily loaded replies, and there is no
comment sort control at all even though the backend reads `req.query.sort`
(`postCommentController.js:72`).

---

### C3. `post.commentCount` is never incremented after commenting

The heading renders `{post.commentCount || 0} comment{…}` from the post object.
`submitComment` appends to `comments` but never touches `post`, so the count
stays stale until a reload — you comment, your comment appears, and the heading
still says what it said before.

---

## D. Hardening gaps

### D1. No rate limiter on `/api/media/*`

`spaceRoutes`, `postRoutes`, `commentRoutes` and `reportRoutes` all apply
limiters. `mediaRoutes` applies none — on the three most expensive endpoints in
the system (multipart parse, full buffer in memory, perceptual-hash lookup, S3
put).

This is the natural target for both denial-of-service and cost amplification,
and it is the one route family with no ceiling.

**Fix:** an `uploadLimiter`, tighter than `postLimiter`.

---

### D2. `loadPrefs()` runs on every provider render

`CommunityContext.jsx:38` calls it in the component body rather than in a
`useState` initializer, so every render of the provider does a `localStorage`
read plus a `JSON.parse`. Harmless in effect, wasteful by construction, and it
sits above the whole community tree.

**Fix:** `useState(() => loadPrefs().density || 'card')`.

---

## E. Not bugs — known-missing from the Phase 7 spec

Recorded so they are not rediscovered as bugs later:

- Space mod tools (`/c/:slug/mod`)
- `/c/:slug/about` — rules, mods, stats
- Media upload wired into the composer (the backend pipeline is complete)
- Saved items (`/community/saved`)
- Keyboard shortcut layer (`j`/`k`/`u`/`d`/`?`)

---

## What passed

Worth recording, so the next audit does not redo it:

- **Every write route is behind `protect`.** The two `mediaRoutes` entries that
  look bare in a one-line grep have `protect` on the following line.
- **Admin routes are correctly ordered** — `/spaces/:id/transfer`,
  `/moderators` and `/recount` all precede `/spaces/:id/:action`. This is the
  same class of bug as A3, and here it was avoided.
- **Report dedupe is sound.** The unique partial index on
  `{targetType, target, reporter}` means one person cannot cross the auto-hide
  threshold by reporting five times, and `reporterWeight` is bounded so no
  single reporter can ever reach the threshold alone.
- **Self-voting is blocked** in `voteService.checkEligibility`.
- **Comment voting checks space permissions** and returns a distinguishable
  message for a ban.
- **All admin API calls resolve**, including `/safety/incidents`.
- **`/media/draft` exists** and is correctly wired to `dynamicUpload`.
- **Feed route ordering is correct** — `/linked/:type/:id` and `/space/:slug`
  both precede `/:type`.


---

# Resolution log — 15 Aug 2026

All 13 findings closed. Backend suite: **615 passing, 19 suites** (was 609/18 —
the six new ones are the regression guard below). Every community frontend file
parses clean through esbuild.

| # | Fix |
|---|---|
| A1 | Built `pages/community/Appeals.jsx`, routed at `/community/appeals` **above** `/community/:type` so the wildcard cannot swallow it. Renders statements of reasons with the Article 17 disclosures — restriction, ground, the rule *as it read at the time*, and whether the call was automated — plus the appeal form. Withholds the deciding moderator and the removed content, for the reasons noted in the file header. |
| A2 | Built `GET /api/spaces/:slug/modlog` (opt-in per space, 404 otherwise) and `pages/community/SpaceModlog.jsx`, routed above `/c/:slug`. Publishes action and reason; withholds `note`, the moderator's identity and the actioned user. The `ModAction` model already carried `publiclyVisible` and a comment saying `note` is never rendered publicly — the design anticipated this page. |
| A3 | Moved `POST /:type/:id` to the bottom of `reportRoutes.js` with a comment saying anything added below it is unreachable, and made `submitReport` reject a `type` that is not `post` or `comment` rather than silently defaulting to post. Verified by asserting the wildcard is the last entry in the router stack. |
| A4, A5 | `public: true` on both creation settings. |
| B1 | `submitComment` now catches and surfaces the server message. |
| B2 | The vote-error alert moved out of `CommunityHub` and into `CommunityProvider`, so every consumer is covered by construction rather than by remembering. |
| B3 | Vote deltas reconcile against the authoritative score the endpoint already returned, instead of keeping the local guess forever. |
| C1 | `refreshJoined` is called once the user is known and the community is on, re-called on join/leave, and `joined` is consumed as a "your spaces" strip on the hub. |
| C2 | Comment sort is its own state with a real control (best/top/new/old/controversial) and no longer depends on the feed sort. |
| C3 | `commentCount` increments locally after a successful post. |
| D1 | Added `spaces.media.uploadsPerHour` (default 30) and an `uploadLimiter`, applied to all three media routes **before** multer — a rejected request must not first pay for parsing the body it was rejected for sending. |
| D2 | `loadPrefs()` moved into lazy `useState` initialisers. |

## The regression guard

`tests/unit/settingsPublicContract.unit.test.js` reads the actual frontend
source, extracts every `'spaces.*'` string literal, and asserts each one that is
a registered key is also public — plus that no key the frontend reads has been
deleted, and that nothing secret leaks into the public projection.

**Confirmed it fails for the right reason:** reverting
`spaces.creation.allowNsfw` to `public: false` turns the suite red and names the
key. A guard that has never been seen to fail is not a guard.

This is the class of bug worth spending a test on. A4 and A5 produced no error,
no warning and no visible symptom — the admin toggle was simply inert, and the
only way to find out was to try it and wonder why nothing happened.

## Still open — carried forward, not bugs

Section E stands: space mod tools, `/c/:slug/about`, media upload in the
composer, saved items, and the keyboard shortcut layer. Phases 8-10 are
unstarted, and the seven BLOCKING items in Phases 9 and 10 remain what actually
gates flipping `spaces.enabled`.
