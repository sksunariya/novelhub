const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');
const softDelete = require('./plugins/softDelete');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 30 },
    fullName: { type: String, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: {
      type: String,
      minlength: 6,
      select: false,
      required: function () {
        return !this.googleId;
      },
    },
    googleId: { type: String },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    avatarUrl: { type: String, default: '' },
    banned: { type: Boolean, default: false },
    library: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Novel' }],
    // Monetization and audience targeting.
    country: { type: String, uppercase: true, maxlength: 2, default: '' },
    preferredCurrency: { type: String, uppercase: true, maxlength: 3, default: '' },
    lastActiveAt: { type: Date, default: null },
    // Set when a user with financial records is "deleted": PII is cleared but
    // orders and ledger rows are retained for tax and audit purposes.
    anonymizedAt: { type: Date, default: null },
    notificationPreferences: {
      emailMentions: { type: Boolean, default: true },
      emailReplies: { type: Boolean, default: true },
      emailChapters: { type: Boolean, default: true },
      emailAnnouncements: { type: Boolean, default: true },
      inAppMentions: { type: Boolean, default: true },
      inAppReplies: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  this.$locals.wasNew = this.isNew;
  if (this.isModified('password') && !this.$locals.passwordAlreadyHashed) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

// Provision a wallet centrally rather than at each of the four places a user
// can be created (signup, OTP-verified signup, Google sign-in, seed). Failure
// is non-fatal: creditService.getOrCreate provisions lazily as a backstop, so a
// wallet hiccup must never block a signup.
userSchema.post('save', async function provisionWallet() {
  if (!this.$locals.wasNew) return;
  try {
    // Required lazily to avoid a model-load cycle.
    const Wallet = require('./Wallet');
    await Wallet.getOrCreate(this._id);
  } catch (error) {
    console.error('[User] wallet provisioning failed:', error.message);
  }
});

userSchema.methods.comparePassword = function (candidate) {
  if (!this.password) {
    return Promise.resolve(false);
  }
  return bcrypt.compare(candidate, this.password);
};

// Uniqueness enforced only among non-deleted users, so a deleted account's
// username/email/googleId can be re-registered later.
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null, googleId: { $type: 'string' } } }
);
// Multikey index on the library array. Every chapter publish queries
// { library: novelId } to find who to notify, and the audience resolver's
// hasNovelInLibrary filter does the same — both were collection scans.
userSchema.index({ library: 1 });
// Audience targeting filters and sorts on activity.
userSchema.index({ lastActiveAt: -1 });

userSchema.plugin(softDelete);

module.exports = mongoose.model('User', userSchema);
