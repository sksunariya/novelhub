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
});
