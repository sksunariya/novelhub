const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLES } = require('../config/constants');
const moduleAccessService = require('../services/moduleAccessService');

const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (user.banned) {
      return res.status(403).json({ message: 'Account is banned' });
    }
    // Resolve the module matrix once per request for staff accounts. Every
    // later capability check reads it synchronously — see
    // moduleAccessService.hasCapability for why that matters.
    await moduleAccessService.attachCapabilities(user);
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user && !user.banned) {
        await moduleAccessService.attachCapabilities(user);
        req.user = user;
      }
    }
  } catch (error) {
    req.user = null;
  }
  next();
};

/** True for the owner tier. Kept here so call sites never compare role strings. */
const isSuperAdmin = (user) => Boolean(user && user.role === ROLES.SUPERADMIN);

/** True for anyone who reaches the admin portal: admin or superadmin. */
const isStaff = (user) => Boolean(user && (user.role === ROLES.ADMIN || user.role === ROLES.SUPERADMIN));

const adminOnly = (req, res, next) => {
  if (!isStaff(req.user)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

/**
 * The owner tier only. Guards the module visibility matrix itself — an admin
 * who could edit their own visibility would make the whole mechanism decorative.
 */
const superAdminOnly = (req, res, next) => {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ message: 'Superadmin access required' });
  }
  next();
};

/**
 * Require a named elevated permission on top of admin.
 *
 *   router.use('/safety', protect, adminOnly, requireElevated(ELEVATED_PERMISSIONS.CHILD_SAFETY));
 *
 * Deliberately does NOT treat `admin` as implying every permission. The whole
 * purpose of the child-safety queue being separate is that being an admin is
 * not sufficient to see it — the permission has to be granted explicitly, which
 * makes the set of people who can view that material small, deliberate and
 * auditable.
 *
 * Superadmin is the one exception, and only because the alternative is worse:
 * the account that grants every permission being unable to hold one means the
 * owner cannot verify the queue they are responsible for. It stays a single
 * account by deliberate design, which keeps the set small in the way that
 * actually matters.
 */
const requireElevated = (permission) =>
  function elevatedGuard(req, res, next) {
    if (isSuperAdmin(req.user)) return next();
    const held = (req.user && req.user.elevatedPermissions) || [];
    if (!held.includes(permission)) {
      return res.status(403).json({
        message: 'This area requires an additional permission that has not been granted to your account',
      });
    }
    return next();
  };

/**
 * Gate a route group on an admin portal module being visible to the caller.
 *
 * The counterpart to hiding the nav link. Hiding alone is not a permission
 * system — an admin who knows the URL would still reach the data — so every
 * admin route group carries the same module id its nav entry does.
 */
const requireModule = (moduleId) =>
  async function moduleGuard(req, res, next) {
    try {
      if (await moduleAccessService.canAccess(req.user, moduleId)) return next();
    } catch (error) {
      return next(error);
    }
    // 404 rather than 403: a restricted module is meant to not exist for this
    // admin, and a 403 would confirm the section is there to be asked about.
    return res.status(404).json({ message: 'Not found' });
  };

/**
 * Gate on holding at least one of several modules.
 *
 * For surfaces that are one screen spanning several modules — the settings
 * registry is the case that forced this. The handler is then responsible for
 * filtering its response down to what the caller actually holds; this only
 * decides whether the door opens at all.
 */
const requireAnyModule = (moduleIds) =>
  async function anyModuleGuard(req, res, next) {
    try {
      for (const moduleId of moduleIds) {
        if (await moduleAccessService.canAccess(req.user, moduleId)) return next();
      }
    } catch (error) {
      return next(error);
    }
    return res.status(404).json({ message: 'Not found' });
  };

const hasElevated = (user, permission) =>
  isSuperAdmin(user) ||
  Boolean(user && Array.isArray(user.elevatedPermissions) && user.elevatedPermissions.includes(permission));

module.exports = {
  protect,
  optionalAuth,
  adminOnly,
  superAdminOnly,
  requireElevated,
  requireModule,
  requireAnyModule,
  hasElevated,
  isSuperAdmin,
  isStaff,
};
