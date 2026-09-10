#!/usr/bin/env node
/**
 * Seed the curated homepage.
 *
 *   node scripts/seedSpotlight.js
 *   node scripts/seedSpotlight.js --with-community   # also add the community rails
 *
 * MIGRATION, not just a seed. The homepage used to be six sections hardcoded in
 * frontend/src/pages/Home.jsx, shown or hidden by six booleans in
 * SiteSettings.homeSections. Those six become ordinary rails here, carrying
 * their old keys and their old on/off state, so a site that upgrades gets the
 * homepage it already had — and can then reorder, retitle, schedule and delete
 * rows that used to need a deploy.
 *
 * Idempotent by rail key: re-running updates nothing that already exists, so it
 * is safe to run on every deploy and will not undo an admin's edits.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const SpotlightRail = require('../src/models/SpotlightRail');
const SiteSettings = require('../src/models/SiteSettings');
const settingsService = require('../src/services/settingsService');

// const WITH_COMMUNITY = process.argv.includes('--with-community');
const WITH_COMMUNITY = true;
const log = (...args) => console.info(...args);

// The six originals, in their original order, with the queries that reproduce
// what each one used to fetch from the frontend.
const LEGACY_RAILS = [
  {
    key: 'featured', title: 'Featured', icon: 'Sparkles', accent: 'crimson',
    viewAllUrl: '/browse',
    query: { kind: 'novels', novelSort: 'featured' },
  },
  {
    key: 'trending', title: 'Trending This Week', icon: 'Flame', accent: 'crimson',
    viewAllUrl: '/rankings',
    query: { kind: 'novels', novelSort: 'trending' },
  },
  {
    key: 'newarrivals', title: 'New Arrivals', icon: 'BookOpen', accent: 'azure',
    viewAllUrl: '/browse?sort=newest',
    query: { kind: 'novels', novelSort: 'newest' },
    // The old key in SiteSettings.homeSections, which is camelCase where rail
    // keys are lowercase. Kept so the visibility toggle carries over.
    legacyKey: 'newArrivals',
  },
  {
    key: 'popular', title: 'Most Popular', icon: 'TrendingUp', accent: 'amber',
    viewAllUrl: '/browse?sort=popular',
    query: { kind: 'novels', novelSort: 'popular' },
  },
  {
    key: 'completed', title: 'Completed Novels', icon: 'CheckCircle2', accent: 'emerald',
    viewAllUrl: '/browse?status=completed',
    query: { kind: 'novels', novelSort: 'updated', novelStatus: 'completed' },
  },
  {
    key: 'toprated', title: 'Top Rated', icon: 'Trophy', accent: 'gold',
    viewAllUrl: '/rankings',
    query: { kind: 'novels', novelSort: 'rating' },
    legacyKey: 'topRated',
  },
];

// The rails that make the community visible from the front door. Opt-in,
// because a site whose community is not launched yet should not advertise it.
const COMMUNITY_RAILS = [
  {
    key: 'pulse', title: 'Right now', icon: 'Activity', accent: 'emerald',
    layout: 'pulse', source: 'auto', maxItems: 1,
    query: { kind: 'novels' },
  },
  {
    key: 'community-hot', title: 'Hot in the community', icon: 'Flame', accent: 'violet',
    layout: 'grid', source: 'auto', maxItems: 6, viewAllUrl: '/community',
    query: { kind: 'posts', feedSort: 'hot', timeframe: 'week' },
  },
  {
    key: 'chapter-talk', title: 'Readers are talking about', icon: 'MessagesSquare', accent: 'crimson',
    layout: 'grid', source: 'auto', maxItems: 4, viewAllUrl: '/community',
    // Not pinned to one novel: follows whatever is trending and has discussion
    // attached, so it stays worth reading without anyone editing it.
    query: { kind: 'linked_posts', linkedType: 'novel', followTrending: true, feedSort: 'hot' },
  },
  {
    key: 'find-your-people', title: 'Find your people', subtitle: 'Spaces worth joining',
    icon: 'Users', accent: 'azure',
    layout: 'carousel', source: 'auto', maxItems: 10, viewAllUrl: '/community/spaces',
    // The targeting that justifies the whole audience mechanism: shown to people
    // who have an account and have joined nothing, and to nobody else.
    audience: 'non_members',
    query: { kind: 'spaces', spaceSort: 'active' },
  },
  {
    key: 'community-poll', title: 'Have your say', icon: 'BarChart3', accent: 'gold',
    layout: 'poll', source: 'auto', maxItems: 1, viewAllUrl: '/community',
    query: { kind: 'posts', feedSort: 'hot', timeframe: 'month', postType: 'poll' },
  },
];

const seed = async () => {
  await connectDB(process.env.MONGO_URI);

  const settings = await SiteSettings.getSettings();
  const legacyVisibility = (settings && settings.homeSections) || {};
  let order = 0;
  let created = 0;
  let skipped = 0;

  const upsert = async (spec) => {
    const existing = await SpotlightRail.findOne({ key: spec.key });
    if (existing) {
      skipped += 1;
      order = Math.max(order, existing.order + 1);
      return;
    }
    const { legacyKey, ...rest } = spec;
    // `!== false` rather than a truthiness check: a section absent from the old
    // settings document was VISIBLE by default, and reading absence as "off"
    // would silently empty the homepage of a site that never touched the toggles.
    const wasVisible = legacyVisibility[legacyKey || spec.key] !== false;

    await SpotlightRail.create({
      layout: 'carousel',
      source: 'auto',
      maxItems: 12,
      audience: 'all',
      ...rest,
      isActive: spec.isActive === undefined ? wasVisible : spec.isActive,
      order: order++,
    });
    created += 1;
    log(`  + ${spec.key}${wasVisible ? '' : ' (inactive, matching the old toggle)'}`);
  };

  log('Seeding homepage rails…');
  for (const spec of LEGACY_RAILS) await upsert(spec);

  if (WITH_COMMUNITY) {
    const communityOn = await settingsService.get('spaces.enabled').catch(() => false);
    if (!communityOn) {
      log('  ! spaces.enabled is off — community rails are seeded but will render empty until it is on.');
    }
    for (const spec of COMMUNITY_RAILS) await upsert(spec);
  } else {
    log('  (skipping community rails — pass --with-community to add them)');
  }

  log(`Done. ${created} created, ${skipped} already present.`);
  await mongoose.disconnect();
};

seed().catch((error) => {
  console.error('seedSpotlight failed:', error);
  process.exit(1);
});
