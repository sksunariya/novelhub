const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
  // The owner tier. Sees the whole admin portal unconditionally, holds every
  // elevated permission implicitly, and reads paid content without spending —
  // and is the only role that can decide which modules an `admin` may see.
  //
  // Deliberately a separate role value rather than an elevated permission:
  // this is not a capability layered on top of admin, it is the account that
  // defines what admin means. Two accounts holding it should be a deliberate,
  // rare act, which a role value makes visible in a way a flag in an array
  // does not.
  SUPERADMIN: 'superadmin',
};

/** Roles that reach the admin portal at all. */
const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPERADMIN];

// Capabilities granted on top of a role, held as an array on the user.
//
// Deliberately NOT extra values in ROLES. `role` is single-valued, so a
// `safety_admin` role would mean the person reviewing child-safety reports
// could not also be an admin — which in a small team is everyone, including
// the owner. An array lets one account hold `admin` plus `child_safety`
// without either weakening the other.
//
// CHILD_SAFETY gates the restricted escalation queue. The point is to keep
// that material away from community moderators and from admins who have no
// business seeing it — not to lock the owner out of their own system.
const ELEVATED_PERMISSIONS = {
  CHILD_SAFETY: 'child_safety',
  LEGAL: 'legal', // DMCA counter-notices, law enforcement requests
  SECURITY: 'security', // audit log export, session revocation
};

// --- Admin portal modules -------------------------------------------------
//
// The single source of truth for what the admin portal is made of. The
// superadmin's visibility matrix, the nav, the route guards and the API guards
// all read this list, so a module cannot be hidden in one place and reachable
// in another — the failure mode that makes UI-only permission systems
// worthless.
//
// `id` is what gets stored per-admin and in the global defaults. Renaming one
// orphans stored settings, so treat ids as permanent.
//
// `alwaysOn` marks modules no toggle can remove; an admin with no dashboard has
// no portal to land on. `superOnly` marks modules the superadmin never shares —
// they are invisible to admins regardless of what the matrix says.
//
// A module governs CAPABILITY, not just visibility. Several of these powers also
// reach the public API — an admin can delete any comment through the endpoint
// the reader UI calls, and override any space through /api/spaces/:slug — so
// hiding the module withdraws the authority everywhere, not only the screen.
// See services/moduleAccessService.js (capabilities) for the mechanism.
const ADMIN_MODULE_GROUPS = {
  OVERVIEW: 'overview',
  CONTENT: 'content',
  MONETIZATION: 'monetization',
  ANALYTICS: 'analytics',
  COMMUNITY: 'community',
  PEOPLE: 'people',
  SYSTEM: 'system',
  GOVERNANCE: 'governance',
};

const ADMIN_MODULES = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    group: ADMIN_MODULE_GROUPS.OVERVIEW,
    description: 'Landing page and headline stats.',
    alwaysOn: true,
  },
  {
    id: 'novels',
    label: 'Novels & chapters',
    group: ADMIN_MODULE_GROUPS.CONTENT,
    description: 'Create and edit novels, upload and price chapters.',
  },
  {
    id: 'carousel',
    label: 'Hero carousel',
    group: ADMIN_MODULE_GROUPS.CONTENT,
    description: 'Homepage carousel slides.',
  },
  {
    id: 'monetization_config',
    label: 'Monetization settings',
    group: ADMIN_MODULE_GROUPS.MONETIZATION,
    description: 'Pricing, gates, store, currency, refunds, tax and revenue share.',
    // The settings registry is one screen spanning three domains. Splitting the
    // guard by section prefix keeps "hide monetization settings" from also
    // hiding auth, ranking and community configuration — which is what a single
    // guard on /admin/config would have done.
    configPrefix: 'monetization',
  },
  {
    id: 'packs',
    label: 'Credit packs',
    group: ADMIN_MODULE_GROUPS.MONETIZATION,
    description: 'Credit pack catalogue and pricing rules.',
  },
  {
    id: 'plans',
    label: 'Subscriptions',
    group: ADMIN_MODULE_GROUPS.MONETIZATION,
    description: 'Subscription plans and subscriber list.',
  },
  {
    id: 'currencies',
    label: 'Currencies',
    group: ADMIN_MODULE_GROUPS.MONETIZATION,
    description: 'Currency catalogue, FX rates and settlement.',
  },
  {
    id: 'grants',
    label: 'Free credits',
    group: ADMIN_MODULE_GROUPS.MONETIZATION,
    description: 'Grant campaigns and direct credit sends.',
  },
  {
    id: 'wallets',
    label: 'Wallets & orders',
    group: ADMIN_MODULE_GROUPS.MONETIZATION,
    description:
      'User balances, manual credit adjustments, orders and refunds. No portal screen yet — this governs the API only, and still matters: adjusting a balance and refunding an order are the two most sensitive things an admin can do.',
    apiOnly: true,
  },
  {
    id: 'analytics',
    label: 'Revenue & authors',
    group: ADMIN_MODULE_GROUPS.ANALYTICS,
    description: 'Revenue rollups, funnels, economy and author earnings.',
  },
  {
    id: 'spaces',
    label: 'Spaces',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description:
      'Space directory, lifecycle, overrides and moderators. Also grants site-admin authority inside every space, which overrides that space\'s own rules.',
  },
  {
    id: 'space_requests',
    label: 'Space requests',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description:
      'Approving and rejecting new space requests. Sits inside Spaces — hiding Spaces hides this queue with it.',
  },
  {
    id: 'community_posts',
    label: 'Posts',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description:
      'Cross-space post search and bulk actions. Per-post moderation authority follows Spaces, since it flows through space permissions.',
  },
  {
    id: 'community_reports',
    label: 'Reports & appeals',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description:
      'The report queue, appeals and transparency figures — including handling reports through the public community API.',
  },
  {
    id: 'community_modlog',
    label: 'Mod log',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description: 'Site-wide moderation action history.',
  },
  {
    id: 'community_safety',
    label: 'Child safety queue',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description:
      'Restricted escalation queue. Also requires the child_safety elevated permission — visibility alone does not open it.',
  },
  {
    id: 'users',
    label: 'Users',
    group: ADMIN_MODULE_GROUPS.PEOPLE,
    description: 'User search, edit, ban and delete.',
  },
  {
    id: 'moderation',
    label: 'Chapter comments',
    group: ADMIN_MODULE_GROUPS.PEOPLE,
    description:
      'Comment and review moderation, including editing or removing any comment or review through the public API.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    group: ADMIN_MODULE_GROUPS.PEOPLE,
    description: 'Announcements, dispatch and campaign history.',
  },
  {
    id: 'platform_config',
    label: 'Platform settings',
    group: ADMIN_MODULE_GROUPS.SYSTEM,
    description: 'Ranking, discovery, reader, auth, notifications and platform limits.',
    configPrefix: 'platform',
  },
  {
    id: 'community_config',
    label: 'Community settings',
    group: ADMIN_MODULE_GROUPS.COMMUNITY,
    description: 'Space creation, posting, voting, karma, feed and community moderation rules.',
    configPrefix: 'spaces',
  },
  {
    id: 'site_settings',
    label: 'Site settings',
    group: ADMIN_MODULE_GROUPS.SYSTEM,
    description: 'Branding, maintenance mode and site-wide options.',
  },
  {
    id: 'jobs',
    label: 'Jobs & webhooks',
    group: ADMIN_MODULE_GROUPS.SYSTEM,
    description: 'Scheduled job runs, manual triggers and webhook replay.',
  },
  {
    id: 'access_control',
    label: 'Access control',
    group: ADMIN_MODULE_GROUPS.GOVERNANCE,
    description: 'Decide which modules admins can see. Superadmin only.',
    superOnly: true,
  },
];

const ADMIN_MODULE_IDS = ADMIN_MODULES.map((m) => m.id);

// Settings-registry section prefix -> module id, for the three modules that
// carve up /admin/config between them.
const CONFIG_PREFIX_MODULES = ADMIN_MODULES.filter((m) => m.configPrefix).reduce(
  (acc, m) => ({ ...acc, [m.configPrefix]: m.id }),
  {}
);

const NOVEL_STATUS = {
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  HIATUS: 'hiatus',
};

const RANKING_TYPES = {
  TRENDING: 'trending',
  POPULAR: 'popular',
  RATING: 'rating',
  NEW: 'new',
};

const NOTIFICATION_TYPES = {
  NEW_CHAPTER: 'new_chapter',
  ANNOUNCEMENT: 'announcement',
  REPLY: 'reply',
  MENTION: 'mention',
  CAMPAIGN: 'campaign',
  CUSTOM: 'custom',
  // Credit and payment events.
  CREDITS_GRANTED: 'credits_granted',
  CREDITS_PURCHASED: 'credits_purchased',
  PURCHASE_FAILED: 'purchase_failed',
  CREDITS_EXPIRING: 'credits_expiring',
  CREDITS_EXPIRED: 'credits_expired',
  LOW_BALANCE: 'low_balance',
  CHAPTER_UNLOCKED: 'chapter_unlocked',
  REFUND_PROCESSED: 'refund_processed',
  RENTAL_EXPIRING: 'rental_expiring',
};

// Every credit event's default channel setup. The admin matrix overrides these
// per event per channel; this is only what ships out of the box.
const CREDIT_NOTIFICATION_DEFAULTS = {
  credits_granted: { in_app: true, email: true },
  credits_purchased: { in_app: true, email: true },
  purchase_failed: { in_app: true, email: true },
  credits_expiring: { in_app: true, email: true },
  credits_expired: { in_app: true, email: false },
  low_balance: { in_app: true, email: false },
  chapter_unlocked: { in_app: false, email: false },
  refund_processed: { in_app: true, email: true },
  rental_expiring: { in_app: true, email: false },
};

const NOTIFICATION_CHANNELS = {
  IN_APP: 'in_app',
  EMAIL: 'email',
};

const PUBLIC_USER_FIELDS = 'username avatarUrl role fullName';

const ADMIN_USER_FIELDS = 'username email avatarUrl role banned fullName';

const MODERATION_STATUS = {
  ACTIVE: 'active',
  DELETED: 'deleted',
};

// Actions a reader can be asked to perform before a gated chapter unlocks.
const GATE_REQUIREMENTS = {
  NOVEL_COMMENT: 'novelComment',
  NOVEL_REVIEW: 'novelReview',
  CHAPTER_COMMENT: 'chapterComment',
  CHAPTER_REVIEW: 'chapterReview',
};

// How often the engagement gate asks again past its starting chapter.
const GATE_RECURRENCE = {
  ONCE: 'once',
  EVERY: 'every',
  CHAPTERS: 'chapters',
  ALL: 'all',
};

const GATE_REASONS = {
  LOGIN: 'login',
  ENGAGEMENT: 'engagement',
  CREDITS: 'credits',
  EARLY_ACCESS: 'early_access',
};

// How a reader came to own a chapter.
const ACCESS_SOURCES = {
  CREDITS: 'credits',
  BULK: 'bulk',
  SUBSCRIPTION: 'subscription',
  FREE: 'free',
  ADMIN_GRANT: 'admin_grant',
  COUPON: 'coupon',
  TIMED_RELEASE: 'timed_release',
};

// Per-chapter override of the novel's pricing.
const CHAPTER_ACCESS_TYPES = {
  INHERIT: 'inherit',
  FREE: 'free',
  PAID: 'paid',
};

// Why a chapter resolved to its price — surfaced in the admin preview so an
// admin can see which link in the chain won without guessing.
const PRICE_REASONS = {
  OWNED: 'owned',
  MONETIZATION_OFF: 'monetization_off',
  CHAPTER_FREE: 'chapter_free',
  FREE_QUOTA: 'free_quota',
  TIMED_RELEASE: 'timed_release',
  SUBSCRIPTION: 'subscription',
  CHAPTER_OVERRIDE: 'chapter_override',
  PRICING_RULE: 'pricing_rule',
  NOVEL_DEFAULT: 'novel_default',
  GLOBAL_DEFAULT: 'global_default',
  // A superadmin reading paid content without spending. Recorded as its own
  // reason rather than reusing `monetization_off` so the bypass is legible in
  // read logs and never mistaken for a pricing bug.
  STAFF_BYPASS: 'staff_bypass',
};

const PRICING_RULE_SCOPES = {
  GLOBAL: 'global',
  NOVEL: 'novel',
  GENRE: 'genre',
  NOVEL_STATUS: 'novel_status',
};

const PRICING_RULE_MODES = {
  SET: 'set',
  MULTIPLY: 'multiply',
  ADD: 'add',
  FREE: 'free',
};

const GATE_DEFAULTS = {
  EVERY_CHAPTERS: 10,
};

// --- Credits -------------------------------------------------------------
// Every credit carries the cash that bought it, so chapter revenue can be
// traced to real money rather than credit face value. Cash is tracked in
// micro-USD (1e-6 USD) because dividing a pack price across credits needs more
// precision than cents: $9.99 over 1200 credits is 8325 micros per credit.
const MICROS_PER_CENT = 10000;
const MICROS_PER_USD = 1000000;

const CREDIT_TRANSACTION_TYPES = {
  PURCHASE: 'purchase',
  GRANT: 'grant',
  SPEND: 'spend',
  REFUND: 'refund',
  EXPIRE: 'expire',
  ADJUSTMENT: 'adjustment',
  REVERSAL: 'reversal',
  SUBSCRIPTION_GRANT: 'subscription_grant',
  REFERRAL: 'referral',
};

// Where a tranche of credits came from. Determines its cost basis: purchases
// and subscription cycles carry cash, grants and referrals carry zero.
const CREDIT_SOURCES = {
  PURCHASE: 'purchase',
  GRANT: 'grant',
  SUBSCRIPTION: 'subscription',
  REFERRAL: 'referral',
  ADJUSTMENT: 'adjustment',
};

const CREDIT_REF_TYPES = {
  ORDER: 'order',
  CHAPTER: 'chapter',
  GRANT_CAMPAIGN: 'grant_campaign',
  SUBSCRIPTION: 'subscription',
  COUPON: 'coupon',
  ADMIN: 'admin',
};

// Which tranche a spend draws from first. Also decides which cost basis the
// unlock is attributed against, so it is a revenue decision, not just an
// expiry one.
const BUCKET_CONSUMPTION_ORDER = {
  EXPIRY_FIRST: 'expiry_first',
  FIFO: 'fifo',
  GRANTED_FIRST: 'granted_first',
  PURCHASED_FIRST: 'purchased_first',
};

// --- Payments ------------------------------------------------------------
// The only currencies PayPal will settle in. Everything else must be charged
// in USD with the local figure shown as an estimate.
// https://developer.paypal.com/api/codes/currency (updated 13 Jul 2026)
// Notably absent: INR, AED, ZAR, KRW, IDR, VND, NGN.
const PAYPAL_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY',
  'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'RUB', 'SEK', 'SGD',
  'CHF', 'THB', 'USD',
];

// PayPal rejects decimal amounts in these. Sending 1549.5 JPY is an error.
const ZERO_DECIMAL_CURRENCIES = ['JPY', 'HUF', 'TWD'];

const SETTLEMENT_MODES = { LOCAL: 'local', USD: 'usd' };

const ORDER_STATUS = {
  CREATED: 'created',
  APPROVED: 'approved',
  CAPTURED: 'captured',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  DISPUTED: 'disputed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

const WEBHOOK_STATUS = {
  RECEIVED: 'received',
  PROCESSED: 'processed',
  FAILED: 'failed',
  IGNORED: 'ignored',
};

const PAYPAL_EVENTS = {
  ORDER_APPROVED: 'CHECKOUT.ORDER.APPROVED',
  CAPTURE_COMPLETED: 'PAYMENT.CAPTURE.COMPLETED',
  CAPTURE_DENIED: 'PAYMENT.CAPTURE.DENIED',
  CAPTURE_REFUNDED: 'PAYMENT.CAPTURE.REFUNDED',
  CAPTURE_REVERSED: 'PAYMENT.CAPTURE.REVERSED',
  DISPUTE_CREATED: 'CUSTOMER.DISPUTE.CREATED',
  // Subscriptions
  SUBSCRIPTION_ACTIVATED: 'BILLING.SUBSCRIPTION.ACTIVATED',
  SUBSCRIPTION_CANCELLED: 'BILLING.SUBSCRIPTION.CANCELLED',
  SUBSCRIPTION_SUSPENDED: 'BILLING.SUBSCRIPTION.SUSPENDED',
  SUBSCRIPTION_EXPIRED: 'BILLING.SUBSCRIPTION.EXPIRED',
  SUBSCRIPTION_PAYMENT_FAILED: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  // Each renewal arrives as a sale, and is what triggers the cycle grant.
  SALE_COMPLETED: 'PAYMENT.SALE.COMPLETED',
};

const SUBSCRIPTION_STATUS = {
  APPROVAL_PENDING: 'approval_pending',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

const ROUNDING_MODES = {
  NONE: 'none',
  NEAREST_INT: 'nearest_int',
  CEIL_INT: 'ceil_int',
  CHARM_99: 'charm_99',
  CHARM_95: 'charm_95',
  NEAREST_10: 'nearest_10',
  NEAREST_50: 'nearest_50',
  NEAREST_100: 'nearest_100',
};

const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  CHAPTER_MAX_LIMIT: 5000,
};

const UPLOAD_LIMITS = {
  IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  DOC_MAX_BYTES: 20 * 1024 * 1024,
};

const RATING = {
  MIN: 1,
  MAX: 5,
};

const TRENDING_WINDOW_DAYS = 7;

const VIEW_TARGET_TYPES = {
  NOVEL: 'novel',
  CHAPTER: 'chapter',
  POST: 'post',
};

// --- Community ("spaces") ------------------------------------------------
// A space is a user-created community about anything. Nothing here assumes
// novels; the platform catalogue is reached through the optional, generic
// link-type registry in config/linkTypes.js.

const SPACE_VISIBILITY = {
  PUBLIC: 'public',
  RESTRICTED: 'restricted', // anyone reads, approved members post
  PRIVATE: 'private', // members only
};

const SPACE_JOIN_POLICY = {
  OPEN: 'open',
  REQUEST: 'request',
  INVITE: 'invite',
};

// Lifecycle. `pending` exists for the admin approval queue; `quarantined` is
// the proportionate step before the blunter `banned`.
const SPACE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  QUARANTINED: 'quarantined',
  BANNED: 'banned',
  REJECTED: 'rejected',
};

const SPACE_MEMBER_ROLES = {
  MEMBER: 'member',
  MODERATOR: 'moderator',
  OWNER: 'owner',
};

const SPACE_MEMBER_STATUS = {
  ACTIVE: 'active',
  PENDING: 'pending',
  BANNED: 'banned',
  MUTED: 'muted',
};

// Granular moderator permissions. A flair moderator who cannot ban people is
// the whole point — a single role enum forces every mod to be all-powerful.
const MOD_PERMISSIONS = {
  MANAGE_POSTS: 'managePosts',
  MANAGE_MEMBERS: 'manageMembers',
  MANAGE_SETTINGS: 'manageSettings',
  MANAGE_FLAIR: 'manageFlair',
  MANAGE_RULES: 'manageRules',
  MANAGE_MODS: 'manageMods',
};

const POST_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  LINK: 'link',
  POLL: 'poll',
};

// `removed` is a moderation state and stays queryable by mods; `deletedAt`
// (softDelete plugin) is the author removing their own content. Different
// events, both recoverable.
const POST_STATUS = {
  PUBLISHED: 'published',
  PENDING: 'pending',
  REMOVED: 'removed',
  HIDDEN: 'hidden',
};

const VOTE_TARGET_TYPES = {
  POST: 'post',
  COMMENT: 'comment',
};

const POST_SORTS = {
  HOT: 'hot',
  NEW: 'new',
  TOP: 'top',
  RISING: 'rising',
  CONTROVERSIAL: 'controversial',
};

const COMMENT_SORTS = {
  BEST: 'best',
  TOP: 'top',
  NEW: 'new',
  OLD: 'old',
  CONTROVERSIAL: 'controversial',
};

const TOP_TIMEFRAMES = {
  HOUR: 'hour',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
  ALL: 'all',
};

const REPORT_TARGET_TYPES = {
  POST: 'post',
  COMMENT: 'comment',
  SPACE: 'space',
  USER: 'user',
};

const REPORT_STATUS = {
  OPEN: 'open',
  ACTIONED: 'actioned',
  DISMISSED: 'dismissed',
  ESCALATED: 'escalated',
};

const REPORT_SOURCES = {
  USER: 'user',
  AUTOMOD: 'automod',
  BANNED_WORD: 'banned_word',
  THRESHOLD: 'threshold',
};

// Per-user override of the global space-creation gate. Lets an admin grant
// creation rights to one trusted user while the global mode is admin_only, or
// revoke them from one abuser without tightening the gate on everyone.
const SPACE_CREATION_POLICY = {
  DEFAULT: 'default',
  ALWAYS: 'always',
  NEVER: 'never',
};

const SPACE_CREATION_MODES = {
  OPEN: 'open',
  KARMA_GATED: 'karma_gated',
  APPROVAL: 'approval',
  ADMIN_ONLY: 'admin_only',
};

// Reddit's hot formula epoch. Fixed constant, not a tunable — the gravity
// divisor is what admins adjust.
const HOT_SCORE_EPOCH_SECONDS = 1134028003;

const VIEW_DEDUP_WINDOW_SECONDS = 30 * 60;

module.exports = {
  ROLES,
  ADMIN_ROLES,
  ELEVATED_PERMISSIONS,
  ADMIN_MODULES,
  ADMIN_MODULE_IDS,
  CONFIG_PREFIX_MODULES,
  ADMIN_MODULE_GROUPS,
  NOVEL_STATUS,
  RANKING_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  CREDIT_NOTIFICATION_DEFAULTS,
  PUBLIC_USER_FIELDS,
  ADMIN_USER_FIELDS,
  MODERATION_STATUS,
  GATE_REQUIREMENTS,
  GATE_RECURRENCE,
  GATE_REASONS,
  GATE_DEFAULTS,
  ACCESS_SOURCES,
  CHAPTER_ACCESS_TYPES,
  PRICE_REASONS,
  PRICING_RULE_SCOPES,
  PRICING_RULE_MODES,
  MICROS_PER_CENT,
  MICROS_PER_USD,
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  CREDIT_REF_TYPES,
  BUCKET_CONSUMPTION_ORDER,
  PAYPAL_CURRENCIES,
  ZERO_DECIMAL_CURRENCIES,
  SETTLEMENT_MODES,
  ORDER_STATUS,
  WEBHOOK_STATUS,
  PAYPAL_EVENTS,
  SUBSCRIPTION_STATUS,
  ROUNDING_MODES,
  PAGINATION,
  UPLOAD_LIMITS,
  RATING,
  TRENDING_WINDOW_DAYS,
  VIEW_TARGET_TYPES,
  VIEW_DEDUP_WINDOW_SECONDS,
  // Community
  SPACE_VISIBILITY,
  SPACE_JOIN_POLICY,
  SPACE_STATUS,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_STATUS,
  MOD_PERMISSIONS,
  POST_TYPES,
  POST_STATUS,
  VOTE_TARGET_TYPES,
  POST_SORTS,
  COMMENT_SORTS,
  TOP_TIMEFRAMES,
  REPORT_TARGET_TYPES,
  REPORT_STATUS,
  REPORT_SOURCES,
  SPACE_CREATION_POLICY,
  SPACE_CREATION_MODES,
  HOT_SCORE_EPOCH_SECONDS,
};
