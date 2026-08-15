// Settings registry — the single source of truth for every admin-controllable
// value. Each declaration drives the validator, the coercion, the admin form
// metadata, the public projection, the settings search index and the audit diff.
//
// Adding a setting is one entry in config/settings/*.js. Nothing else changes.

const { TYPES } = require('./settings/types');
const platform = require('./settings/platform');
const monetization = require('./settings/monetization');
const spaces = require('./settings/spaces');

// Grouped by module rather than flat-spread. The short names collide across
// modules — platform.RANKING vs spaces.RANKING, monetization.ANALYTICS vs
// spaces.ANALYTICS — and a flat merge silently drops one of each pair.
// `sections()` below still returns the flat list of section identifiers, which
// is what every consumer actually wants.
const SECTIONS = {
  platform: platform.SECTIONS,
  monetization: monetization.SECTIONS,
  spaces: spaces.SECTIONS,
};

const DECLARATIONS = [...platform.settings, ...monetization.settings, ...spaces.settings];

// Fail fast at require time on a malformed declaration — a typo here would
// otherwise surface as a silently unsaveable field in the admin portal.
const byKey = new Map();
for (const def of DECLARATIONS) {
  if (!def.key) throw new Error('Setting declaration is missing a key');
  if (byKey.has(def.key)) throw new Error(`Duplicate setting key: ${def.key}`);
  if (!TYPES[def.type]) throw new Error(`Unknown type "${def.type}" for setting ${def.key}`);
  if (!def.section) throw new Error(`Setting ${def.key} is missing a section`);
  if (def.default === undefined) throw new Error(`Setting ${def.key} is missing a default`);
  if (def.type === 'enum' && !Array.isArray(def.options)) {
    throw new Error(`Enum setting ${def.key} needs options`);
  }
  // A default that fails its own validation is always a bug.
  const invalid = TYPES[def.type].validate(def.default, def);
  if (invalid) throw new Error(`Default for ${def.key} is invalid: ${invalid}`);
  byKey.set(def.key, def);
}

const get = (key) => byKey.get(key) || null;

const has = (key) => byKey.has(key);

const all = () => DECLARATIONS;

const keys = () => [...byKey.keys()];

const bySection = (section) => DECLARATIONS.filter((def) => def.section === section);

const sections = () => [...new Set(DECLARATIONS.map((def) => def.section))];

const defaults = () => {
  const out = {};
  for (const def of DECLARATIONS) {
    out[def.key] = def.default;
  }
  return out;
};

const isPublic = (def) => Boolean(def.public) && !def.secret;

const publicKeys = () => DECLARATIONS.filter(isPublic).map((def) => def.key);

const secretKeys = () => DECLARATIONS.filter((def) => def.secret).map((def) => def.key);

// Coerce and validate a single value. Returns { ok, value } or { ok:false, error }.
const coerceAndValidate = (key, raw) => {
  const def = get(key);
  if (!def) return { ok: false, error: 'unknown setting' };
  const type = TYPES[def.type];
  const value = type.coerce(raw, def);
  if (value === null || value === undefined) {
    return { ok: false, error: `could not be read as ${def.type}` };
  }
  const error = type.validate(value, def);
  return error ? { ok: false, error } : { ok: true, value };
};

// Metadata the admin UI renders from. Secrets never expose their value.
const describe = (def) => ({
  key: def.key,
  section: def.section,
  type: def.type,
  label: def.label,
  help: def.help || '',
  unit: def.unit || null,
  default: def.secret ? null : def.default,
  min: def.min,
  max: def.max,
  maxLength: def.maxLength,
  maxItems: def.maxItems,
  options: def.options || null,
  public: isPublic(def),
  secret: Boolean(def.secret),
  envVar: def.envVar || null,
  requiresConfirmation: Boolean(def.requiresConfirmation),
  impact: def.impact || null,
  dependsOn: def.dependsOn || null,
  // Whether a community space owner may override this for their own space.
  // Site admins can force any key on any space regardless of this flag.
  spaceOverridable: Boolean(def.spaceOverridable),
});

// Backs the admin portal's settings search. Matching on label, help and key is
// what makes a surface of this size navigable.
const searchIndex = () =>
  DECLARATIONS.map((def) => ({
    key: def.key,
    section: def.section,
    label: def.label,
    haystack: `${def.key} ${def.label} ${def.help || ''}`.toLowerCase(),
  }));

module.exports = {
  SECTIONS,
  TYPES,
  get,
  has,
  all,
  keys,
  bySection,
  sections,
  defaults,
  publicKeys,
  secretKeys,
  coerceAndValidate,
  describe,
  searchIndex,
};
