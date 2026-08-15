// The single choke point for every community authorization decision.
//
// WHY ONE PLACE: role checks scattered across controllers are how IDOR bugs and
// shadowban leaks happen. A shadowbanned user's content must be invisible in
// the feed AND in search AND in notifications AND on a direct link — four
// separate checks is four chances to miss one. Controllers call `resolve()`
// once and read a boolean.
//
// It is also what makes the permission matrix testable as a table. That test is
// the highest-value test in the project; a gap in it is a security hole.
//
// NEVER cache a result from here beyond the current request. A ban that takes
// 60 seconds to apply is a ban that does not work. `cacheService.requestScope`
// exists for exactly this.

const settingsService = require('../settingsService');
const registry = require('../../config/settingsRegistry');
const {
  ROLES,
  SPACE_VISIBILITY,
  SPACE_STATUS,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_STATUS,
  SPACE_CREATION_MODES,
  SPACE_CREATION_POLICY,
} = require('../../config/constants');

const NO_PERMISSIONS = {
  view: false,
  post: false,
  comment: false,
  vote: false,
  managePosts: false,
  manageMembers: false,
  manageSettings: false,
  manageFlair: false,
  manageRules: false,
  manageMods: false,
  viewModlog: false,
  deleteSpace: false,
};

const ALL_PERMISSIONS = Object.keys(NO_PERMISSIONS).reduce(
  (acc, key) => ({ ...acc, [key]: true }),
  {}
);

const isAdmin = (user) => Boolean(user && user.role === ROLES.ADMIN);

const isCommunityBanned = (user) =>
  Boolean(user && user.communityBannedUntil && user.communityBannedUntil > new Date());

/**
 * Resolve what this actor may do in this space.
 *
 * @param {object|null} user        the actor, or null when signed out
 * @param {object} space            a Space document
 * @param {object|null} membership  their SpaceMember row, if any
 * @returns {object} flags plus a `can` map
 */
const resolve = (user, space, membership = null) => {
  const base = {
    isAdmin: isAdmin(user),
    isOwner: false,
    isModerator: false,
    isMember: false,
    isBanned: false,
    isMuted: false,
    isPending: false,
    reason: null,
    can: { ...NO_PERMISSIONS },
  };

  if (!space) return base;

  // Site admin short-circuits everything. This is deliberate and is what "the
  // admin controls every single thing" means concretely — an admin is never
  // blocked by a space's own rules, including a ban imposed on them by a
  // moderator.
  if (base.isAdmin) {
    return { ...base, can: { ...ALL_PERMISSIONS }, isModerator: true };
  }

  // A site-wide community ban outranks everything below, including ownership.
  if (isCommunityBanned(user)) {
    return { ...base, isBanned: true, reason: 'community_banned' };
  }

  const status = membership ? membership.status : null;
  const role = membership ? membership.role : null;

  base.isOwner = role === SPACE_MEMBER_ROLES.OWNER;
  base.isModerator =
    base.isOwner || (role === SPACE_MEMBER_ROLES.MODERATOR && status === SPACE_MEMBER_STATUS.ACTIVE);
  base.isMember = Boolean(membership) && status === SPACE_MEMBER_STATUS.ACTIVE;
  base.isPending = status === SPACE_MEMBER_STATUS.PENDING;

  // A ban whose expiry has passed but which the sweep job has not cleared yet
  // must not still block. Read the date, not just the status.
  base.isBanned =
    status === SPACE_MEMBER_STATUS.BANNED &&
    (!membership.bannedUntil || membership.bannedUntil > new Date());
  base.isMuted = Boolean(membership && membership.mutedUntil && membership.mutedUntil > new Date());

  // --- view ---------------------------------------------------------------
  // Banned users can still READ a public space. Hiding it achieves nothing —
  // they can sign out and see the same page — and it makes an appeal harder to
  // write. Private spaces are the exception.
  const bannedSpace = space.status === SPACE_STATUS.BANNED;
  const isDeleted = Boolean(space.deletedAt);

  if (!isDeleted && !bannedSpace) {
    if (space.visibility === SPACE_VISIBILITY.PRIVATE) {
      base.can.view = base.isMember || base.isModerator;
    } else {
      base.can.view = true;
    }
  }
  if (space.status === SPACE_STATUS.QUARANTINED) {
    // Reachable by direct link with an interstitial, but not surfaced. The
    // feed layer applies that; view stays true so the interstitial can render.
    base.can.view = base.can.view && true;
  }
  if (space.status === SPACE_STATUS.PENDING) {
    // A space awaiting approval is visible only to its creator.
    base.can.view = base.isOwner;
  }

  if (!base.can.view) {
    base.reason = base.reason || 'not_visible';
    return base;
  }

  // --- write --------------------------------------------------------------
  const writable = space.status === SPACE_STATUS.ACTIVE && !space.locked;

  if (!writable) base.reason = space.locked ? 'space_locked' : `space_${space.status}`;
  else if (base.isBanned) base.reason = 'banned';
  else if (base.isMuted) base.reason = 'muted';
  else if (!user) base.reason = 'not_signed_in';

  const canWrite = Boolean(user) && writable && !base.isBanned && !base.isMuted;

  if (canWrite) {
    // Restricted spaces: anyone reads, only approved members post.
    const restricted = space.visibility === SPACE_VISIBILITY.RESTRICTED;
    const mayPost = restricted ? base.isMember || base.isModerator : true;

    base.can.post = mayPost;
    base.can.comment = mayPost;
    base.can.vote = true;
  }

  // --- moderation ---------------------------------------------------------
  // Moderator powers survive `locked` — locking a space is precisely when its
  // moderators most need to act — but not `archived` or `banned`.
  const modActive = base.isModerator && space.status !== SPACE_STATUS.BANNED && !isDeleted;

  if (modActive) {
    const has = (permission) =>
      base.isOwner || Boolean(membership && membership.permissions && membership.permissions[permission]);

    base.can.managePosts = has('managePosts');
    base.can.manageMembers = has('manageMembers');
    base.can.manageSettings = has('manageSettings');
    base.can.manageFlair = has('manageFlair');
    base.can.manageRules = has('manageRules');
    base.can.manageMods = has('manageMods');
    base.can.viewModlog = true;
    base.can.deleteSpace = base.isOwner;
  }

  // A space that opts into a public mod log shows it to everyone who can see
  // the space — that is the entire point of opting in.
  if (space.publicModlog && base.can.view) base.can.viewModlog = true;

  return base;
};

/**
 * Resolve a setting for a space: sparse override, else the global value.
 *
 * Returns a reader with the same `get(key)` shape as
 * `settingsService.snapshot()`, so a controller reads one interface regardless
 * of where the value came from.
 */
const spaceSettings = async (space) => {
  const snapshot = await settingsService.snapshot();
  const overrides = (space && space.overrides) || {};

  return {
    get: (key) => (overrides[key] !== undefined ? overrides[key] : snapshot.get(key)),
    isOverridden: (key) => overrides[key] !== undefined,
    global: (key) => snapshot.get(key),
    all: () => ({ ...snapshot.all(), ...overrides }),
  };
};

/**
 * Validate an override patch from a space owner.
 *
 * Only keys flagged `spaceOverridable` are accepted, and every value goes
 * through the registry's own coercion and validation — the same path the admin
 * settings form uses. An admin bypasses the flag check but not the validation.
 *
 * Rejects the whole patch if any key fails, so a settings form never
 * half-saves. This mirrors settingsService.update deliberately.
 */
const validateOverrides = (patch, { asAdmin = false } = {}) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: { _: 'A settings object is required' } };
  }

  const errors = {};
  const accepted = {};

  for (const [key, raw] of Object.entries(patch)) {
    const def = registry.get(key);
    if (!def) {
      errors[key] = 'unknown setting';
      continue;
    }
    if (def.secret) {
      errors[key] = 'cannot be set per space';
      continue;
    }
    if (!asAdmin && !def.spaceOverridable) {
      errors[key] = 'cannot be changed for a single space';
      continue;
    }
    const result = registry.coerceAndValidate(key, raw);
    if (!result.ok) {
      errors[key] = result.error;
      continue;
    }
    accepted[key] = result.value;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: accepted };
};

/** Every key a space owner is allowed to change, for the settings UI. */
const overridableKeys = () =>
  registry
    .all()
    .filter((def) => def.spaceOverridable)
    .map((def) => registry.describe(def));

/**
 * May this user create a space?
 *
 * Resolution order, most specific first — an admin can grant or revoke for one
 * person without changing the global policy:
 *
 *   community ban          -> denied
 *   per-user 'never'       -> denied
 *   per-user 'always'      -> allowed, bypasses every gate below
 *   otherwise the mode     -> open | karma_gated | approval | admin_only
 *   then, in every case    -> cooldown, owned cap, site-wide cap
 *
 * `reason` is shown to the user. A blocked person gets told why rather than
 * seeing a dead button.
 *
 * @param {object} user
 * @param {object} context  { ownedCount, totalSpaces, lastCreatedAt, emailVerified }
 */
const canCreateSpace = async (user, context = {}) => {
  const deny = (reason, message) => ({ allowed: false, requiresApproval: false, reason, message });

  if (!user) return deny('not_signed_in', 'Sign in to create a space');
  if (user.banned) return deny('banned', 'Your account is suspended');
  if (isCommunityBanned(user)) {
    return deny('community_banned', 'You are banned from the community');
  }

  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) {
    return deny('disabled', 'The community is not available right now');
  }

  const policy = (user.spaceCreation && user.spaceCreation.policy) || SPACE_CREATION_POLICY.DEFAULT;
  if (policy === SPACE_CREATION_POLICY.NEVER) {
    return deny('revoked', 'Space creation has been disabled for your account');
  }

  const {
    ownedCount = 0,
    totalSpaces = 0,
    lastCreatedAt = null,
    emailVerified = true,
  } = context;

  // Caps and cooldown apply to EVERYONE, including an explicit 'always' grant
  // and including admins — they exist to protect the system, not to gate
  // permission. An admin who genuinely needs to exceed them changes the setting.
  const maxPerUser = snapshot.get('spaces.creation.maxPerUser');
  if (maxPerUser > 0 && ownedCount >= maxPerUser) {
    return deny('own_limit', `You can own up to ${maxPerUser} spaces`);
  }

  const maxTotal = snapshot.get('spaces.creation.maxTotalSpaces');
  if (maxTotal > 0 && totalSpaces >= maxTotal) {
    return deny('site_limit', 'No new spaces can be created right now');
  }

  const cooldownHours = snapshot.get('spaces.creation.cooldownHours');
  if (cooldownHours > 0 && lastCreatedAt) {
    const readyAt = new Date(lastCreatedAt.getTime() + cooldownHours * 3600_000);
    if (readyAt > new Date()) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: 'cooldown',
        message: `You can create another space after ${readyAt.toISOString()}`,
        readyAt,
      };
    }
  }

  const allow = (requiresApproval = false) => ({
    allowed: true,
    requiresApproval,
    reason: null,
    message: null,
  });

  if (policy === SPACE_CREATION_POLICY.ALWAYS) return allow(false);
  if (isAdmin(user)) return allow(false);

  const mode = snapshot.get('spaces.creation.mode');

  if (mode === SPACE_CREATION_MODES.ADMIN_ONLY) {
    return deny('admin_only', 'Only administrators can create spaces right now');
  }

  if (snapshot.get('spaces.creation.requireVerifiedEmail') && !emailVerified) {
    return deny('email_unverified', 'Verify your email address first');
  }

  const minAgeHours = snapshot.get('spaces.creation.minAccountAgeHours');
  if (minAgeHours > 0) {
    const eligibleAt = new Date(new Date(user.createdAt).getTime() + minAgeHours * 3600_000);
    if (eligibleAt > new Date()) {
      return deny('account_too_new', `Your account must be at least ${minAgeHours} hours old`);
    }
  }

  if (mode === SPACE_CREATION_MODES.OPEN) return allow(false);

  const karma = (user.karma && user.karma.total) || 0;

  if (mode === SPACE_CREATION_MODES.KARMA_GATED) {
    const minKarma = snapshot.get('spaces.creation.minKarma');
    if (karma < minKarma) {
      return deny('karma', `You need ${minKarma} karma to create a space — you have ${karma}`);
    }
    return allow(false);
  }

  if (mode === SPACE_CREATION_MODES.APPROVAL) {
    const autoApproveAt = snapshot.get('spaces.creation.autoApproveAboveKarma');
    if (autoApproveAt > 0 && karma >= autoApproveAt) return allow(false);
    return allow(true);
  }

  return deny('unknown_mode', 'Space creation is unavailable');
};

module.exports = {
  resolve,
  spaceSettings,
  validateOverrides,
  overridableKeys,
  canCreateSpace,
  isCommunityBanned,
  NO_PERMISSIONS,
  ALL_PERMISSIONS,
};
