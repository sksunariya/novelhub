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
};

const PUBLIC_USER_FIELDS = 'username avatarUrl role';

const ADMIN_USER_FIELDS = 'username email avatarUrl role banned';

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
};

const GATE_DEFAULTS = {
  EVERY_CHAPTERS: 10,
};

const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
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
  PUBLIC_USER_FIELDS,
  ADMIN_USER_FIELDS,
  MODERATION_STATUS,
  GATE_REQUIREMENTS,
  GATE_RECURRENCE,
  GATE_REASONS,
  GATE_DEFAULTS,
  PAGINATION,
  UPLOAD_LIMITS,
  RATING,
  TRENDING_WINDOW_DAYS,
  VIEW_TARGET_TYPES,
  VIEW_DEDUP_WINDOW_SECONDS,
};
