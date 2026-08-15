# Phase 0 — Foundations

**Status:** ✅ Complete — 313 unit tests passing
**Depends on:** nothing
**Unblocks:** every other phase
**Reference:** [architecture](../architecture.md) §9 · [readiness](../platform-readiness.md) §13.0 · [scalability](../scalability.md) §5

---

## Goal

Everything the rest of the build stands on: the admin-controllable settings surface, the shared constants, and the four seam interfaces that let us stay a single service while keeping Redis, queues and search one file away.

Nothing user-visible ships in this phase. `spaces.enabled` is `false` and stays that way until Phase 7.

---

## Shipped

| File | What it does |
|---|---|
| `config/settings/spaces.js` | **135 declarations** across 14 sections. 12 marked `spaceOverridable` |
| `config/settingsRegistry.js` | Registers the module; `describe()` exposes `spaceOverridable`; `SECTIONS` grouped by module so short names cannot collide |
| `config/constants.js` | Community enums, `VIEW_TARGET_TYPES.POST`, `ELEVATED_PERMISSIONS` |
| `config/linkTypes.js` | Generic linkable-entity registry. `novel` and `chapter` registered |
| `utils/sanitizeHtml.js` | Server-side sanitizer. Policy is ours and testable; `sanitize-html` is the engine |
| `middlewares/securityHeaders.js` | CSP (report-only) + nosniff, frame deny, referrer, permissions policy, HSTS |
| `middlewares/dynamicUpload.js` | Multer built per request from live settings, plus `validateFiles` |
| `middlewares/rateLimit.js` | Rewritten over a swappable store; community limiters added |
| `middlewares/auth.js` | `requireElevated()` and `hasElevated()` |
| `services/cacheService.js` | TTL + entry cap, prefix invalidation, request-scoped memoization |
| `services/counterService.js` | `direct` and `batched` modes behind one call |
| `services/jobDispatcher.js` | `enqueue(name, payload)`, in-process, with timeouts and drain |
| `services/classificationService.js` | Null provider; policy and thresholds live here, not at the vendor |
| `services/rateLimitStore.js` | Memory store behind the interface Redis will implement |
| `models/User.js` | `elevatedPermissions[]` |
| `server.js` | Drains jobs and flushes counters before disconnecting |
| `app.js` | Security headers, CSP report endpoint, hardened `/uploads` |
| `frontend/src/i18n/` | `t()` / `plural()` shim + 134-key English catalog |
| `frontend/src/admin/settings/sections.js` | 14 Community groups; legacy `platform.community` moved under **Reading** |
| `tests/spaces.unit.test.js`, `tests/phase0.unit.test.js` | 128 tests |

---

## Two decisions taken during the build

### `ELEVATED_PERMISSIONS`, not `ROLES.SAFETY_ADMIN`

The plan called for a `SAFETY_ADMIN` role. That turned out to be wrong: `User.role` is single-valued, so a `safety_admin` role would mean the person reviewing child-safety reports could not also be an admin — which in a small team is everyone, including the owner.

Instead, `User.elevatedPermissions: [String]` sits alongside the role, with `requireElevated(permission)` gating access. One account can hold `admin` plus `child_safety` without either weakening the other.

Critically, **`requireElevated` does not treat `admin` as implying every permission.** The point of the restricted queue is that being an admin is not sufficient — the permission is granted explicitly, which keeps the set of people who can see that material small and auditable. There is a test pinning this.

### `sanitize-html` is a new dependency, not yet installed

Added to `backend/package.json`. **Run `npm install` in `backend/` before the first community write endpoint ships.**

The module is deliberately fatal if the package is missing — a sanitizer that degrades to a pass-through is worse than none, because callers believe they are protected. The policy (allowlists, URL scheme rules, forced `rel`, class filtering) is this codebase's own code and is fully unit-tested without the engine present.

---

## Definition of done

- [x] `sanitizeHtml` rejects every payload in the XSS corpus (21 blocked vectors, 6 allowed)
- [x] CSP header present, report-only, with a report endpoint
- [x] All four seam interfaces exist with trivial implementations and unit tests
- [x] `cacheService` enforces its entry cap under a fill test
- [x] New settings validate; `settingsCoverage.unit.test.js` passes
- [x] `npx jest --config jest.unit.config.js` green — 313 tests
- [x] `spaces.enabled` still `false`
- [ ] **`npm install` in `backend/`** to pull in `sanitize-html`
- [ ] Read a week of CSP reports, then set `CSP_ENFORCE=true`

---

## Gotchas

- **Do not add Redis here.** The interfaces exist so that decision can be deferred to a measurement. See [scalability](../scalability.md) §6 Stage 4.
- `settingsCoverage.unit.test.js` fails the build if a registry section has no home in `frontend/src/admin/settings/sections.js`. That guard is intentional — add the section to the manifest in the same commit.
- The registry validates every default at require time. A malformed declaration fails the whole app at boot, not silently in the admin form.
