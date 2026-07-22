const SiteSettings = require('../models/SiteSettings');
const { ROLES } = require('../config/constants');

const EXEMPT_PREFIXES = ['/auth/login', '/auth/google', '/settings', '/admin'];

const maintenanceGuard = async (req, res, next) => {
  const settings = await SiteSettings.getSettings();
  if (!settings.maintenanceMode) {
    return next();
  }
  if (EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }
  if (req.user && req.user.role === ROLES.ADMIN) {
    return next();
  }
  res.status(503).json({ message: 'Site is under maintenance', maintenance: true });
};

module.exports = maintenanceGuard;
