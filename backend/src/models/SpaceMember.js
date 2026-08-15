const mongoose = require('mongoose');
const { SPACE_MEMBER_ROLES, SPACE_MEMBER_STATUS } = require('../config/constants');

// Membership, and per-space authority.
//
// Deliberately NOT an array on Space or on User. A popular space has hundreds
// of thousands of members; an array would rewrite the whole document on every
// join and hit the 16 MB ceiling. See docs/spaces/scalability.md §4.3.
//
// No softDelete plugin: leaving a space is a real removal, and the row carries
// no history worth preserving. A BAN is different — that row stays, with
// status 'banned', because a ban that disappears when someone leaves is not a
// ban.

const spaceMemberSchema = new mongoose.Schema(
  {
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    // Future shard key: { user: 'hashed' }. "My spaces" is the hot query and
    // drives the home feed, so it must stay on a single shard.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    role: {
      type: String,
      enum: Object.values(SPACE_MEMBER_ROLES),
      default: SPACE_MEMBER_ROLES.MEMBER,
    },
    status: {
      type: String,
      enum: Object.values(SPACE_MEMBER_STATUS),
      default: SPACE_MEMBER_STATUS.ACTIVE,
    },

    // Granular, and only meaningful for moderators. A single role enum forces
    // every mod to be all-powerful, which is exactly how community moderation
    // goes wrong — the owner of a large space wants a flair moderator who
    // cannot ban people.
    permissions: {
      managePosts: { type: Boolean, default: false },
      manageMembers: { type: Boolean, default: false },
      manageSettings: { type: Boolean, default: false },
      manageFlair: { type: Boolean, default: false },
      manageRules: { type: Boolean, default: false },
      manageMods: { type: Boolean, default: false },
    },

    flair: { type: mongoose.Schema.Types.ObjectId, ref: 'Flair', default: null },
    flairText: { type: String, default: '', maxlength: 64 },

    // Reputation earned inside this space specifically, separate from site-wide
    // karma. Lets a space gate on local standing rather than global popularity.
    karma: { type: Number, default: 0 },

    // null while status is 'banned' means permanent. The expireBans job clears
    // status when the date passes.
    bannedUntil: { type: Date, default: null },
    banReason: { type: String, default: '', maxlength: 1000 },
    bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    bannedAt: { type: Date, default: null },
    mutedUntil: { type: Date, default: null },

    // Moderator-visible notes about this member. Not shown to the member.
    notes: [
      {
        _id: false,
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: { type: String, maxlength: 1000 },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    joinedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: null },
    // How many posts this member has had approved. Drives the new-user approval
    // queue, which releases someone after N accepted posts.
    approvedPostCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One membership per user per space. This unique index is what makes join
// idempotent under a double-click.
spaceMemberSchema.index({ space: 1, user: 1 }, { unique: true });
// "My spaces" and "spaces I moderate" — the home feed's source set.
spaceMemberSchema.index({ user: 1, status: 1, space: 1 });
spaceMemberSchema.index({ user: 1, role: 1 });
// Mod list, ban list, member list.
spaceMemberSchema.index({ space: 1, role: 1, status: 1 });
// Per-space leaderboard.
spaceMemberSchema.index({ space: 1, karma: -1 });
// Ban and mute expiry sweeps. Sparse: almost every row has neither.
spaceMemberSchema.index({ bannedUntil: 1 }, { sparse: true });
spaceMemberSchema.index({ mutedUntil: 1 }, { sparse: true });

/** Is this membership currently banned? Handles the expiry the job has not swept yet. */
spaceMemberSchema.methods.isBanned = function isBanned() {
  if (this.status !== SPACE_MEMBER_STATUS.BANNED) return false;
  if (!this.bannedUntil) return true; // permanent
  return this.bannedUntil > new Date();
};

spaceMemberSchema.methods.isMuted = function isMuted() {
  return Boolean(this.mutedUntil && this.mutedUntil > new Date());
};

spaceMemberSchema.methods.isModerator = function isModerator() {
  return (
    this.role === SPACE_MEMBER_ROLES.MODERATOR || this.role === SPACE_MEMBER_ROLES.OWNER
  );
};

/**
 * Does this member hold a specific moderator permission?
 *
 * An owner holds all of them implicitly — an owner who could lock themselves
 * out of their own space by clearing a checkbox is a support ticket waiting to
 * happen.
 */
spaceMemberSchema.methods.hasPermission = function hasPermission(permission) {
  if (this.role === SPACE_MEMBER_ROLES.OWNER) return true;
  if (this.role !== SPACE_MEMBER_ROLES.MODERATOR) return false;
  return Boolean(this.permissions && this.permissions[permission]);
};

/** Every permission — what a newly promoted moderator gets unless narrowed. */
spaceMemberSchema.statics.fullPermissions = () => ({
  managePosts: true,
  manageMembers: true,
  manageSettings: false, // deliberately not default: settings change the space itself
  manageFlair: true,
  manageRules: false,
  manageMods: false, // a mod who can appoint mods can take over a space
});

module.exports = mongoose.model('SpaceMember', spaceMemberSchema);
