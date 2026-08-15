// Superadmin governance: who sees what in the admin portal.
//
// Every route here is mounted behind superAdminOnly. Nothing in this file may
// be reachable by an `admin` — an admin able to edit the matrix that constrains
// them is the same as having no matrix.

const User = require('../models/User');
const AdminAuditLog = require('../models/AdminAuditLog');
const moduleAccess = require('../services/moduleAccessService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { ROLES, ADMIN_ROLES } = require('../config/constants');

const audit = (req, action, entityId, changes, note = '') =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email || '',
    action,
    entity: 'admin_access',
    entityId: String(entityId || ''),
    changes,
    note,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  });

/**
 * Changes between two resolved states.
 *
 * Deliberately diffs before-vs-AFTER-APPLYING rather than before-vs-request.
 * The service silently drops toggles for alwaysOn and superOnly modules, so
 * diffing the request body would write entries for changes that never happened
 * — a log recording `dashboard: hidden` when the dashboard is still visible.
 * A trail the code calls immutable has to be true as well as unchangeable.
 */
const diff = (before, after) => {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const norm = (value) => (value === undefined ? null : value);
  return [...keys]
    .filter((key) => norm(before[key]) !== norm(after[key]))
    .map((key) => ({ key, before: norm(before[key]), after: norm(after[key]) }));
};

// GET /api/admin/access-control/modules
// The registry plus the current global baseline, which is everything the
// matrix screen needs in one round trip.
const getModules = asyncHandler(async (req, res) => {
  const globals = await moduleAccess.getGlobalDefaults({ fresh: true });
  res.json({ modules: moduleAccess.listModules(), globals });
});

// PUT /api/admin/access-control/global
// Body: { modules: { [moduleId]: true | false | null } }
const updateGlobal = asyncHandler(async (req, res) => {
  const before = await moduleAccess.getGlobalDefaults({ fresh: true });
  const globals = await moduleAccess.setGlobalDefaults(req.body.modules, req.user);
  const changes = diff(before, globals);
  if (changes.length) await audit(req, 'admin_access.global.update', 'global', changes);
  res.json({ globals });
});

// GET /api/admin/access-control/admins
// Every account that can reach the portal, with its resolved matrix. The list
// is small by nature, so it is not paginated.
const listAdmins = asyncHandler(async (req, res) => {
  const users = await User.find({ role: { $in: ADMIN_ROLES } })
    .select('username email role avatarUrl banned adminModules elevatedPermissions createdAt lastActiveAt')
    .sort({ role: -1, username: 1 });

  const admins = await Promise.all(
    users.map(async (user) => {
      const resolved = await moduleAccess.resolveForUser(user);
      return {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        banned: user.banned,
        elevatedPermissions: user.elevatedPermissions || [],
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
        // `visibility`, never `modules` — `modules` is the registry everywhere
        // else in this API and the two must not swap meaning between endpoints.
        visibility: resolved.modules,
        sources: resolved.sources,
        overrides: moduleAccess.getUserOverrides(user),
        hiddenCount: Object.values(resolved.modules).filter((visible) => !visible).length,
      };
    })
  );

  res.json({ admins, modules: moduleAccess.listModules() });
});

// PUT /api/admin/access-control/admins/:id
// Body: { modules: { [moduleId]: true | false | null } }
// null clears the override so the account follows the global baseline again.
const updateAdmin = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id).select('role username email adminModules');
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (target.role === ROLES.SUPERADMIN) {
    return res.status(400).json({
      message: 'A superadmin sees the whole portal by definition. Per-module overrides do not apply.',
    });
  }

  const before = moduleAccess.getUserOverrides(target);
  const resolved = await moduleAccess.setUserOverrides(req.params.id, req.body.modules);
  const after = moduleAccess.getUserOverrides(await User.findById(req.params.id));

  const changes = diff(before, after);
  if (changes.length) {
    await audit(req, 'admin_access.user.update', target._id, changes, `admin: ${target.username}`);
  }

  res.json({
    visibility: resolved.modules,
    sources: resolved.sources,
    allowed: resolved.allowed,
    overrides: after,
  });
});

// POST /api/admin/access-control/admins/:id/role
// Body: { role: 'user' | 'admin' | 'superadmin' }
const setRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ message: 'Unknown role' });
  }

  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: 'User not found' });

  // Demoting yourself out of the last superadmin account leaves nobody able to
  // administer the matrix, and no supported way back in short of the seed
  // script. Refuse rather than require a database edit to recover.
  if (target.role === ROLES.SUPERADMIN && role !== ROLES.SUPERADMIN) {
    const remaining = await User.countDocuments({ role: ROLES.SUPERADMIN, _id: { $ne: target._id } });
    if (remaining === 0) {
      return res.status(400).json({ message: 'Cannot demote the only superadmin' });
    }
  }

  const previous = target.role;
  target.role = role;
  // Overrides describe an admin's portal. They are meaningless on a superadmin
  // and misleading if left behind on a demoted account.
  if (role === ROLES.SUPERADMIN || role === ROLES.USER) target.adminModules = undefined;
  await target.save();

  await audit(req, 'admin_access.role.change', target._id, [{ key: 'role', before: previous, after: role }],
    `${target.username}: ${previous} → ${role}`);

  res.json({ _id: target._id, username: target.username, role: target.role });
});

// GET /api/admin/access-control/me
// What the caller may see. Read by the portal shell on load to build the nav,
// and by every admin — not just superadmins — so it is mounted separately.
const getMyAccess = asyncHandler(async (req, res) => {
  const resolved = await moduleAccess.resolveForUser(req.user);
  res.json({
    role: resolved.role,
    isSuperAdmin: resolved.isSuperAdmin,
    modules: moduleAccess.listModules(),
    visibility: resolved.modules,
    allowed: resolved.allowed,
  });
});

module.exports = {
  getModules,
  updateGlobal,
  listAdmins,
  updateAdmin,
  setRole,
  getMyAccess,
};
