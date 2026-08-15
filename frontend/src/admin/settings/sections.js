// The entire admin settings surface: which registry sections appear, in what
// order, under which tab. Adding a setting needs no change here — only adding
// a whole new *section* does.
//
// Section keys must match `section` in backend/src/config/settings/*.js.

export const SETTING_TABS = [
  {
    id: 'monetization',
    label: 'Monetization',
    groups: [
      { section: 'monetization.general', title: 'General' },
      { section: 'monetization.pricing', title: 'Chapter pricing' },
      { section: 'monetization.access', title: 'Access and rentals' },
      { section: 'monetization.expiry', title: 'Credit expiry' },
      { section: 'monetization.store', title: 'Store' },
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    groups: [
      { section: 'monetization.currency', title: 'Currency and exchange rates' },
      { section: 'monetization.paypal', title: 'PayPal' },
      { section: 'monetization.refunds', title: 'Refunds' },
      { section: 'monetization.tax', title: 'Tax and invoicing' },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    groups: [
      { section: 'monetization.subscriptions', title: 'Subscriptions' },
      { section: 'monetization.coupons', title: 'Coupons and promo codes' },
      { section: 'monetization.grants', title: 'Free credit grants' },
      { section: 'monetization.revenueShare', title: 'Author revenue share' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    groups: [
      { section: 'monetization.analytics', title: 'Reporting and attribution' },
      { section: 'monetization.geo', title: 'Geo and regions' },
    ],
  },
  {
    id: 'discovery',
    label: 'Discovery',
    groups: [
      { section: 'platform.ranking', title: 'Ranking' },
      { section: 'platform.discovery', title: 'Homepage and browse' },
      { section: 'platform.views', title: 'View counting' },
    ],
  },
  {
    id: 'reading',
    label: 'Reading',
    groups: [
      { section: 'platform.community', title: 'Chapter comments and reviews' },
      { section: 'platform.notifications', title: 'Notifications' },
      { section: 'platform.reader', title: 'Reader experience' },
    ],
  },
  // The community system: user-created spaces, posts, voting, moderation.
  // General-purpose — a space is about anything, not only novels.
  {
    id: 'community',
    label: 'Community',
    groups: [
      { section: 'spaces.core', title: 'Core' },
      { section: 'spaces.creation', title: 'Space creation' },
      { section: 'spaces.posting', title: 'Posting and comments' },
      { section: 'spaces.media', title: 'Media and uploads' },
      { section: 'spaces.voting', title: 'Voting' },
      { section: 'spaces.ranking', title: 'Ranking and sorting' },
      { section: 'spaces.moderation', title: 'Moderation and safety' },
      { section: 'spaces.feed', title: 'Feeds' },
      { section: 'spaces.karma', title: 'Karma' },
      { section: 'spaces.links', title: 'Linked content' },
      { section: 'spaces.analytics', title: 'Analytics and retention' },
      { section: 'spaces.safety', title: 'Safety and jurisdiction' },
      { section: 'spaces.privacy', title: 'Privacy and retention' },
      { section: 'spaces.scale', title: 'Scale and performance' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    groups: [
      { section: 'platform.auth', title: 'Accounts and sign-in' },
      { section: 'platform.limits', title: 'Content limits' },
      { section: 'monetization.rateLimits', title: 'Rate limits' },
      { section: 'monetization.safety', title: 'Safety guards' },
    ],
  },
];

export const findTabForSection = (section) =>
  SETTING_TABS.find((tab) => tab.groups.some((group) => group.section === section));
