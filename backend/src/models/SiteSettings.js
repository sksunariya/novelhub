const mongoose = require('mongoose');
const { buildReadingGateSchema } = require('./schemas/readingGate');

const siteSettingsSchema = new mongoose.Schema(
  {
    singleton: { type: Boolean, default: true, unique: true },
    siteName: { type: String, default: () => process.env.SITE_NAME || process.env.APP_NAME || 'NovelHub' },
    tagline: { type: String, default: 'Where dark tales come alive' },
    logoUrl: { type: String, default: '' },
    faviconUrl: { type: String, default: '' },
    themeColors: {
      primary: { type: String, default: '#dc2626' },
      accent: { type: String, default: '#ef4444' },
      background: { type: String, default: '#0a0507' },
      surface: { type: String, default: '#140a0e' },
      text: { type: String, default: '#e7e5e4' },
    },
    announcement: { type: String, default: '' },
    footerText: { type: String, default: '' },
    socialLinks: {
      discord: { type: String, default: '' },
      twitter: { type: String, default: '' },
      email: { type: String, default: '' },
    },
    homeSections: {
      featured: { type: Boolean, default: true },
      trending: { type: Boolean, default: true },
      newArrivals: { type: Boolean, default: true },
      popular: { type: Boolean, default: true },
      completed: { type: Boolean, default: true },
      topRated: { type: Boolean, default: true },
    },
    allowSignups: { type: Boolean, default: true },
    requireEmailVerification: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
    enableInAppNotifications: { type: Boolean, default: true },
    enableEmailNotifications: { type: Boolean, default: true },
    enableMentionNotifications: { type: Boolean, default: true },
    enableReplyNotifications: { type: Boolean, default: true },
    enableChapterNotifications: { type: Boolean, default: true },
    carouselMode: { type: String, enum: ['hybrid', 'custom_only', 'auto_smart'], default: 'hybrid' },
    carouselAutoPlayInterval: { type: Number, default: 6 },
    enableCarouselAutoPlay: { type: Boolean, default: true },
    readingGate: { type: buildReadingGateSchema(), default: () => ({}) },
  },
  { timestamps: true }
);

siteSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ singleton: true });
  if (!settings) {
    try {
      settings = await this.create({ singleton: true });
    } catch (error) {
      // Concurrent first access: several requests can all find nothing and all
      // try to create. The unique index rejects every loser, which then reads
      // the winner's document instead of throwing a duplicate-key error up
      // through an unrelated request.
      if (error.code !== 11000) throw error;
      settings = await this.findOne({ singleton: true });
    }
  } else if (settings && (!settings.siteName || settings.siteName === 'Apex NovelHub')) {
    settings.siteName = process.env.SITE_NAME || process.env.APP_NAME || 'NovelHub';
    await settings.save().catch(() => {});
  }
  return settings;
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
