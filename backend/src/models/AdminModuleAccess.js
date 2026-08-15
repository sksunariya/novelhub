const mongoose = require('mongoose');
const { ADMIN_MODULE_IDS } = require('../config/constants');

/**
 * The global baseline for what an `admin` may see in the portal.
 *
 * A singleton, like SiteSettings: there is one portal, so there is one default
 * shape for it. Per-admin exceptions live on the User document as a sparse
 * override map, which keeps this collection from growing a row per admin and
 * makes "what did the superadmin decide for everyone" a single read.
 *
 * Modules absent from `modules` are visible. Storing only the decisions that
 * have actually been made means a module added in a later release is visible to
 * admins by default rather than silently hidden from everyone until someone
 * notices — and hiding it is then one explicit toggle.
 */
const adminModuleAccessSchema = new mongoose.Schema(
  {
    singleton: { type: Boolean, default: true, unique: true },

    // moduleId -> boolean. false hides the module from every admin.
    modules: {
      type: Map,
      of: Boolean,
      default: () => new Map(),
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/** Drops keys for modules that no longer exist, so stale ids cannot linger. */
adminModuleAccessSchema.methods.toModuleMap = function toModuleMap() {
  const out = {};
  for (const id of ADMIN_MODULE_IDS) {
    if (this.modules && this.modules.has(id)) out[id] = Boolean(this.modules.get(id));
  }
  return out;
};

adminModuleAccessSchema.statics.getDoc = async function getDoc() {
  let doc = await this.findOne({ singleton: true });
  if (!doc) {
    try {
      doc = await this.create({ singleton: true, modules: new Map() });
    } catch (error) {
      // Concurrent first access: on a cold deployment several admin requests
      // can all find nothing and all try to create. The unique index rejects
      // every loser, which then reads the winner's document rather than
      // throwing a duplicate-key error up through an unrelated request.
      // Same hazard and same handling as SiteSettings.getSettings.
      if (error.code !== 11000) throw error;
      doc = await this.findOne({ singleton: true });
    }
  }
  return doc;
};

module.exports = mongoose.model('AdminModuleAccess', adminModuleAccessSchema);
