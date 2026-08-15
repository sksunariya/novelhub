const fs = require('fs');
const path = require('path');
const registry = require('../../src/config/settingsRegistry');

// The public-projection contract.
//
// WHY THIS EXISTS: two settings shipped that the SPA reads but that were never
// in the public projection. `spaces.creation.allowNsfw` was one — the frontend
// gated a form field on it, the key never reached the browser, the value was
// always `undefined`, and so the field never rendered no matter what the admin
// set. Nothing failed. No error, no warning, no test. The admin toggle was
// simply inert, and the only way to notice was to try it and wonder.
//
// That is the whole failure mode this file closes: a setting the frontend reads
// MUST be public, and the only reliable way to enforce it is to read the
// frontend and check.

const FRONTEND_SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'src');

/** Every `'namespace.some.key'` string literal under frontend/src. */
const collectSettingReads = (dir, prefix, out = new Set()) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSettingReads(full, prefix, out);
      continue;
    }
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;

    // The admin settings page enumerates SECTION ids, which share the prefix
    // but are not keys. It renders from the registry's own metadata, so it
    // cannot go stale the way a hand-written read can.
    if (full.includes(path.join('admin', 'settings'))) continue;

    const source = fs.readFileSync(full, 'utf8');
    const pattern = new RegExp(`['"\`](${prefix}\\.[a-zA-Z][a-zA-Z0-9.]*)['"\`]`, 'g');
    let match = pattern.exec(source);
    while (match) {
      out.add(match[1]);
      match = pattern.exec(source);
    }
  }
  return out;
};

const describeIfFrontend = fs.existsSync(FRONTEND_SRC) ? describe : describe.skip;

describeIfFrontend('settings public projection contract', () => {
  const publicKeys = new Set(registry.publicKeys());
  const allKeys = new Set(registry.keys());

  test.each(['spaces', 'community', 'limits', 'rateLimits'])(
    'every %s.* key the frontend reads is public',
    (prefix) => {
      const read = [...collectSettingReads(FRONTEND_SRC, prefix)]
        // Section ids are legitimate strings that are not keys. Anything that
        // is not a registered key at all is out of scope for THIS assertion —
        // the next test covers those.
        .filter((key) => allKeys.has(key));

      const notPublic = read.filter((key) => !publicKeys.has(key));

      expect(notPublic).toEqual([]);
    }
  );

  test('the frontend does not read a key that no longer exists', () => {
    const sectionIds = new Set(registry.sections ? registry.sections() : []);
    const read = [...collectSettingReads(FRONTEND_SRC, 'spaces')];

    const unknown = read.filter((key) => !allKeys.has(key) && !sectionIds.has(key));

    // A renamed or deleted setting leaves the reader silently falling back to
    // its default forever, which is the same silent failure in a different
    // costume.
    expect(unknown).toEqual([]);
  });

  test('publicKeys never includes anything marked secret', () => {
    const leaked = registry.publicKeys().filter((key) => registry.get(key).secret);
    expect(leaked).toEqual([]);
  });
});
