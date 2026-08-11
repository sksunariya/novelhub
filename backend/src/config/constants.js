const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
};

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
};

const VIEW_DEDUP_WINDOW_SECONDS = 30 * 60;

module.exports = {
  ROLES,
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
};
