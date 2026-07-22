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
  PAGINATION,
  UPLOAD_LIMITS,
  RATING,
  TRENDING_WINDOW_DAYS,
  VIEW_TARGET_TYPES,
  VIEW_DEDUP_WINDOW_SECONDS,
};
