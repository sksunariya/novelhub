const SiteSettings = require('../models/SiteSettings');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');

const getPublicSettings = asyncHandler(async (req, res) => {
  const [settings, config] = await Promise.all([SiteSettings.getSettings(), settingsService.getPublic()]);
  res.json({
    // Registry-backed settings marked `public`. Secrets can never appear here —
    // getPublic() projects from the registry whitelist, not from the document.
    config,
    settings: {
      siteName: settings.siteName,
      tagline: settings.tagline,
      logoUrl: settings.logoUrl,
      faviconUrl: settings.faviconUrl,
      themeColors: settings.themeColors,
      announcement: settings.announcement,
      footerText: settings.footerText,
      socialLinks: settings.socialLinks,
      homeSections: settings.homeSections,
      allowSignups: settings.allowSignups,
      requireEmailVerification: settings.requireEmailVerification,
      maintenanceMode: settings.maintenanceMode,
      readingGate: settings.readingGate,
    },
  });
});

module.exports = { getPublicSettings };
