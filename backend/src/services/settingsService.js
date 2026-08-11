// Settings service.
//
// Reads go through an in-process cache so that adding configuration does not
// add database round trips. `SiteSettings.getSettings()` is currently called on
// every /api request via the maintenance guard, and again inside readChapter
// and dispatchNotification — this service deliberately does not repeat that
// pattern.
//
// Cache invalidation is a version poll: at most one lightweight projection
// query per REVALIDATE_MS per instance, regardless of request volume. That
// keeps multiple instances converging within a few seconds of a change without
// needing a message bus.

const registry = require('../config/settingsRegistry');
const AppSettings = require('../models/AppSettings');
const AdminAuditLog = require('../models/AdminAuditLog');

const REVALIDATE_MS = Number(process.env.SETTINGS_CACHE_MS || 5000);

let cache = null; // { values, version, checkedAt }

// Key-order-stable comparison. JSON settings arriving from the admin form can
// serialize their keys in a different order than the declared default, and a
// naive JSON.stringify compare would then persist an override identical to the
// default and mislabel the row as changed.
const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sameValue = (a, b) => stableStringify(a) === stableStringify(b);

const readEnvOverride = (def) => {
  if (!def.envVar) return undefined;
  const raw = process.env[def.envVar];
  if (raw === undefined || raw === '') return undefined;
  const result = registry.coerceAndValidate(def.key, raw);
  return result.ok ? result.value : undefined;
};

// Resolution order: environment variable (secrets, deploy-time config) →
// stored override → registry default.
const materialize = (stored = {}) => {
  const values = {};
  for (const def of registry.all()) {
    const fromEnv = readEnvOverride(def);
    if (fromEnv !== undefined) {
      values[def.key] = fromEnv;
      continue;
    }
    const override = stored[def.key];
    values[def.key] = override === undefined ? def.default : override;
  }
  return values;
};

const loadFresh = async () => {
  const doc = await AppSettings.getDoc();
  cache = {
    values: materialize(doc.toObjectMap()),
    version: doc.version,
    checkedAt: Date.now(),
  };
  return cache;
};

const ensureFresh = async () => {
  if (!cache) return loadFresh();
  if (Date.now() - cache.checkedAt < REVALIDATE_MS) return cache;
  const current = await AppSettings.findOne({ singleton: true }).select('version').lean();
  cache.checkedAt = Date.now();
  if (!current || current.version === cache.version) return cache;
  return loadFresh();
};

/**
 * One await per request, then synchronous reads. Avoids the N-awaits-per-request
 * pattern that would otherwise come with a large configuration surface.
 */
const snapshot = async () => {
  const { values, version } = await ensureFresh();
  return {
    version,
    get: (key) => {
      if (!registry.has(key)) throw new Error(`Unknown setting: ${key}`);
      return values[key];
    },
    section: (section) =>
      registry.bySection(section).reduce((acc, def) => {
        acc[def.key] = def.secret ? undefined : values[def.key];
        return acc;
      }, {}),
    all: () => ({ ...values }),
  };
};

const get = async (key) => (await snapshot()).get(key);

const getMany = async (keys) => {
  const snap = await snapshot();
  return keys.reduce((acc, key) => {
    acc[key] = snap.get(key);
    return acc;
  }, {});
};

/** Whitelisted projection for unauthenticated clients. Secrets can never appear. */
const getPublic = async () => {
  const { values } = await ensureFresh();
  const out = {};
  for (const key of registry.publicKeys()) {
    out[key] = values[key];
  }
  return out;
};

/** Admin read: full values, secrets replaced with a configured/not-configured flag. */
const getForAdmin = async (section = null) => {
  const { values } = await ensureFresh();
  const defs = section ? registry.bySection(section) : registry.all();
  return defs.map((def) => ({
    ...registry.describe(def),
    value: def.secret ? undefined : values[def.key],
    configured: def.secret ? Boolean(values[def.key]) : undefined,
    isDefault: def.secret ? undefined : sameValue(values[def.key], def.default),
  }));
};

/**
 * Apply a patch of { key: rawValue }.
 *
 * Validates every key first and rejects the whole patch if any fail, so a
 * settings form never half-saves. Values equal to the registry default are
 * removed from storage rather than persisted.
 */
const update = async (patch, { actor = null, ip = '', userAgent = '', note = '' } = {}) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw Object.assign(new Error('A settings object is required'), { status: 400 });
  }
  const entries = Object.entries(patch);
  if (!entries.length) {
    throw Object.assign(new Error('No settings supplied'), { status: 400 });
  }

  const errors = {};
  const accepted = [];
  for (const [key, raw] of entries) {
    const def = registry.get(key);
    if (!def) {
      errors[key] = 'unknown setting';
      continue;
    }
    if (def.secret) {
      errors[key] = `is set through the ${def.envVar || 'environment'} environment variable`;
      continue;
    }
    const result = registry.coerceAndValidate(key, raw);
    if (!result.ok) {
      errors[key] = result.error;
      continue;
    }
    accepted.push({ def, key, value: result.value });
  }

  if (Object.keys(errors).length) {
    throw Object.assign(new Error('Some settings are invalid'), { status: 400, errors });
  }

  const doc = await AppSettings.getDoc();
  const before = materialize(doc.toObjectMap());
  const changes = [];

  for (const { def, key, value } of accepted) {
    if (sameValue(before[key], value)) continue;
    changes.push({ key, before: before[key], after: value });
    if (sameValue(value, def.default)) {
      doc.deleteValue(key); // back to default: stop persisting an override
    } else {
      doc.setValue(key, value);
    }
  }

  if (!changes.length) {
    return { changed: 0, version: doc.version, settings: await getForAdmin() };
  }

  doc.version += 1;
  await doc.save();
  cache = null; // this instance reloads immediately; others within REVALIDATE_MS

  await AdminAuditLog.create({
    actor: actor ? actor._id : null,
    actorLabel: actor ? actor.username || actor.email || '' : 'system',
    action: 'settings.update',
    entity: 'setting',
    entityId: changes.length === 1 ? changes[0].key : '',
    changes,
    note,
    ip,
    userAgent,
  });

  return { changed: changes.length, version: doc.version, changes };
};

/** Reset keys to their registry defaults. */
const reset = async (keys, context = {}) => {
  const unknown = keys.filter((key) => !registry.has(key));
  if (unknown.length) {
    throw Object.assign(new Error(`Unknown setting(s): ${unknown.join(', ')}`), { status: 400 });
  }
  const patch = keys.reduce((acc, key) => {
    acc[key] = registry.get(key).default;
    return acc;
  }, {});
  return update(patch, { ...context, note: context.note || 'reset to default' });
};

/** Test seam — drops the cache so a test can assert a fresh read. */
const clearCache = () => {
  cache = null;
};

module.exports = {
  snapshot,
  get,
  getMany,
  getPublic,
  getForAdmin,
  update,
  reset,
  clearCache,
  registry,
};
