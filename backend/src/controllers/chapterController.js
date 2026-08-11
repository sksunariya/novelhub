const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const ReadingProgress = require('../models/ReadingProgress');
const SiteSettings = require('../models/SiteSettings');
const { asyncHandler } = require('../middlewares/errorHandler');
const { VIEW_TARGET_TYPES, GATE_REASONS } = require('../config/constants');
const { getViewerKey, registerView } = require('../utils/viewTracking');
const {
  resolveGate,
  resolveCheckpoint,
  evaluateReadingGate,
  nextCheckpointAfter,
} = require('../utils/readingGate');
const accessService = require('../services/accessService');
const settingsService = require('../services/settingsService');
const readTracking = require('../services/readTrackingService');
const { serializeChapter, serializeChapterRef } = require('../utils/serializers');

const LOCKED_MESSAGE = 'This chapter is locked';

const loadNovelAndChapter = async (slug, number) => {
  const novel = await Novel.findOne({ slug, published: true });
  if (!novel) return { error: { status: 404, message: 'Novel not found' } };
  const chapter = await Chapter.findOne({ novel: novel._id, number, published: true });
  if (!chapter) return { error: { status: 404, message: 'Chapter not found' } };
  return { novel, chapter };
};

const readChapter = asyncHandler(async (req, res) => {
  const number = parseInt(req.params.number, 10);
  if (Number.isNaN(number)) {
    return res.status(400).json({ message: 'Invalid chapter number' });
  }
  const { novel, chapter, error } = await loadNovelAndChapter(req.params.slug, number);
  if (error) return res.status(error.status).json({ message: error.message });

  const [prev, next, settings] = await Promise.all([
    Chapter.findOne({ novel: novel._id, number: { $lt: number }, published: true })
      .select('number title')
      .sort({ number: -1 }),
    Chapter.findOne({ novel: novel._id, number: { $gt: number }, published: true })
      .select('number title')
      .sort({ number: 1 }),
    SiteSettings.getSettings(),
  ]);

  const gate = resolveGate(settings.readingGate, novel.readingGate);
  const checkpointNumber = gate.engagementEnabled ? resolveCheckpoint(gate, number) : 0;
  let checkpoint = null;
  if (checkpointNumber) {
    checkpoint =
      checkpointNumber === number
        ? chapter
        : await Chapter.findOne({ novel: novel._id, number: checkpointNumber, published: true });
  }
  const gateStatus = await evaluateReadingGate({ gate, novel, chapterNumber: number, checkpoint, user: req.user });

  const novelInfo = { id: novel._id, title: novel.title, slug: novel.slug };
  const navigation = {
    prev: prev ? { number: prev.number, title: prev.title } : null,
    next: next ? { number: next.number, title: next.title } : null,
  };

  // A locked chapter never ships its content, and a blocked read is not a view
  // — but it IS recorded as a gate impression, which is the top of the
  // conversion funnel. Without this a reader who hits the wall and leaves is
  // invisible, and paywall drop-off cannot be measured.
  if (gateStatus.locked) {
    await readTracking.recordGateImpression(req, res, {
      chapter,
      novel,
      reason: gateStatus.reason,
    });
    return res.status(403).json({
      message: gate.message || LOCKED_MESSAGE,
      gate: {
        locked: true,
        reason: gateStatus.reason,
        requirements: gateStatus.requirements,
        checkpoint: serializeChapterRef(checkpoint),
      },
      novel: novelInfo,
      chapter: serializeChapterRef(chapter),
      ...navigation,
    });
  }

  // The credit gate runs after login and engagement. `engagement_bypass_credits`
  // means a reader who satisfied the engagement gate has already "paid" and is
  // not asked again.
  const config = await accessService.pricingConfig();
  const skipCredits =
    config.gateStacking === 'engagement_bypass_credits' && gate.engagementEnabled && checkpointNumber > 0;

  if (!skipCredits) {
    const access = await accessService.resolveAccess({ novel, chapter, user: req.user, config });
    if (access.locked) {
      const label = await settingsService.get('credits.labelPlural');
      await readTracking.recordGateImpression(req, res, {
        chapter,
        novel,
        reason: access.reason,
        priceCredits: access.priceCredits,
        balance: access.balance,
        canAfford: access.canAfford,
      });
      return res.status(403).json({
        message:
          access.reason === GATE_REASONS.EARLY_ACCESS
            ? 'This chapter is not available yet'
            : `Unlock this chapter with ${access.priceCredits} ${label.toLowerCase()}`,
        gate: {
          locked: true,
          reason: access.reason,
          requirements: [],
          checkpoint: null,
          priceCredits: access.priceCredits,
          balance: access.balance,
          canAfford: access.canAfford,
          availableAt: access.availableAt,
          creditLabel: label,
        },
        novel: novelInfo,
        chapter: serializeChapterRef(chapter),
        ...navigation,
      });
    }
  }

  // Persistent read history — the source for the retention curve, unlock rate
  // and reader→payer conversion. Separate from the view counter, which is a
  // 30-minute dedup key with a TTL and cannot answer any of those.
  await readTracking.recordRead(req, res, { chapter, novel });

  const isNewView = await registerView(VIEW_TARGET_TYPES.CHAPTER, chapter._id, getViewerKey(req));
  if (isNewView) {
    await Promise.all([
      Chapter.updateOne({ _id: chapter._id }, { $inc: { views: 1 } }),
      Novel.updateOne({ _id: novel._id }, { $inc: { views: 1, weeklyViews: 1 } }),
    ]);
  }
  if (req.user) {
    await ReadingProgress.findOneAndUpdate(
      { user: req.user._id, novel: novel._id },
      { chapter: chapter._id, chapterNumber: number },
      { upsert: true, new: true }
    );
  }
  res.json({
    chapter: serializeChapter(chapter),
    novel: novelInfo,
    ...navigation,
    gate: { locked: false, nextCheckpoint: nextCheckpointAfter(gate, number) },
  });
});

// GET /api/novels/:slug/chapters/:number/access
const getChapterAccess = asyncHandler(async (req, res) => {
  const number = parseInt(req.params.number, 10);
  if (Number.isNaN(number)) {
    return res.status(400).json({ message: 'Invalid chapter number' });
  }
  const { novel, chapter, error } = await loadNovelAndChapter(req.params.slug, number);
  if (error) return res.status(error.status).json({ message: error.message });

  const access = await accessService.resolveAccess({ novel, chapter, user: req.user });
  res.json({ chapter: serializeChapterRef(chapter), access });
});

// POST /api/novels/:slug/chapters/:number/unlock
const unlockChapter = asyncHandler(async (req, res) => {
  const number = parseInt(req.params.number, 10);
  if (Number.isNaN(number)) {
    return res.status(400).json({ message: 'Invalid chapter number' });
  }
  const { novel, chapter, error } = await loadNovelAndChapter(req.params.slug, number);
  if (error) return res.status(error.status).json({ message: error.message });

  const result = await accessService.unlockChapter({ user: req.user, novel, chapter });
  const balance = await require('../services/creditService').getBalance(req.user);
  res.status(result.alreadyOwned ? 200 : 201).json({
    alreadyOwned: result.alreadyOwned,
    spent: result.spent || 0,
    balance,
    chapter: serializeChapterRef(chapter),
  });
});

// POST /api/novels/:slug/unlock-bulk   { chapterNumbers | all: true, commit }
const unlockBulk = asyncHandler(async (req, res) => {
  const novel = await Novel.findOne({ slug: req.params.slug, published: true });
  if (!novel) return res.status(404).json({ message: 'Novel not found' });

  const { chapterNumbers, all, commit = false } = req.body || {};
  const filter = { novel: novel._id, published: true };
  if (!all) {
    if (!Array.isArray(chapterNumbers) || !chapterNumbers.length) {
      return res.status(400).json({ message: 'chapterNumbers or all is required' });
    }
    filter.number = { $in: chapterNumbers.map(Number).filter((n) => Number.isFinite(n)) };
  }
  const chapters = await Chapter.find(filter).sort({ number: 1 });
  if (!chapters.length) return res.status(404).json({ message: 'No chapters found' });

  if (!commit) {
    return res.json(await accessService.quoteBulk({ user: req.user, novel, chapters }));
  }
  const result = await accessService.unlockChapters({ user: req.user, novel, chapters });
  const balance = await require('../services/creditService').getBalance(req.user);
  res.status(201).json({ ...result, balance });
});

module.exports = { readChapter, getChapterAccess, unlockChapter, unlockBulk };
