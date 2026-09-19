#!/usr/bin/env node
/**
 * Switch the saved site theme colours to the a2zNovel "Aurora Violet" palette.
 *
 *   npm run theme:aurora                # apply
 *   npm run theme:aurora -- --dry-run   # show what would change, write nothing
 *
 * Why this exists: SiteSettings.themeColors lives in the database, and the
 * frontend applies it over the stylesheet on every page load. A site whose
 * settings document was created under the old NovelHub defaults therefore keeps
 * showing the old red palette after the new frontend ships, until these five
 * values are changed. Changing the schema defaults alone does nothing for a
 * document that already exists.
 *
 * Only the five theme colours are touched. Idempotent: re-running when the
 * colours already match writes nothing. Each real change is recorded in the
 * admin audit log, so the switch shows up alongside changes made in the portal.
 *
 * To go back, edit the colours in Admin -> Settings -> Theme colors.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const SiteSettings = require('../src/models/SiteSettings');
const AdminAuditLog = require('../src/models/AdminAuditLog');

// Must match frontend/src/theme/palette.js.
const AURORA = {
  primary: '#7c3aed',
  accent: '#a78bfa',
  background: '#0c0a13',
  surface: '#14111d',
  text: '#f2eff9',
};

const DRY_RUN = process.argv.includes('--dry-run');
const log = (...args) => console.info(...args);

const normalise = (value) => String(value || '').trim().toLowerCase();

const run = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/novelhub';
  await connectDB(uri);

  // getSettings() creates the singleton on a fresh database — with the new
  // schema defaults, which already are this palette.
  const settings = await SiteSettings.getSettings();
  const current = settings.themeColors || {};

  const changes = Object.entries(AURORA)
    .filter(([key, value]) => normalise(current[key]) !== value)
    .map(([key, value]) => ({ key: `themeColors.${key}`, before: current[key] ?? null, after: value }));

  log(`\n  settings document  ${settings._id}`);
  Object.keys(AURORA).forEach((key) => {
    const change = changes.find((c) => c.key === `themeColors.${key}`);
    log(`  ${key.padEnd(18)} ${change ? `${change.before} -> ${change.after}` : `${current[key]} (unchanged)`}`);
  });

  if (!changes.length) {
    log('\n  Already on the Aurora Violet palette. Nothing to do.\n');
  } else if (DRY_RUN) {
    log(`\n  Dry run: ${changes.length} colour(s) would change. Nothing was written.\n`);
  } else {
    changes.forEach(({ key, after }) => settings.set(key, after));
    await settings.save();
    await AdminAuditLog.create({
      actorLabel: 'script:applyAuroraTheme',
      action: 'settings.update',
      entity: 'site_settings',
      entityId: String(settings._id),
      changes,
      note: 'Theme colours switched to the a2zNovel Aurora Violet palette by scripts/applyAuroraTheme.js',
    });
    log(`\n  Updated ${changes.length} colour(s). Reload the site to see the new theme.\n`);
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed to apply the Aurora Violet theme:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
