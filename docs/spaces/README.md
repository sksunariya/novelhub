# Spaces — the community system

A general-purpose, Reddit-class community layered onto Apex NovelHub. A space is about whatever its creator wants; nothing in the data model assumes novels.

## Where to start

**Building something?** → [implementation-plan/](./implementation-plan/) — one file per phase, with a status table and dependency graph in its README.

**Need to understand the design?** → [architecture.md](./architecture.md) — data model, ranking engine, feeds, API surface, admin portal, frontend.

**Something is slow?** → [scalability.md](./scalability.md) §8 — symptom-to-fix runbook.

**Legal, safety, accessibility or SEO question?** → [platform-readiness.md](./platform-readiness.md).

**Wondering about money?** → [monetization-phase2.md](./monetization-phase2.md) — deferred, not in v1.

## The shape of it

| Doc | What it answers | Lines |
|---|---|---|
| [architecture.md](./architecture.md) | How is it built | ~1150 |
| [platform-readiness.md](./platform-readiness.md) | What else does a platform like this need | ~555 |
| [scalability.md](./scalability.md) | What happens when it gets big | ~496 |
| [monetization-phase2.md](./monetization-phase2.md) | How could it make money later | ~220 |
| [implementation-plan/](./implementation-plan/) | What do I do next | 12 files |

## Three things worth knowing before reading anything else

1. **`spaces.enabled` ships `false`.** Phases 0–6 land in production unseen and get switched on when ready.
2. **Everything is admin-controllable.** 116 settings in the registry, rendered by the existing `ConfigPage` with zero new form code. A hardcoded community value is a bug.
3. **Votes are the only real scaling problem**, and it is a one-year problem at 100k DAU, not a five-year one. Everything else has years of headroom.
