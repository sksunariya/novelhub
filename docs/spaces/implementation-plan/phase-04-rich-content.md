# Phase 4 — Rich Content

**Status:** 🟡 Core landed — 561 unit tests passing (70 new). Media upload endpoint still to wire.
**Depends on:** Phase 2
**Unblocks:** nothing (parallel with Phase 5)
**Reference:** [architecture](../architecture.md) §4.3, §7.4 · [readiness](../platform-readiness.md) §1.3, §3.1, §13.4

---

## ⚠ This phase contains the two most dangerous items in the project

**Do not ship media uploads without CSAM scanning. Do not ship link previews without SSRF hardening.** Both are below, both are BLOCKING, and neither is negotiable on schedule grounds.

---

## Goal

Image galleries, link posts with previews, and polls.

---

## Files to create

```
backend/src/services/community/mediaService.js
backend/src/services/community/linkPreviewService.js     ← SSRF-hardened
backend/src/services/safety/hashMatchService.js          ← CSAM
backend/src/models/ChildSafetyIncident.js
backend/src/models/PollVote.js
backend/src/controllers/mediaController.js
backend/tests/ssrf.unit.test.js
backend/tests/mediaLimits.integration.test.js
```

---

## BLOCKING 1 — SSRF-hardened link preview fetcher

URL unfurling is among the most commonly exploited SSRF entry points in existence. On a cloud host it reaches `169.254.169.254` and the instance metadata service, which is credential disclosure. **This is the single most dangerous thing in the architecture as specified.**

Required implementation, per [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html):

1. **Scheme allowlist:** `http` and `https` only. No `file:`, `gopher:`, `ftp:`, `data:`.
2. **Resolve the hostname to an IP, validate that IP, then connect to that exact IP** with the `Host` header set manually. Validating the name and letting the HTTP client re-resolve is the bug — DNS rebinding wins that race (time-of-check/time-of-use).
3. **Block:** `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`, and every IPv4-mapped IPv6 form of the above.
4. **Re-validate on every redirect hop.** Cap redirects at 3. A public URL redirecting to `localhost` is the standard bypass.
5. Response size cap and hard timeout (`spaces.posting.linkPreviewTimeoutMs`).
6. Content-type allowlist on the preview image fetch.
7. **Never reflect the raw fetch error to the user.** Error differences turn the endpoint into an internal port scanner.
8. Run in a network-restricted egress path if the host permits. Defence in depth, because the code-level check will eventually have a hole.

`ssrf.unit.test.js` must cover: each blocked range, IPv6 forms, decimal and octal IP encodings, redirect-to-private, DNS rebinding simulation, and scheme smuggling.

---

## BLOCKING 2 — CSAM perceptual hash matching

US electronic service providers must report apparent CSAM to NCMEC's CyberTipline as soon as reasonably possible after obtaining actual knowledge, and must **preserve** the material and its context. This is criminal-liability territory, not a feature.

- **Hash match every upload before the image is publicly readable.** PhotoDNA (free to qualifying platforms via Microsoft) or Thorn's Safer.
- **`ChildSafetyIncident` model, quarantined from normal moderation.** Content preserved and access-restricted rather than deleted; uploader account, IP and metadata retained; report status tracked.
- **A moderator must not be able to delete their way out of a preservation obligation.** This is precisely why the record sits outside the normal removal flow rather than being a `Report` with a special reason.
- Escalation queue visible only to `ROLES.SAFETY_ADMIN` (Phase 0), never to community moderators.
- Documented runbook: who reports, within what window, what is preserved, who is notified.
- Written retention policy for preserved material, which necessarily overrides the user's erasure rights.

---

## Media pipeline

`dynamicUpload` + `validateFiles` already exist from Phase 0. This phase adds the processing:

```
upload → multer (live byte caps)
       → validateFiles (per-type bytes, total bytes, dimensions)
       → hash match ─── on hit ──→ ChildSafetyIncident, quarantine, halt
       → EXIF strip
       → thumbnail generation
       → storage.js public tier
       → Post.media[]
```

Everything after `validateFiles` is dispatched through `jobDispatcher`, never inline in the request. A post creation blocked on thumbnail generation is a slow endpoint today and a queue swap later.

**Dependency:** `sharp`. `dynamicUpload.validateFiles` already degrades gracefully without it — byte caps apply, dimension checks skip. Installing it activates the dimension check, EXIF stripping and thumbnails.

---

## FREE items with rationale

**`alt` field on every media item, prompted in the composer.** Optional, never auto-filled with the filename. Retrofitting alt text means every image uploaded before the change is permanently inaccessible — you cannot go back and ask 40,000 users to describe their photos.

**EXIF stripping on by default.** `spaces.media.stripExif` already exists. Without it, user photos leak GPS coordinates — home addresses.

**Link domain recorded in bucketed form on the post.** Domain only, not the full URL. Feeds later brigade and spam analysis; costs one field.

---

## Polls

`PollVote` with `{post, user}` unique. Tallies denormalized on `Post.poll.options[].votes`. A `community.closePolls` job every 5 minutes finalizes polls past `endsAt`.

Rejected after `endsAt`, and `hideResultsUntilEnd` respected server-side — hiding results only in the UI is not hiding them.

---

## Tests

- Every SSRF case listed above.
- Media caps at exactly the limit, one byte over, and one under.
- Total-bytes cap across a gallery.
- Dimension rejection (decompression bomb).
- Mime/extension mismatch rejection.
- SVG rejected regardless of settings.
- Hash-match path creates an incident and blocks publication.
- Poll double-vote rejected; vote after `endsAt` rejected.

---

## Definition of done

- [x] SSRF suite green — 70 tests, including DNS rebinding, IPv4-mapped IPv6, 6to4, NAT64, credential and port bypasses
- [x] Connection is pinned to the validated IP via Node's `lookup` option, so the client never re-resolves
- [x] Every redirect hop re-validated from scratch, capped at 3
- [x] Failure reasons kept internal — `PUBLIC_ERROR` leaks nothing
- [x] `hashMatchService.assertReady()` refuses to run an image pipeline with no scanner configured
- [x] `ChildSafetyIncident` blocks `deleteOne`, `deleteMany` and `findOneAndDelete`, and has no `deletedAt`
- [x] `alt` field on every media item in the `Post` schema
- [x] Poll rules enforced server-side, including stripping tallies while results are hidden
- [ ] Wire the media upload endpoint (`mediaController`) onto `dynamicUpload` + `validateFiles` + `guardUpload`
- [ ] Install a real hash provider (PhotoDNA or Thorn Safer) before enabling `spaces.media.enabled`
- [ ] Install `sharp` to activate dimension checks, EXIF stripping and thumbnails
- [ ] Integration tests

---

## Decisions taken during the build

**The connection is pinned to a validated IP, not a hostname.** `ssrfGuard.validate()` returns an `address`, and `linkPreviewService` passes it through Node's `lookup` option so the HTTP client performs no DNS of its own. Validating a hostname and then handing the URL to a client that re-resolves it is the bug in almost every naive implementation — DNS rebinding wins that race.

**ALL resolved addresses must be public, not just the first.** A host answering with one public and one private address is a rebinding attempt; picking the safe one still lets the OS choose the other.

**Failure reasons never reach the client.** `ssrfGuard.PUBLIC_ERROR` is a single opaque string. Distinguishing "dns" from "private_ip" from "timeout" in a response turns the preview endpoint into an internal port scanner.

**Ports are allowlisted, not blocklisted.** `http://internal-host:6379/` is how SSRF reaches Redis. Only 80, 443, 8080 and 8443 are permitted.

**Credentials in a URL are rejected.** `http://expected.com@evil.com/` confuses naive host parsing and is a phishing vector in a rendered preview.

**`ChildSafetyIncident` is a preservation record, not a moderation record.** If it were a `Report` with a special reason, every existing moderation tool — bulk dismiss, bulk delete, a space owner clearing their queue — would be a path to destroying evidence the law requires be kept. It lives in its own collection, blocks all delete operations, and has no soft-delete field. `preservationUntil` deliberately has no default: preserved material is released by a documented decision, never by a retention sweep that happens to run.

**"Not configured" must not behave like "clean".** `assertReady()` throws 503 when no scanning provider is installed, and `scan()` returns `available: false` rather than `matched: false` when a provider errors. A vendor outage fails the upload rather than publishing it unscanned. `ALLOW_UNSCANNED_UPLOADS=true` is the explicit development override.

**The known-hash lookup is guarded on connection state.** A mongoose query with no connection *buffers* rather than failing, which would stall an upload request until the buffer timeout instead of proceeding to the provider that actually decides. Found by a unit test hanging — worth noting as a production behaviour, not just a test artifact.
