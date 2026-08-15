// Space lifecycle: creation, settings, membership, moderators, ownership.
//
// Controllers stay thin and do HTTP; this holds the rules. Nothing here reaches
// into another community module's collections directly — cross-module access
// goes through the owning module's functions, which is what keeps a later
// service extraction a possibility rather than a rewrite.

const crypto = require('crypto');
const Space = require('../../models/Space');
const SpaceMember = require('../../models/SpaceMember');
const Flair = require('../../models/Flair');
const settingsService = require('../settingsService');
const counterService = require('../counterService');
const cacheService = require('../cacheService');
const permissions = require('./spacePermissionService');
const sanitizeHtml = require('../../utils/sanitizeHtml');
const { validateSlug } = require('../../utils/slugSafety');
const { validateAccent } = require('../../utils/colorContrast');
const {
  SPACE_STATUS,
  SPACE_VISIBILITY,
  SPACE_JOIN_POLICY,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_STATUS,
} = require('../../config/constants');

const fail = (message, status = 400, details = null) =>
  Object.assign(new Error(message), { status, details });

/** Load a space by slug, or throw a 404 that does not confirm existence. */
const bySlug = async (slug) => {
  const space = await Space.findOne({ slug: String(slug || '').toLowerCase() });
  if (!space) throw fail('Space not found', 404);
  return space;
};

/** Load by id. Used where the caller already has a post and needs its space. */
const bySlugId = async (spaceId) => {
  const space = await Space.findById(spaceId);
  if (!space) throw fail('Space not found', 404);
  return space;
};

/** The membership row for this user in this space, or null. */
const membershipFor = async (space, user) => {
  if (!user) return null;
  return SpaceMember.findOne({ space: space._id, user: user._id });
};

/**
 * Load a space and resolve permissions in one step.
 *
 * Every controller starts here. Memoized per request so a handler that needs
 * permissions twice does not query twice — and never cached beyond the request,
 * because a ban that takes 60 seconds to apply is not a ban.
 */
const loadForActor = async (slug, user, req = null) => {
  const space = await bySlug(slug);
  const membership = await cacheService.requestScope(req, `member:${space._id}:${user?._id}`, () =>
    membershipFor(space, user)
  );
  const perms = permissions.resolve(user, space, membership);
  if (!perms.can.view) throw fail('Space not found', 404);
  return { space, membership, perms };
};

// --------------------------------------------------------------- creation

/**
 * Create a space.
 *
 * The gate is resolved by spacePermissionService.canCreateSpace, which is where
 * the per-user override, the mode, and the caps all live. This function only
 * enforces what it uniquely knows: the name is valid and not confusable.
 */
const create = async (user, input = {}) => {
  const [ownedCount, totalSpaces, lastOwned] = await Promise.all([
    Space.countDocuments({ owner: user._id, status: { $ne: SPACE_STATUS.REJECTED } }),
    Space.estimatedDocumentCount(),
    Space.findOne({ owner: user._id }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);

  const gate = await permissions.canCreateSpace(user, {
    ownedCount,
    totalSpaces,
    lastCreatedAt: lastOwned ? lastOwned.createdAt : null,
    emailVerified: true, // no verification flag on User today; Phase 10 wires this
  });

  if (!gate.allowed) throw fail(gate.message || 'You cannot create a space', 403, { reason: gate.reason });

  const snapshot = await settingsService.snapshot();

  const check = validateSlug(input.slug || input.name, {
    minLength: snapshot.get('spaces.creation.slugMinLength'),
    maxLength: snapshot.get('spaces.creation.slugMaxLength'),
    reserved: snapshot.get('spaces.creation.reservedSlugs'),
  });
  if (!check.ok) throw fail(check.error, 400, { field: 'slug' });

  // Exact collision, then confusable collision. Two queries rather than one
  // because the messages differ and a user deserves to know which it is.
  if (await Space.exists({ slug: check.slug })) {
    throw fail('That address is already taken', 409, { field: 'slug' });
  }
  if (await Space.exists({ slugSkeleton: check.skeleton })) {
    throw fail('That address is too similar to an existing space', 409, { field: 'slug' });
  }

  const visibility = input.visibility || snapshot.get('spaces.creation.defaultVisibility');
  const allowedVisibilities = snapshot.get('spaces.creation.allowedVisibilities');
  if (!allowedVisibilities.includes(visibility)) {
    throw fail('That visibility is not available', 400, { field: 'visibility' });
  }

  if (input.nsfw && !snapshot.get('spaces.creation.allowNsfw')) {
    throw fail('NSFW spaces are not allowed', 400, { field: 'nsfw' });
  }

  if (snapshot.get('spaces.creation.requirePurpose') && !String(input.purpose || '').trim()) {
    throw fail('Say what this space is for', 400, { field: 'purpose' });
  }

  const theme = {};
  if (input.themePrimary) {
    const contrast = validateAccent(input.themePrimary);
    if (!contrast.ok) throw fail(contrast.error, 400, { field: 'themePrimary' });
    theme.primary = input.themePrimary;
    theme.prefersDarkText = Boolean(contrast.prefersDarkText);
  }

  const { html, text } = input.description
    ? sanitizeHtml.process(input.description, 'spaceDescription')
    : { html: '', text: '' };

  const space = await Space.create({
    slug: check.slug,
    slugSkeleton: check.skeleton,
    name: String(input.name || check.slug).trim().slice(0, 60),
    tagline: String(input.tagline || '').trim().slice(0, 120),
    description: html,
    descriptionText: text,
    owner: user._id,
    visibility,
    joinPolicy:
      visibility === SPACE_VISIBILITY.PUBLIC ? SPACE_JOIN_POLICY.OPEN : SPACE_JOIN_POLICY.REQUEST,
    status: gate.requiresApproval ? SPACE_STATUS.PENDING : SPACE_STATUS.ACTIVE,
    nsfw: Boolean(input.nsfw),
    purpose: String(input.purpose || '').slice(0, 2000),
    theme,
    topics: Array.isArray(input.topics) ? input.topics.slice(0, 3) : [],
    allowedPostTypes: snapshot.get('spaces.posting.allowedTypes'),
    publicModlog: snapshot.get('spaces.moderation.publicModlogDefault'),
    memberCount: 1,
  });

  // The creator is the owner and the first member. Created directly rather than
  // through join(), because join() checks a join policy the owner is exempt from.
  await SpaceMember.create({
    space: space._id,
    user: user._id,
    role: SPACE_MEMBER_ROLES.OWNER,
    status: SPACE_MEMBER_STATUS.ACTIVE,
    joinedAt: new Date(),
  });

  return { space, requiresApproval: gate.requiresApproval };
};

// --------------------------------------------------------------- settings

const EDITABLE_FIELDS = ['name', 'tagline', 'nsfw', 'joinPolicy', 'publicModlog', 'topics', 'language'];

/**
 * Update a space.
 *
 * Explicit field allowlist. Spreading `req.body` here would let an owner set
 * their own `featured`, `verified`, `memberCount` or `status`.
 */
const update = async (space, input = {}, { asAdmin = false } = {}) => {
  const patch = {};

  for (const field of EDITABLE_FIELDS) {
    if (input[field] !== undefined) patch[field] = input[field];
  }

  if (input.description !== undefined) {
    const { html, text } = sanitizeHtml.process(input.description, 'spaceDescription');
    patch.description = html;
    patch.descriptionText = text;
  }

  if (input.themePrimary !== undefined) {
    if (!input.themePrimary) {
      patch['theme.primary'] = '';
    } else {
      const contrast = validateAccent(input.themePrimary);
      if (!contrast.ok) throw fail(contrast.error, 400, { field: 'themePrimary' });
      patch['theme.primary'] = input.themePrimary;
      patch['theme.prefersDarkText'] = Boolean(contrast.prefersDarkText);
    }
  }

  if (input.visibility !== undefined) {
    const snapshot = await settingsService.snapshot();
    const allowed = snapshot.get('spaces.creation.allowedVisibilities');
    if (!asAdmin && !allowed.includes(input.visibility)) {
      throw fail('That visibility is not available', 400, { field: 'visibility' });
    }
    patch.visibility = input.visibility;
  }

  // Admin-only fields. Never reachable from the owner-facing endpoint.
  if (asAdmin) {
    for (const field of ['featured', 'verified', 'locked', 'pinnedGlobally', 'excludeFromAll', 'status', 'statusReason']) {
      if (input[field] !== undefined) patch[field] = input[field];
    }
  }

  if (!Object.keys(patch).length) return space;

  Object.assign(space, patch);
  await space.save();
  cacheService.invalidate(cacheService.keys.space(space.slug));
  return space;
};

/** Apply a sparse override patch, validated against the registry. */
const setOverrides = async (space, patch, { asAdmin = false } = {}) => {
  const result = permissions.validateOverrides(patch, { asAdmin });
  if (!result.ok) throw fail('Some settings are invalid', 400, { errors: result.errors });

  const snapshot = await settingsService.snapshot();
  const next = { ...(space.overrides || {}) };

  for (const [key, value] of Object.entries(result.values)) {
    // A value equal to the current global stops being an override, so the space
    // resumes following the global setting when an admin later changes it.
    // Mirrors settingsService.update deliberately.
    if (JSON.stringify(value) === JSON.stringify(snapshot.get(key))) delete next[key];
    else next[key] = value;
  }

  space.overrides = next;
  space.markModified('overrides');
  await space.save();
  cacheService.invalidate(cacheService.keys.space(space.slug));
  return space;
};

// ------------------------------------------------------------- membership

/**
 * Join a space. Idempotent — the unique index on { space, user } means a
 * double-click cannot create two rows.
 */
const join = async (space, user) => {
  if (space.status !== SPACE_STATUS.ACTIVE) throw fail('This space is not accepting members', 409);
  if (permissions.isCommunityBanned(user)) throw fail('You are banned from the community', 403);

  const existing = await SpaceMember.findOne({ space: space._id, user: user._id });
  if (existing) {
    // A banned member rejoining would silently clear their ban.
    if (existing.status === SPACE_MEMBER_STATUS.BANNED) {
      throw fail('You are banned from this space', 403);
    }
    return existing;
  }

  if (space.joinPolicy === SPACE_JOIN_POLICY.INVITE) {
    throw fail('This space is invite only', 403);
  }

  const status =
    space.joinPolicy === SPACE_JOIN_POLICY.REQUEST
      ? SPACE_MEMBER_STATUS.PENDING
      : SPACE_MEMBER_STATUS.ACTIVE;

  const member = await SpaceMember.create({
    space: space._id,
    user: user._id,
    status,
    joinedAt: new Date(),
  });

  if (status === SPACE_MEMBER_STATUS.ACTIVE) {
    await counterService.increment('space', space._id, { memberCount: 1 });
  }
  return member;
};

const leave = async (space, user) => {
  const member = await SpaceMember.findOne({ space: space._id, user: user._id });
  if (!member) return { left: false };

  // An owner cannot walk away and orphan the space. They transfer or delete.
  if (member.role === SPACE_MEMBER_ROLES.OWNER) {
    throw fail('Transfer ownership before leaving this space', 409);
  }
  // Leaving must not be a way to clear a ban.
  if (member.status === SPACE_MEMBER_STATUS.BANNED) {
    throw fail('You are banned from this space', 403);
  }

  const wasActive = member.status === SPACE_MEMBER_STATUS.ACTIVE;
  await member.deleteOne();
  if (wasActive) await counterService.increment('space', space._id, { memberCount: -1 });
  return { left: true };
};

/**
 * Transfer ownership.
 *
 * Also used by the account-deletion cascade: an owner deleting their account
 * transfers to the longest-serving moderator rather than orphaning the space.
 */
const transferOwnership = async (space, newOwnerUserId, { actor = null } = {}) => {
  const target = await SpaceMember.findOne({ space: space._id, user: newOwnerUserId });
  if (!target) throw fail('That person is not a member of this space', 400);
  if (target.status !== SPACE_MEMBER_STATUS.ACTIVE) throw fail('That member is not active', 400);

  const current = await SpaceMember.findOne({ space: space._id, role: SPACE_MEMBER_ROLES.OWNER });

  if (current) {
    current.role = SPACE_MEMBER_ROLES.MODERATOR;
    current.permissions = SpaceMember.fullPermissions();
    await current.save();
  }

  target.role = SPACE_MEMBER_ROLES.OWNER;
  await target.save();

  space.owner = target.user;
  await space.save();

  return { from: current ? current.user : null, to: target.user, actor };
};

/**
 * Find the successor for an abandoned space: the longest-serving active
 * moderator, else the longest-serving active member, else nobody.
 *
 * Deciding this during the first deletion request is how spaces get orphaned,
 * so the policy lives here from Phase 1.
 */
const findSuccessor = async (spaceId) => {
  const mod = await SpaceMember.findOne({
    space: spaceId,
    role: SPACE_MEMBER_ROLES.MODERATOR,
    status: SPACE_MEMBER_STATUS.ACTIVE,
  })
    .sort({ joinedAt: 1 })
    .lean();
  if (mod) return mod.user;

  const member = await SpaceMember.findOne({
    space: spaceId,
    role: SPACE_MEMBER_ROLES.MEMBER,
    status: SPACE_MEMBER_STATUS.ACTIVE,
  })
    .sort({ joinedAt: 1 })
    .lean();
  return member ? member.user : null;
};

/** Owner leaves the platform: hand the space on, or archive it. */
const handleOwnerDeparture = async (spaceId) => {
  const space = await Space.findById(spaceId);
  if (!space) return { action: 'none' };

  const successor = await findSuccessor(spaceId);
  if (successor) {
    await transferOwnership(space, successor, { actor: 'system' });
    return { action: 'transferred', to: successor };
  }

  space.status = SPACE_STATUS.ARCHIVED;
  space.statusReason = 'Owner left and no successor was available';
  space.statusChangedAt = new Date();
  await space.save();
  return { action: 'archived' };
};

const setMemberRole = async (space, targetUserId, { role, permissions: perms, actor }) => {
  const member = await SpaceMember.findOne({ space: space._id, user: targetUserId });
  if (!member) throw fail('Not a member of this space', 404);
  if (member.role === SPACE_MEMBER_ROLES.OWNER) {
    throw fail('Transfer ownership instead of changing the owner’s role', 409);
  }

  const snapshot = await settingsService.snapshot();
  if (role === SPACE_MEMBER_ROLES.MODERATOR && member.role !== SPACE_MEMBER_ROLES.MODERATOR) {
    const modCount = await SpaceMember.countDocuments({
      space: space._id,
      role: SPACE_MEMBER_ROLES.MODERATOR,
    });
    const max = snapshot.get('spaces.moderation.maxModsPerSpace');
    if (modCount >= max) throw fail(`This space can have at most ${max} moderators`, 409);
  }

  if (role) member.role = role;
  if (perms && member.role === SPACE_MEMBER_ROLES.MODERATOR) {
    member.permissions = { ...SpaceMember.fullPermissions(), ...perms };
  }
  if (role === SPACE_MEMBER_ROLES.MEMBER) {
    // Demotion must clear the permissions object, not leave it dangling.
    member.permissions = {};
  }
  await member.save();
  return { member, actor };
};

const banMember = async (space, targetUserId, { reason, durationHours = null, actor }) => {
  const member = await SpaceMember.findOne({ space: space._id, user: targetUserId });
  const wasActive = member && member.status === SPACE_MEMBER_STATUS.ACTIVE;

  if (member && member.role === SPACE_MEMBER_ROLES.OWNER) {
    throw fail('The owner of a space cannot be banned from it', 409);
  }

  const update$ = {
    status: SPACE_MEMBER_STATUS.BANNED,
    banReason: String(reason || '').slice(0, 1000),
    bannedUntil: durationHours ? new Date(Date.now() + durationHours * 3600_000) : null,
    bannedBy: actor ? actor._id : null,
    bannedAt: new Date(),
    role: SPACE_MEMBER_ROLES.MEMBER,
    permissions: {},
  };

  // Upsert: banning someone who never joined must still work, otherwise a
  // drive-by poster cannot be banned at all.
  const banned = await SpaceMember.findOneAndUpdate(
    { space: space._id, user: targetUserId },
    { $set: update$, $setOnInsert: { joinedAt: new Date() } },
    { new: true, upsert: true }
  );

  if (wasActive) await counterService.increment('space', space._id, { memberCount: -1 });
  return banned;
};

const unbanMember = async (space, targetUserId) => {
  const member = await SpaceMember.findOne({ space: space._id, user: targetUserId });
  if (!member || member.status !== SPACE_MEMBER_STATUS.BANNED) return { unbanned: false };
  member.status = SPACE_MEMBER_STATUS.ACTIVE;
  member.bannedUntil = null;
  member.banReason = '';
  await member.save();
  await counterService.increment('space', space._id, { memberCount: 1 });
  return { unbanned: true };
};

// ------------------------------------------------------------------ rules

const addRule = async (space, { title, description, appliesTo = 'all' }) => {
  const snapshot = await settingsService.snapshot();
  const max = snapshot.get('spaces.moderation.maxRulesPerSpace');
  if (space.rules.length >= max) throw fail(`A space can have at most ${max} rules`, 409);
  if (!String(title || '').trim()) throw fail('A rule needs a title', 400);

  space.rules.push({
    // Stable and never reused. Moderation actions cite a rule by ID, so
    // reordering or editing must not change what a past action referred to.
    ruleId: crypto.randomBytes(6).toString('hex'),
    order: space.rules.length,
    title: String(title).trim().slice(0, 120),
    description: sanitizeHtml.toText(sanitizeHtml.sanitize(description || '', 'plain')).slice(0, 2000),
    appliesTo,
  });
  await space.save();
  return space.rules[space.rules.length - 1];
};

const updateRule = async (space, ruleId, patch) => {
  const rule = space.rules.find((r) => r.ruleId === ruleId);
  if (!rule) throw fail('Rule not found', 404);
  if (patch.title !== undefined) rule.title = String(patch.title).trim().slice(0, 120);
  if (patch.description !== undefined) {
    rule.description = sanitizeHtml
      .toText(sanitizeHtml.sanitize(patch.description, 'plain'))
      .slice(0, 2000);
  }
  if (patch.appliesTo !== undefined) rule.appliesTo = patch.appliesTo;
  space.markModified('rules');
  await space.save();
  return rule;
};

const removeRule = async (space, ruleId) => {
  const before = space.rules.length;
  space.rules = space.rules.filter((r) => r.ruleId !== ruleId);
  if (space.rules.length === before) throw fail('Rule not found', 404);
  space.rules.forEach((rule, index) => {
    rule.order = index;
  });
  space.markModified('rules');
  await space.save();
  return { removed: true };
};

const reorderRules = async (space, ruleIds) => {
  const byId = new Map(space.rules.map((r) => [r.ruleId, r]));
  const reordered = ruleIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== space.rules.length) throw fail('Rule list does not match', 400);
  reordered.forEach((rule, index) => {
    rule.order = index;
  });
  space.rules = reordered;
  space.markModified('rules');
  await space.save();
  return space.rules;
};

// ----------------------------------------------------------------- flairs

const createFlair = async (space, input) => {
  const text = String(input.text || '').trim();
  if (!text) throw fail('Flair needs text', 400);

  // A flair pill that cannot be read is a flair that does not work.
  for (const [field, value] of [['bgColor', input.bgColor], ['textColor', input.textColor]]) {
    if (value && !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      throw fail('Use a hex colour like #dc2626', 400, { field });
    }
  }

  const count = await Flair.countDocuments({ space: space._id, kind: input.kind || 'post' });
  if (count >= 50) throw fail('A space can have at most 50 flairs of each kind', 409);

  return Flair.create({
    space: space._id,
    kind: input.kind || 'post',
    text: text.slice(0, 64),
    textColor: input.textColor || '#ffffff',
    bgColor: input.bgColor || '#3f3f46',
    modOnly: Boolean(input.modOnly),
    order: count,
  });
};

const listFlairs = (space, kind = null) =>
  Flair.find({ space: space._id, active: true, ...(kind ? { kind } : {}) }).sort({ kind: 1, order: 1 });

module.exports = {
  bySlug,
  bySlugId,
  membershipFor,
  loadForActor,
  create,
  update,
  setOverrides,
  join,
  leave,
  transferOwnership,
  findSuccessor,
  handleOwnerDeparture,
  setMemberRole,
  banMember,
  unbanMember,
  addRule,
  updateRule,
  removeRule,
  reorderRules,
  createFlair,
  listFlairs,
  EDITABLE_FIELDS,
};
