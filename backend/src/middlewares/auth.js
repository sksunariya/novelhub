const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

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
        req.user = user;
      }
    }
  } catch (error) {
    req.user = null;
  }
  next();
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: 'Admin access required' });
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
 */
const requireElevated = (permission) =>
  function elevatedGuard(req, res, next) {
    const held = (req.user && req.user.elevatedPermissions) || [];
    if (!held.includes(permission)) {
      return res.status(403).json({
        message: 'This area requires an additional permission that has not been granted to your account',
      });
    }
    return next();
  };

const hasElevated = (user, permission) =>
  Boolean(user && Array.isArray(user.elevatedPermissions) && user.elevatedPermissions.includes(permission));

module.exports = { protect, optionalAuth, adminOnly, requireElevated, hasElevated };
