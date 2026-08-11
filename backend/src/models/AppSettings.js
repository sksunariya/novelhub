const mongoose = require('mongoose');

// Registry-backed settings store.
//
// Values are an array of { key, value } pairs rather than a Map or a nested
// object, because every registry key is dotted (`credits.perUsd`) and Mongoose
// Maps reject keys containing "." outright. Storing them as document fields
// would hit the same problem from the other direction — dotted field names
// collide with Mongo's own path syntax on any update.
//
// An array sidesteps both, stays queryable, and keeps the flat dotted key as
// the single identifier used by the registry, the audit log and the admin UI.
//
// Only values that differ from the registry default are persisted, so this
// stays small and changing a default in code still reaches everyone who never
// overrode it.
const settingValueSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const appSettingsSchema = new mongoose.Schema(
  {
    singleton: { type: Boolean, default: true, unique: true },
    values: { type: [settingValueSchema], default: [] },
    // Incremented on every write; running instances poll this to invalidate
    // their caches without needing a message bus.
    version: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false }
);

// Every accessor tolerates a malformed row rather than throwing. A single bad
// entry left by an older schema should not take down the settings page — the
// repair in getDoc cleans it up, and until then nothing here crashes.
const rows = (doc) => (doc.values || []).filter((row) => row && typeof row.key === 'string');

/** Stored overrides as a plain object, keyed by the dotted setting key. */
appSettingsSchema.methods.toObjectMap = function toObjectMap() {
  const out = {};
  for (const entry of rows(this)) {
    out[entry.key] = entry.value;
  }
  return out;
};

appSettingsSchema.methods.getValue = function getValue(key) {
  const entry = rows(this).find((row) => row.key === key);
  return entry ? entry.value : undefined;
};

appSettingsSchema.methods.hasValue = function hasValue(key) {
  return rows(this).some((row) => row.key === key);
};

appSettingsSchema.methods.setValue = function setValue(key, value) {
  if (typeof key !== 'string' || !key) throw new Error('setValue requires a setting key');
  const entry = rows(this).find((row) => row.key === key);
  if (entry) {
    entry.value = value;
    this.markModified('values');
  } else {
    this.values.push({ key, value });
  }
};

appSettingsSchema.methods.deleteValue = function deleteValue(key) {
  const before = this.values.length;
  this.values = rows(this).filter((row) => row.key !== key);
  if (this.values.length !== before) this.markModified('values');
};

/**
 * Repair a document written before `values` became an array.
 *
 * This field was originally a Map keyed by setting name. Mongoose casts a
 * stored object into the array schema as a single subdocument with no `key`,
 * which passes on read and then fails *every* subsequent save with
 * "Path `key` is required." — so the settings page loads fine and saving is
 * permanently broken, with an error that points at nothing the admin did.
 *
 * Runs against the raw collection deliberately: going through the model would
 * hand back the already-mangled cast, losing the values we are trying to keep.
 * Returns true when it changed something.
 */
const repairValues = async (model) => {
  const raw = await model.collection.findOne({ singleton: true });
  if (!raw) return false;

  let repaired;
  if (!Array.isArray(raw.values)) {
    // The legacy Map/object shape: { 'credits.perUsd': 200 } → [{key, value}].
    repaired =
      raw.values && typeof raw.values === 'object'
        ? Object.entries(raw.values).map(([key, value]) => ({ key, value }))
        : [];
  } else {
    // Already an array, but drop anything keyless or null — one bad entry
    // blocks saving everything else.
    const clean = raw.values.filter((row) => row && typeof row.key === 'string' && row.key.length);
    if (clean.length === raw.values.length) return false;
    repaired = clean;
  }

  await model.collection.updateOne({ _id: raw._id }, { $set: { values: repaired } });
  console.warn(`[AppSettings] repaired a malformed values field (${repaired.length} setting(s) kept)`);
  return true;
};

appSettingsSchema.statics.getDoc = async function getDoc() {
  let doc = await this.findOne({ singleton: true });

  if (doc && !doc.validateSync()) return doc;

  if (doc) {
    // Only pay for the raw read when the document is actually invalid.
    await repairValues(this);
    doc = await this.findOne({ singleton: true });
    return doc;
  }

  try {
    doc = await this.create({ singleton: true });
  } catch (error) {
    // Concurrent first boot across instances: the unique index rejects the
    // loser, which then reads the winner's document.
    if (error.code !== 11000) throw error;
    doc = await this.findOne({ singleton: true });
  }
  return doc;
};

appSettingsSchema.statics.repairValues = repairValues;

module.exports = mongoose.model('AppSettings', appSettingsSchema);
