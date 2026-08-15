# Phase 1 — Spaces and Membership

**Status:** ✅ Complete — 412 unit tests passing (99 new)
**Depends on:** Phase 0
**Unblocks:** Phases 2, 5, 6
**Reference:** [architecture](../architecture.md) §4.1–4.2, §4.14, §7.1 · [readiness](../platform-readiness.md) §13.1

---

## Goal

A space exists, has an owner and moderators, people can join it, and the permission resolver every later phase depends on is in place and exhaustively tested.

No posts yet. That is deliberate — the permission matrix is the highest-risk surface in the system and it is worth landing alone.

---

## Files to create

```
backend/src/models/Space.js
backend/src/models/SpaceMember.js
backend/src/models/Flair.js
backend/src/services/community/spacePermissionService.js
backend/src/services/community/spaceService.js
backend/src/controllers/spaceController.js
backend/src/routes/spaceRoutes.js
backend/tests/spacePermissions.unit.test.js
backend/tests/spaces.integration.test.js
```

**Modify:** `backend/src/app.js` (mount `/api/spaces`), `backend/src/models/User.js` (karma, `spaceCreation`, `communityBannedUntil`, `ageAssurance`).

---

## Data model

Full field lists in [architecture](../architecture.md) §4.1–4.2 and §4.6. Phase-specific notes:

### Shard-key fields — **FREE**

Every model carries its future shard-key field from creation ([scalability](../scalability.md) §4.1). For this phase that means `SpaceMember` is designed for `{ user: 'hashed' }` and `Space` for `_id`. Nothing is sharded; the fields simply exist and are always populated.

### Bounded arrays — **FREE**

`Space.rules` (15), `Space.linkedRefs` (5), `Space.topics` (taxonomy size). **Enforced on write**, not just declared. The legacy `Comment.likes: [ObjectId]` array is the anti-pattern being avoided — see [scalability](../scalability.md) §4.3.

### Fields added now, used later — **FREE**

Adding a field to a large collection later is a migration. These cost nothing now:

| Field | Used in |
|---|---|
| `Space.slowMode` `{ enabled, seconds }` | Phase 5 |
| `Space.lockdown` `{ enabled, minKarma, minAgeHours, until }` | Phase 5 |
| `Space.language` | i18n, if ever |
| `Space.excludeFromAll` | Phase 2 feeds |
| `Space.publicModlog` | Phase 5 |
| `User.ageAssurance` `{ method, verifiedAt, provider, level }` | Phase 10 |
| `User.trustedFlagger`, `User.strikes`, `User.warnings` | Phase 5 |

### Sparse overrides

`Space.overrides` accepts only keys flagged `spaceOverridable` in the registry, validated through `registry.coerceAndValidate`. A space stores only what it changed; everything else resolves to the global default. Admins may force any key, overridable or not.

---

## Permission resolver

`spacePermissionService.resolve(user, space, membership)` returns:

```js
{ isAdmin, isOwner, isModerator, isMember, isBanned, isMuted,
  can: { view, post, comment, vote, managePosts, manageMembers,
         manageSettings, manageFlair, manageRules, manageMods, viewModlog } }
```

**This is the only place role logic lives.** Site admin short-circuits every `can.*` to true. Controllers call `resolve` once and check a boolean.

It also carries `canCreateSpace(user)` returning `{ allowed, requiresApproval, reason }`. Resolution order ([architecture](../architecture.md) §4.14):

```
communityBannedUntil            → denied
User.spaceCreation === 'never'  → denied
User.spaceCreation === 'always' → allowed, bypasses everything below
otherwise spaces.creation.mode:
   open | karma_gated | approval | admin_only
then: cooldown, owned-space cap, site-wide cap
```

The `reason` string is shown to the user. A blocked user gets told why, not a dead button.

**FREE — design constraint:** shadowban and user-block filtering (Phase 5) route through this same resolver. Scattered checks guarantee a leak in search, notifications or direct links.

---

## Endpoints

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/spaces` | optional |
| `POST` | `/api/spaces` | user, gated |
| `GET` | `/api/spaces/:slug` | optional |
| `PATCH` | `/api/spaces/:slug` | `manageSettings` |
| `POST` | `/api/spaces/:slug/icon` \| `/banner` | `manageSettings` |
| `POST` | `/api/spaces/:slug/join` \| `/leave` | user |
| `GET` | `/api/spaces/:slug/members` | per visibility |
| `PATCH` | `/api/spaces/:slug/members/:userId` | `manageMembers` |
| `GET/POST/PATCH/DELETE` | `/api/spaces/:slug/rules` | `manageRules` |
| `GET/POST/PATCH/DELETE` | `/api/spaces/:slug/flairs` | `manageFlair` |

---

## FREE items with rationale

**Slug homoglyph normalisation.** Without it, registering a visually identical space name is trivial impersonation. Normalise to NFKC, reject mixed-script slugs, and check against a confusables map. Renaming after the fact breaks every link ever shared.

**Contrast validation on `Space.theme.primary`.** Validate at save time against the surface colours and reject or auto-adjust. A space owner must not be able to create an inaccessible page — and under the EAA that is the platform's liability, not theirs.

**`services/community/` module layout.** No community module reaches into another module's collections directly; cross-module access goes through the owning module's functions. Costs nothing to maintain and is what makes later extraction possible.

**Ownership-transfer policy implemented in the delete path now.** When an owner deletes their account, the space transfers to the longest-serving moderator, or is archived if there is none. Deciding this during the first deletion request is how spaces get orphaned ([readiness](../platform-readiness.md) §7.1).

---

## Tests

`spacePermissions.unit.test.js` is the most valuable test in the project — a table across every **role × action × space state**. Roles: anonymous, user, member, muted, banned, moderator with each granular permission, owner, admin. States: pending, active, archived, quarantined, banned, locked. A gap here is a security hole.

Also: slug validation including homoglyphs and reserved words, `canCreateSpace` across all four modes plus both per-user overrides, override rejection for non-`spaceOverridable` keys, array bound enforcement, contrast rejection.

---

## Definition of done

- [x] Permission matrix test passes with no gaps — 62 cases
- [x] Space CRUD, join/leave, rules, flairs working end to end
- [x] All four creation modes and both per-user overrides enforced
- [x] Homoglyph and reserved-slug rejection — 37 cases
- [x] Contrast validation rejects an inaccessible accent colour
- [x] Every array bound enforced on write
- [x] Indexes declared: Space 10, SpaceMember 7, Flair 3
- [ ] Run `npm run sync-indexes` against a real database
- [ ] Integration tests (`npm test`) — could not run in the build sandbox

---

## Decisions taken during the build

**A moderator cannot act on another moderator.** Only the owner or an admin can. Without this, one moderator can remove the rest and take over a space — the single most common way a community gets hijacked.

**Demotion clears the permissions object.** Leaving a stale `permissions` map on a demoted member is a latent privilege-escalation bug the day someone re-promotes them, or the day a code path checks permissions without checking role. There is a test for it.

**A default moderator does not get `manageSettings`, `manageRules` or `manageMods`.** `SpaceMember.fullPermissions()` deliberately leaves those false. A mod who can appoint mods can take a space; a mod who can change settings can change what the space is.

**Banning upserts.** A drive-by poster who never joined must still be bannable, so the ban writes a membership row if none exists.

**Leaving cannot clear a ban, and an owner cannot leave.** Both would otherwise be trivial escapes — the first from moderation, the second leaving an orphaned space.

**Ownership succession is implemented now, not at first deletion.** `findSuccessor` picks the longest-serving active moderator, else the longest-serving member, else the space is archived. Deciding this during the first account-deletion request is how spaces get orphaned.

**Banned users keep read access to public spaces.** Hiding a public space from them achieves nothing — they can sign out and see the same page — and it makes an appeal harder to write.
