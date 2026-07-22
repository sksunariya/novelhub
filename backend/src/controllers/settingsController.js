const SiteSettings = require('../models/SiteSettings');
const { asyncHandler } = require('../middlewares/errorHandler');

const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await SiteSettings.getSettings();
  res.json({
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
      maintenanceMode: settings.maintenanceMode,
    },
  });
});

module.exports = { getPublicSettings };
