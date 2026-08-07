const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const ReadingProgress = require('../models/ReadingProgress');
const SiteSettings = require('../models/SiteSettings');
const { asyncHandler } = require('../middlewares/errorHandler');
const { VIEW_TARGET_TYPES } = require('../config/constants');
const { getViewerKey, registerView } = require('../utils/viewTracking');
const {
  resolveGate,
  resolveCheckpoint,
  evaluateReadingGate,
  nextCheckpointAfter,
} = require('../utils/readingGate');

const LOCKED_MESSAGE = 'This chapter is locked';

const chapterSummary = (chapter) =>
  chapter ? { id: chapter._id, number: chapter.number, title: chapter.title } : null;

const readChapter = asyncHandler(async (req, res) => {
  const number = parseInt(req.params.number, 10);
  if (Number.isNaN(number)) {
    return res.status(400).json({ message: 'Invalid chapter number' });
  }
  const novel = await Novel.findOne({ slug: req.params.slug, published: true });
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const chapter = await Chapter.findOne({ novel: novel._id, number, published: true });
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
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

  // A locked chapter never ships its content, and a blocked read is not a view.
  if (gateStatus.locked) {
    return res.status(403).json({
      message: gate.message || LOCKED_MESSAGE,
      gate: {
        locked: true,
        reason: gateStatus.reason,
        requirements: gateStatus.requirements,
        checkpoint: chapterSummary(checkpoint),
      },
      novel: novelInfo,
      chapter: chapterSummary(chapter),
      ...navigation,
    });
  }

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
    chapter,
    novel: novelInfo,
    ...navigation,
    gate: { locked: false, nextCheckpoint: nextCheckpointAfter(gate, number) },
  });
});

module.exports = { readChapter };
