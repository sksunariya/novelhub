const mongoose = require('mongoose');

// Distributed lock so a scheduled job runs once across the whole fleet.
//
// Without this, every instance runs every cron. For FX refresh that is merely
// wasteful; for grant campaigns and subscription cycle credits it means paying
// out twice.
const jobLockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // job name
    lockedUntil: { type: Date, required: true },
    owner: { type: String, default: '' }, // instance id, for debugging
    acquiredAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

/**
 * Claim a job, or return null if another instance holds it.
 *
 * The upsert plus the `lockedUntil` condition is what makes this atomic: two
 * instances racing produce exactly one winner, because the loser's update
 * matches no document and its upsert collides on the primary key.
 */
jobLockSchema.statics.acquire = async function acquire(name, ttlMs, owner) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  try {
    const claimed = await this.findOneAndUpdate(
      { _id: name, lockedUntil: { $lte: now } },
      { $set: { lockedUntil: until, owner, acquiredAt: now } },
      { new: true }
    );
    if (claimed) return claimed;

    // No expired lock to take over — try to create one. A duplicate key here
    // means somebody else already holds it.
    return await this.create({ _id: name, lockedUntil: until, owner, acquiredAt: now });
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
};

/** Extend a held lock, for jobs that outlive their initial TTL. */
jobLockSchema.statics.renew = function renew(name, ttlMs, owner) {
  return this.findOneAndUpdate(
    { _id: name, owner },
    { $set: { lockedUntil: new Date(Date.now() + ttlMs) } },
    { new: true }
  );
};

/** Release early so a retry does not have to wait out the TTL. */
jobLockSchema.statics.release = function release(name, owner) {
  return this.updateOne({ _id: name, owner }, { $set: { lockedUntil: new Date(0) } });
};

module.exports = mongoose.model('JobLock', jobLockSchema);
