# Settings registry

Every admin-controllable value is declared once here. The validator, coercion,
admin form metadata, public projection, settings search index, audit diff,
reset-to-default and env-var override all derive from that single declaration.

## Adding a setting

Add one entry to `platform.js` or `monetization.js`:

```js
{
  key: 'pricing.defaultChapterCredits',   // dotted, unique, stable — it appears in the audit log
  section: SECTIONS.PRICING,              // drives which admin tab renders it
  type: 'integer',                        // see types.js
  default: 10,
  min: 0, max: 100000,
  label: 'Default chapter price',
  unit: 'credits',
  help: 'Shown under the field in the admin portal.',
  public: false,                          // include in GET /api/settings for the frontend
  secret: false,                          // never returned; read from `envVar`
  requiresConfirmation: true,             // admin UI shows an impact preview first
  impact: 'repriceChapters',              // names the impact-preview resolver
  dependsOn: { key: 'access.mode', notEquals: 'permanent' },  // conditional visibility
}
```

Nothing else changes. A malformed declaration throws at require time rather than
silently producing an unsaveable field — including a default that fails its own
validation.

## Reading settings

One await per request, then synchronous reads. Do **not** await per key.

```js
const settings = require('../services/settingsService');

const snapshot = await settings.snapshot();
const price = snapshot.get('pricing.defaultChapterCredits');
const label = snapshot.get('credits.labelPlural');
```

Reads are served from an in-process cache. Invalidation is a version poll: at
most one lightweight projection query per `SETTINGS_CACHE_MS` (default 5s) per
instance, regardless of request volume, so multiple instances converge within a
few seconds of a change without needing a message bus.

`settings.get(key)` exists for one-off reads. `snapshot.get()` on an unknown key
throws rather than returning `undefined`, so a typo fails loudly.

## Value resolution order

1. Environment variable, when the declaration has an `envVar` and it is set
2. Stored override in the `AppSettings` singleton
3. Registry default

Only values that differ from the default are persisted, so changing a default in
code takes effect for everyone who never overrode it, and the stored document
stays small.

## Secrets

`secret: true` settings are never returned by any read path — not the public
projection, not the admin read, not settings search — and cannot be written
through the API. The admin UI receives only a `configured: true|false` flag. They
are expected to come from the environment variable named in `envVar`.

## Status: declared vs wired

The registry is the source of truth, but each consumer has to be pointed at it.
Settings are declared here first, then the code that used a hardcoded constant is
migrated to read from the snapshot.

Settings whose consumer is not yet migrated are inert — declaring
`views.dedupWindowSeconds` does not by itself change the TTL index on
`ViewEvent`, and declaring `limits.commentMax` does not change the Mongoose
`maxlength`. Migrating those consumers is tracked as follow-up work; see
`docs/dynamic-configuration-audit.md`.
