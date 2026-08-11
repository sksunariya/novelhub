// Response serializers.
//
// Returning raw Mongoose documents means every field added to a model is
// exposed by default. That already leaks `sourceFile.key` — a private S3 object
// key — to every reader through readChapter, and would leak author revenue
// share percentages and lifetime revenue the moment those fields exist.
//
// These whitelists follow the pattern already used by getPublicSettings and
// serializeUser: name what goes out, so new fields are private until someone
// deliberately adds them.

/** Chapter as sent to a reader. Never includes sourceFile or internal revenue. */
const serializeChapter = (chapter, { includeContent = true } = {}) => {
  if (!chapter) return null;
  const out = {
    id: chapter._id,
    novel: chapter.novel,
    number: chapter.number,
    title: chapter.title,
    views: chapter.views,
    ratingAvg: chapter.ratingAvg,
    ratingCount: chapter.ratingCount,
    wordCount: chapter.wordCount,
    publishedAt: chapter.publishedAt || chapter.createdAt,
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt,
  };
  if (includeContent) out.content = chapter.content;
  return out;
};

/** Minimal chapter reference for navigation and gate payloads. */
const serializeChapterRef = (chapter) =>
  chapter ? { id: chapter._id, number: chapter.number, title: chapter.title } : null;

/**
 * Chapter list row, optionally carrying access state.
 * `access` comes from accessService.resolveNovelChapters.
 */
const serializeChapterListItem = (chapter, access = null) => {
  const out = {
    id: chapter._id,
    number: chapter.number,
    title: chapter.title,
    views: chapter.views,
    wordCount: chapter.wordCount,
    publishedAt: chapter.publishedAt || chapter.createdAt,
    createdAt: chapter.createdAt,
  };
  if (access) {
    out.locked = Boolean(access.locked);
    out.owned = Boolean(access.owned);
    out.free = Boolean(access.free);
    out.priceCredits = access.priceCredits || 0;
    if (access.availableAt) out.availableAt = access.availableAt;
  }
  return out;
};

/** Novel as sent to a reader. Excludes monetization internals and revenue. */
const serializeNovel = (novel) => {
  if (!novel) return null;
  return {
    id: novel._id,
    title: novel.title,
    slug: novel.slug,
    author: novel.author,
    synopsis: novel.synopsis,
    coverUrl: novel.coverUrl,
    genres: novel.genres,
    tags: novel.tags,
    status: novel.status,
    featured: novel.featured,
    views: novel.views,
    ratingAvg: novel.ratingAvg,
    ratingCount: novel.ratingCount,
    chapterCount: novel.chapterCount,
    lastChapterAt: novel.lastChapterAt,
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
    // Reader-relevant monetization only — never revenueShare or lifetime revenue.
    monetization: novel.monetization
      ? {
          monetized: novel.monetization.monetized !== false,
          freeChapterCount: novel.monetization.override ? novel.monetization.freeChapterCount : undefined,
          accessMode: novel.monetization.override ? novel.monetization.accessMode : undefined,
        }
      : undefined,
  };
};

/** Compact novel reference for cards and lists. */
const serializeNovelRef = (novel) =>
  novel ? { id: novel._id, title: novel.title, slug: novel.slug, coverUrl: novel.coverUrl } : null;

const serializeWallet = (wallet, { creditLabel = 'Credits' } = {}) => ({
  balance: wallet ? wallet.balance : 0,
  label: creditLabel,
  lifetimePurchased: wallet ? wallet.lifetimePurchased : 0,
  lifetimeGranted: wallet ? wallet.lifetimeGranted : 0,
  lifetimeSpent: wallet ? wallet.lifetimeSpent : 0,
  autoUnlock: wallet ? wallet.autoUnlock : { enabled: false, maxPriceCredits: 0, novels: [] },
});

/** Ledger row for the profile history. Cost basis stays internal. */
const serializeTransaction = (transaction) => ({
  id: transaction._id,
  type: transaction.type,
  amount: transaction.amount,
  balanceAfter: transaction.balanceAfter,
  description: transaction.description,
  novel: transaction.novel,
  chapter: transaction.chapter,
  createdAt: transaction.createdAt,
});

module.exports = {
  serializeChapter,
  serializeChapterRef,
  serializeChapterListItem,
  serializeNovel,
  serializeNovelRef,
  serializeWallet,
  serializeTransaction,
};
