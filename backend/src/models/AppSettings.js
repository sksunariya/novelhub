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

/** Stored overrides as a plain object, keyed by the dotted setting key. */
appSettingsSchema.methods.toObjectMap = function toObjectMap() {
  const out = {};
  for (const entry of this.values || []) {
    out[entry.key] = entry.value;
  }
  return out;
};

appSettingsSchema.methods.getValue = function getValue(key) {
  const entry = (this.values || []).find((row) => row.key === key);
  return entry ? entry.value : undefined;
};

appSettingsSchema.methods.hasValue = function hasValue(key) {
  return (this.values || []).some((row) => row.key === key);
};

appSettingsSchema.methods.setValue = function setValue(key, value) {
  const entry = (this.values || []).find((row) => row.key === key);
  if (entry) {
    entry.value = value;
    this.markModified('values');
  } else {
    this.values.push({ key, value });
  }
};

appSettingsSchema.methods.deleteValue = function deleteValue(key) {
  const before = this.values.length;
  this.values = this.values.filter((row) => row.key !== key);
  if (this.values.length !== before) this.markModified('values');
};

appSettingsSchema.statics.getDoc = async function getDoc() {
  let doc = await this.findOne({ singleton: true });
  if (!doc) {
    try {
      doc = await this.create({ singleton: true });
    } catch (error) {
      // Concurrent first boot across instances: the unique index rejects the
      // loser, which then reads the winner's document.
      if (error.code !== 11000) throw error;
      doc = await this.findOne({ singleton: true });
    }
  }
  return doc;
};

module.exports = mongoose.model('AppSettings', appSettingsSchema);
