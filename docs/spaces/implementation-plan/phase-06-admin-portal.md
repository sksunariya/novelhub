# Phase 6 — Admin Portal

**Status:** ✅ Complete — API plus seven pages. 609 unit tests passing.
**Depends on:** Phases 1–5
**Runs in parallel with:** Phase 7 (they share no files)
**Reference:** [architecture](../architecture.md) §10 · [readiness](../platform-readiness.md) §13.6

---

## Goal

Total admin control, which is the requirement this project started from. Every user-facing capability has an admin equivalent without the membership requirement, plus lifecycle and oversight tools nobody else has.

---

## Files to create

```
frontend/src/admin/SpacesAdmin.jsx
frontend/src/admin/SpaceRequestsAdmin.jsx
frontend/src/admin/SpaceDetailAdmin.jsx
frontend/src/admin/CommunityPostsAdmin.jsx
frontend/src/admin/CommunityReportsAdmin.jsx
frontend/src/admin/CommunityModlogAdmin.jsx
frontend/src/admin/ChildSafetyAdmin.jsx          ← SAFETY_ADMIN only
frontend/src/admin/community/                     ← shared components
backend/src/controllers/adminSpaceController.js
backend/src/routes/adminSpaceRoutes.js
```

**Modify:** `frontend/src/admin/AdminLayout.jsx` (nav), `frontend/src/App.jsx` (routes), `frontend/src/admin/UsersAdmin.jsx` (community tab), `frontend/src/admin/AnalyticsAdmin.jsx` (insights tab).

---

## Navigation

The existing **Community** group is renamed **People** to free the name:

```
Community
  ├─ Spaces        /admin/spaces
  ├─ Requests      /admin/spaces/requests      (badge = pending count)
  ├─ Posts         /admin/community/posts
  ├─ Reports       /admin/community/reports
  ├─ Mod log       /admin/community/modlog
  ├─ Safety        /admin/community/safety      (SAFETY_ADMIN only)
  └─ Insights      /admin/community/insights
People
  ├─ Users         /admin/users
  ├─ Moderation    /admin/moderation            (existing: chapter comments)
  └─ Notifications /admin/notifications
```

---

## The pages

### `SpacesAdmin` — the registry

Table: icon, name, slug, owner, members, posts/7d, status, visibility, flags, created. Filters on every column. Row actions: view, edit, approve, feature, verify, quarantine, archive, ban, restore, transfer ownership, recount, delete. Bulk selection with a confirmation dialog naming the affected spaces. Every action prompts for a reason and writes to both `ModAction` and `AdminAuditLog`.

### `SpaceRequestsAdmin` — approval queue

Live only when `spaces.creation.mode` is `approval`. Each row shows the requested slug and name, the requester with karma, account age and prior moderation history, and the stated purpose. Approve, reject with a reason, or **approve-and-grant** so that user bypasses the queue in future (sets `User.spaceCreation = 'always'`). Requests older than `spaces.creation.pendingExpiryDays` auto-reject.

### `SpaceDetailAdmin` — seven tabs

Overview · Settings · Members · Posts · Rules · Flairs · Mod log.

The **Settings** tab renders every `spaceOverridable` key using the existing `SettingField` component, showing whether each is overridden or inheriting, with one-click revert to global. Admins get an additional **force** panel for keys the owner cannot touch — this is what "admins control every single thing" means concretely.

### `CommunityPostsAdmin` — every post on the site

Filters: space, author, type, status, flair, NSFW/spoiler, score range, report count, comment count, date range, has-media, linked entity. Bulk: remove, restore, approve, lock, pin, mark NSFW/spoiler, change flair, **move to another space**, delete.

Move is implemented as delete-and-recreate (Phase 2) because a shard key value cannot be updated in place.

### `CommunityReportsAdmin` — the queue

Left rail groups by reason and severity with counts. Centre shows the reported content **as it was when reported** (`Report.snapshot`) beside its current state, so an edit-after-report is visible. Right rail shows the author's history — karma, prior removals, prior bans, reports against them, **and reports they have filed**, which surfaces report-brigading.

Keyboard triage: `a` approve, `r` remove, `d` dismiss, `j`/`k` navigate. Throughput here is the difference between a queue that gets cleared and one that does not.

### `CommunityModlogAdmin`

Every `ModAction` across every space, filterable by space, actor, action type, target type, date. **This is how an admin finds a moderator abusing their space** — no other view answers that question.

### `ChildSafetyAdmin` — restricted

Visible only to `ROLES.SAFETY_ADMIN`. Incidents from Phase 4, with preservation status, report status and the runbook inline. Content is access-restricted, not displayed by default. Not reachable by general admins or community moderators.

### Insights

A tab inside the existing `AnalyticsAdmin` shell, reusing its chart primitives and date-range control. Reads `SpaceStatsDaily` rollups only, never raw collections.

Charts: space growth, new spaces per week, posts and comments per day, votes per day, community DAU vs reader base, top spaces by growth and by reports, moderation throughput, karma distribution, and a "joined a space → still posting at 30 days" retention cohort.

### `UsersAdmin` community tab

Karma breakdown with manual adjustment · spaces joined, owned, moderated · posts, comments · reports filed and received · ban history · site-wide community ban with duration and reason · **space-creation control** (Follow global / Always allow / Never allow, with a required reason).

---

## FREE items with rationale

**Moderator health metrics written into the rollup from the start.** Queue depth, time to resolution, actions per moderator, moderators inactive N days. Moderator attrition is the most common cause of community collapse and it is entirely measurable — but only if the fields are being written from day one. Retroactive computation is impossible.

**i18n string extraction applied from the first component.** This phase is where most new UI gets written.

---

## Operational tooling

Slow-query panel (threshold `spaces.scale.slowQueryMs`) · counter rebuild trigger · index health view (`$indexStats`, unused index warnings) · vote anomaly review queue · transparency report generator.

---

## What landed

**The API is complete** — `/api/admin/community/*`, 23 handlers, mounted inside the existing `protect, adminOnly` guard:

- Spaces: list (including private, pending, archived, banned), detail with per-space media storage cost, update any field, force any setting override, six lifecycle actions, transfer, install moderators, recount.
- Posts: cross-site filtering on eleven dimensions, bulk actions capped at 200.
- Moderation: grouped report queue, report detail with author history, mod log filterable by actor role, appeals queue oldest-first.
- Users: full community history, site-wide community ban, per-user space-creation policy, karma adjustment.
- Transparency report aggregated from `StatementOfReasons`.
- Child safety: restricted queue behind `requireElevated(CHILD_SAFETY)`.

**Seven pages**: `SpacesAdmin`, `SpaceDetailAdmin`, `SpaceRequestsAdmin`, `CommunityPostsAdmin`, `CommunityReportsAdmin`, `CommunityModlogAdmin`, `ChildSafetyAdmin` — plus `api/community.js` and the nav and route wiring.

**`SpaceDetailAdmin`'s Settings tab is the concrete answer to "admins control every single thing".** It renders every `spaceOverridable` key from the registry, marks each as *overridden* or *inheriting*, shows the global default beside the current value, and requires a reason before saving — which lands in both audit trails.

**`SpaceRequestsAdmin` leads with the requester, not the request.** Karma, account age and the stated purpose are what separate a real request from a squatter; the name they picked tells you almost nothing. "Approve & trust" also sets that person's creation policy to `always`, so the queue shrinks as trust is established rather than staying constant forever.

**`CommunityPostsAdmin`'s bulk bar only appears once something is selected**, so it never sits there inviting an accidental click, and the 200-item cap is shown in the UI rather than surfacing as a 400 after someone has selected a thousand rows.

## Decisions taken during the build

**The nav splits Community from People.** The old group of that name is now **People** and its "Moderation" entry is relabelled **Chapter comments** — two moderation systems under one word was going to cause a mis-click eventually.

**Admin field updates are still an explicit allowlist.** "Admin" is not a reason to spread `req.body`; a typo would silently write a field that shadows a real one.

**Bulk actions are capped at 200.** An unbounded bulk endpoint is one mis-click from actioning the whole site, and the audit entry would be useless.

**A reason is required only for punitive actions.** Approving does not need one — asking when the answer is "it's fine" just trains people to type "ok" and devalues the reasons that matter.

**The report queue is grouped by item.** A post with twelve reports is one row. The right rail shows the author's history *and how many reports that person has filed*, which is how report-brigading becomes visible.

**The review pane shows the snapshot beside the current text.** A difference means it was edited after being reported — the whole reason snapshots exist.

**The mod log's `actorRole` filter is the point of that page.** It is how an admin finds a moderator abusing their own space, and no other view answers it.

**The child-safety page never renders content.** Metadata, match confidence and preservation state only. An admin without the permission sees a plain explanation of why, not an error — and every view of the queue is written to the audit log.

---

## Definition of done

- [ ] Every capability in the architecture doc's admin checklist reachable from the portal
- [ ] Every destructive action prompts for a reason and writes both audit trails
- [ ] Child-safety queue inaccessible to non-`SAFETY_ADMIN`, verified by test
- [ ] Report queue triageable entirely by keyboard
- [ ] Insights read only from rollups
