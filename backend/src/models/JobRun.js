const mongoose = require('mongoose');

// Execution history, so "did the trending reset actually run last night" is a
// question the admin portal can answer.
const jobRunSchema = new mongoose.Schema(
  {
    job: { type: String, required: true },
    status: { type: String, enum: ['running', 'success', 'failed', 'skipped'], default: 'running' },
    trigger: { type: String, enum: ['schedule', 'manual', 'startup'], default: 'schedule' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, default: '' },
    owner: { type: String, default: '' },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: false }
);

jobRunSchema.index({ job: 1, startedAt: -1 });
jobRunSchema.index({ startedAt: -1 });
jobRunSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model('JobRun', jobRunSchema);
