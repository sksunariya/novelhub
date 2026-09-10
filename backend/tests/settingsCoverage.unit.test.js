const fs = require('fs');
const path = require('path');
const registry = require('../src/config/settingsRegistry');

// The admin portal renders settings from the registry, but which sections
// appear — and where — comes from a manifest in the frontend. Nothing else
// connects the two, so a section added to the backend would silently have no
// UI, and a renamed section would silently render an empty tab.
//
// This is the guard for that seam.

const MANIFEST = path.join(__dirname, '../../frontend/src/admin/settings/sections.js');

const manifestSections = () => {
  const source = fs.readFileSync(MANIFEST, 'utf8');
  return [...source.matchAll(/section: '([^']+)'/g)].map((match) => match[1]);
};

// The other seam is the key itself: a string literal in one file, a declaration
// in another, with nothing but spelling connecting them. `snapshot.get` throws
// on a key the registry does not define, so a typo is a 500 on whatever route
// reads it — and the one shape that does not throw is worse, because a bad key
// read as a `.slice()` bound quietly drops the limit instead of failing.
//
// The mistake this exists to catch: `platform.homepage.maxRails`. The section
// is `platform.homepage` and the key is `homepage.maxRails` — the section
// prefix is not part of the key, and five reads in the spotlight service
// carried it. Every settings snapshot in this codebase is bound to one of these
// four names.
const SNAPSHOT_RECEIVERS = ['settings', 'snapshot', 'settingsService', 'config'];
const KEY_READ = new RegExp(
  `\\b(?:${SNAPSHOT_RECEIVERS.join('|')})\\.get\\(\\s*'([a-z][\\w.]*\\.[\\w.]+)'`,
  'g'
);

// A key does not always reach `get` directly. Some middleware takes the key as
// an argument and reads it later, and those bypass the scan above entirely —
// worse, `rateLimit.js` wraps its read in a try/catch that calls `next()`, so
// a bad key there does not 500, it silently stops rate-limiting the route.
// These are the argument positions that carry a registry key.
const KEY_ARGUMENTS = [
  [/createLimiter\(\s*'([^']+)'/g, 'createLimiter'],
  [/maxBytesKey:\s*'([^']+)'/g, 'maxBytesKey'],
  [/maxCountKey:\s*'([^']+)'/g, 'maxCountKey'],
];

const SRC = path.join(__dirname, '../src');

const sourceFiles = (dir, found = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
};

describe('admin settings coverage', () => {
  it('has a manifest to check against', () => {
    expect(fs.existsSync(MANIFEST)).toBe(true);
  });

  it('gives every registry section a home in the portal', () => {
    const placed = manifestSections();
    const orphans = registry.sections().filter((section) => !placed.includes(section));

    // An orphaned section means real settings an admin cannot reach.
    expect(
      orphans.map((section) => `${section} (${registry.bySection(section).length} settings)`)
    ).toEqual([]);
  });

  it('does not reference sections that do not exist', () => {
    const known = registry.sections();
    expect(manifestSections().filter((section) => !known.includes(section))).toEqual([]);
  });

  it('places each section exactly once', () => {
    const placed = manifestSections();
    const duplicated = placed.filter((section, index) => placed.indexOf(section) !== index);
    expect(duplicated).toEqual([]);
  });

  it('keeps every setting reachable through some section', () => {
    const sections = new Set(registry.sections());
    const stranded = registry.all().filter((def) => !sections.has(def.section));
    expect(stranded.map((def) => def.key)).toEqual([]);
  });

  it('reads only settings keys the registry declares', () => {
    const unknown = [];

    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          KEY_READ.lastIndex = 0;
          let match = KEY_READ.exec(line);
          while (match) {
            if (!registry.has(match[1])) {
              unknown.push(`${path.relative(SRC, file)}:${index + 1} reads ${match[1]}`);
            }
            match = KEY_READ.exec(line);
          }
        });
    }

    expect(unknown).toEqual([]);
  });

  it('passes only real settings keys to middleware that reads them later', () => {
    const unknown = [];

    for (const file of sourceFiles(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [pattern, label] of KEY_ARGUMENTS) {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);
        while (match) {
          if (!registry.has(match[1])) {
            unknown.push(`${path.relative(SRC, file)} passes ${match[1]} to ${label}`);
          }
          match = pattern.exec(source);
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});
