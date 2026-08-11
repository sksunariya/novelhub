const mongoose = require('mongoose');

// Audit trail of fetched exchange rates. Keeps the admin rate-history chart
// honest and makes "why was this order priced that way" answerable months later.
const fxRateSnapshotSchema = new mongoose.Schema(
  {
    base: { type: String, default: 'USD' },
    provider: { type: String, default: '' },
    rates: { type: Map, of: Number, default: () => new Map() },
    fetchedAt: { type: Date, default: Date.now },
    ok: { type: Boolean, default: true },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

fxRateSnapshotSchema.index({ fetchedAt: -1 });

module.exports = mongoose.model('FxRateSnapshot', fxRateSnapshotSchema);
