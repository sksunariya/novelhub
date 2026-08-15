// Which admin portal modules a given account may see.
//
// Resolution is two-layer: a global baseline the superadmin sets for every
// admin, and a sparse per-admin override map. Absent everywhere means visible —
// see AdminModuleAccess for why the default is permissive.
//
// Superadmin short-circuits every path in this file. That is the point of the
// role: it cannot be locked out of its own portal, including by itself.

const AdminModuleAccess = require('../models/AdminModuleAccess');
const User = require('../models/User');
const { ROLES, ADMIN_MODULES, ADMIN_MODULE_IDS } = require('../config/constants');

const MODULE_BY_ID = new Map(ADMIN_MODULES.map((m) => [m.id, m]));

// The global doc is read on effectively every admin request and changes rarely,
// so it is held in a process-local copy.
//
// Invalidation on write only clears the process that did the writing. Behind
// several instances the others keep their copy until the TTL expires, so a
// revoke can take up to TTL to reach an admin whose request lands elsewhere.
// The TTL is therefore short: this is a permission boundary, and the window
// where a just-revoked admin still gets through has to be small enough not to
// matter. Per-admin overrides are read from the user document on every request
// and are never subject to this delay.
let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 1000;

const isSuperAdmin = (user) => Boolean(user && user.role === ROLES.SUPERADMIN);
const isAdminRole = (user) => Boolean(user && (user.role === ROLES.ADMIN || user.role === ROLES.SUPERADMIN));

const invalidate = () => {
  cached = null;
  cachedAt = 0;
};

/** The superadmin's global decisions, as a sparse { moduleId: boolean }. */
const getGlobalDefaults = async ({ fresh = false } = {}) => {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  const doc = await AdminModuleAccess.getDoc();
  cached = doc.toModuleMap();
  cachedAt = Date.now();
  return cached;
};

/**
 * Merge a patch into the global baseline.
 *
 * `null` for a module clears the decision, returning it to the permissive
 * default rather than pinning it to true — "no opinion" and "explicitly
 * allowed" should not collapse into the same stored state.
 */
const setGlobalDefaults = async (patch, actor) => {
  const doc = await AdminModuleAccess.getDoc();
  for (const [id, value] of Object.entries(patch || {})) {
    const module = MODULE_BY_ID.get(id);
    if (!module || module.alwaysOn || module.superOnly) continue;
    if (value === null) doc.modules.delete(id);
    else doc.modules.set(id, Boolean(value));
  }
  doc.updatedBy = (actor && actor._id) || null;
  await doc.save();
  invalidate();
  return doc.toModuleMap();
};

/** Sparse per-admin overrides, as { moduleId: boolean }. */
const getUserOverrides = (user) => {
  const out = {};
  if (!user || !user.adminModules) return out;
  for (const id of ADMIN_MODULE_IDS) {
    if (user.adminModules.has && user.adminModules.has(id)) out[id] = Boolean(user.adminModules.get(id));
  }
  return out;
};

const setUserOverrides = async (userId, patch) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (!isAdminRole(user)) {
    throw Object.assign(new Error('Module access applies to admin accounts only'), { status: 400 });
  }
  if (!user.adminModules) user.adminModules = new Map();

  for (const [id, value] of Object.entries(patch || {})) {
    const module = MODULE_BY_ID.get(id);
    if (!module || module.alwaysOn || module.superOnly) continue;
    if (value === null) user.adminModules.delete(id);
    else user.adminModules.set(id, Boolean(value));
  }
  user.markModified('adminModules');
  await user.save();
  return resolveForUser(user);
};

/**
 * The effective answer for one account.
 *
 * Returns the resolved matrix plus where each decision came from, because a
 * superadmin editing one admin needs to see whether a module is off for this
 * person or off for everyone — a matrix of bare booleans cannot say.
 */
const resolveForUser = async (user) => {
  const superAdmin = isSuperAdmin(user);
  const globals = superAdmin ? {} : await getGlobalDefaults();
  const overrides = superAdmin ? {} : getUserOverrides(user);

  const modules = {};
  const sources = {};

  for (const module of ADMIN_MODULES) {
    if (superAdmin) {
      modules[module.id] = true;
      sources[module.id] = 'superadmin';
      continue;
    }
    if (module.superOnly) {
      modules[module.id] = false;
      sources[module.id] = 'superadmin_only';
      continue;
    }
    if (module.alwaysOn) {
      modules[module.id] = true;
      sources[module.id] = 'always_on';
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(overrides, module.id)) {
      modules[module.id] = overrides[module.id];
      sources[module.id] = 'user';
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(globals, module.id)) {
      modules[module.id] = globals[module.id];
      sources[module.id] = 'global';
      continue;
    }
    modules[module.id] = true;
    sources[module.id] = 'default';
  }

  return {
    role: (user && user.role) || null,
    isSuperAdmin: superAdmin,
    modules,
    sources,
    allowed: Object.keys(modules).filter((id) => modules[id]),
  };
};

/** Single-module check, used by the route guard. */
const canAccess = async (user, moduleId) => {
  if (isSuperAdmin(user)) return true;
  if (!isAdminRole(user)) return false;

  const module = MODULE_BY_ID.get(moduleId);
  if (!module) return false; // unknown module: deny, never fail open
  if (module.superOnly) return false;
  if (module.alwaysOn) return true;

  const overrides = getUserOverrides(user);
  if (Object.prototype.hasOwnProperty.call(overrides, moduleId)) return overrides[moduleId];

  const globals = await getGlobalDefaults();
  if (Object.prototype.hasOwnProperty.call(globals, moduleId)) return globals[moduleId];

  return true;
};

// --- capabilities ---------------------------------------------------------
//
// Hiding a portal module has to remove the power behind it, not just the menu
// entry. Admin authority also lives on public routes — an admin can delete any
// comment through /api/comments/:id and override any space through
// /api/spaces/:slug — and those never touch the portal's route guards. Hiding
// "Chapter comments" while leaving comment deletion intact would make the
// matrix a menu filter rather than a permission system.
//
// The resolved matrix is attached to the request's user once, in `protect`, and
// read synchronously afterwards. It has to be synchronous because
// spacePermissionService.resolve() is sync and called from a dozen places;
// making it async would ripple through the whole community system for no gain.
const CAPABILITIES = Symbol.for('novelhub.moduleCapabilities');

/**
 * Resolve and cache this user's matrix on the document for the request.
 *
 * Non-enumerable and symbol-keyed so it cannot be serialised into a response
 * or persisted by a stray save().
 */
const attachCapabilities = async (user) => {
  if (!isAdminRole(user)) return user;
  const resolved = await resolveForUser(user);
  Object.defineProperty(user, CAPABILITIES, {
    value: resolved.modules,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return user;
};

/**
 * Synchronous capability check for code paths outside the admin portal.
 *
 * Falls back to full admin authority when the matrix was never attached. That
 * covers scheduled jobs and scripts, where there is no request and no person
 * whose portal could have been restricted — and it keeps this from silently
 * disabling background work. Every HTTP path attaches in `protect` or
 * `optionalAuth`, so a real admin request is always resolved.
 */
const hasCapability = (user, moduleId) => {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (!isAdminRole(user)) return false;
  const caps = user[CAPABILITIES];
  if (!caps) return true;
  return caps[moduleId] !== false;
};

/** The registry as the portal needs it: no behavioural flags stripped. */
const listModules = () =>
  ADMIN_MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    group: m.group,
    description: m.description,
    alwaysOn: Boolean(m.alwaysOn),
    superOnly: Boolean(m.superOnly),
    apiOnly: Boolean(m.apiOnly),
  }));

module.exports = {
  isSuperAdmin,
  isAdminRole,
  getGlobalDefaults,
  setGlobalDefaults,
  getUserOverrides,
  setUserOverrides,
  resolveForUser,
  canAccess,
  attachCapabilities,
  hasCapability,
  listModules,
  invalidate,
};
