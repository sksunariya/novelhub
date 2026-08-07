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
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (this.isModified('password') && !this.$locals.passwordAlreadyHashed) {
    this.password = await bcrypt.hash(this.password, 10);
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

userSchema.plugin(softDelete);

module.exports = mongoose.model('User', userSchema);
