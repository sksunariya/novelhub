const SiteSettings = require('../models/SiteSettings');
const { ADMIN_ROLES } = require('../config/constants');

const EXEMPT_PREFIXES = ['/auth/login', '/auth/google', '/settings', '/admin', '/carousel'];

const maintenanceGuard = async (req, res, next) => {
  const settings = await SiteSettings.getSettings();
  if (!settings.maintenanceMode) {
    return next();
  }
  if (EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }
  if (req.user && ADMIN_ROLES.includes(req.user.role)) {
    return next();
  }
  res.status(503).json({ message: 'Site is under maintenance', maintenance: true });
};

module.exports = maintenanceGuard;
