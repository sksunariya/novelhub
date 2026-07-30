// Mongoose soft-delete plugin.
//
// Records are never removed from the database. "Deleting" only sets a
// `deletedAt` timestamp, and soft-deleted documents are automatically excluded
// from reads — normal queries, populate, and aggregation pipelines alike — so
// the rest of the app behaves as if they were gone while the data is preserved.
//
// Escape hatch: pass { withDeleted: true } as a query or aggregate option to
// include soft-deleted documents (for an admin trash view, restore flow, audit,
// etc.). Querying an explicit `deletedAt` condition also opts out of the filter.

const READ_OPS = [
  'count',
  'countDocuments',
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'distinct',
];

const softDeletePlugin = (schema) => {
  schema.add({ deletedAt: { type: Date, default: null } });
  schema.index({ deletedAt: 1 });

  schema.pre(READ_OPS, function applySoftDeleteFilter(next) {
    if ((this.getOptions() || {}).withDeleted) return next();
    // Respect an explicit deletedAt condition (e.g. querying the trash directly).
    if (this.getFilter().deletedAt === undefined) {
      this.where({ deletedAt: null });
    }
    next();
  });

  schema.pre('aggregate', function applySoftDeleteMatch(next) {
    if (this.options && this.options.withDeleted) return next();
    this.pipeline().unshift({ $match: { deletedAt: null } });
    next();
  });

  // Mark a loaded document as deleted.
  schema.methods.softDelete = function softDelete() {
    this.deletedAt = new Date();
    return this.save();
  };

  // Mark many documents as deleted in one shot (used for cascades).
  schema.statics.softDeleteMany = function softDeleteMany(filter = {}) {
    return this.updateMany(filter, { deletedAt: new Date() });
  };

  // Bring a soft-deleted document back.
  schema.statics.restoreById = function restoreById(id) {
    return this.updateOne({ _id: id }, { deletedAt: null });
  };
};

module.exports = softDeletePlugin;
