const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const ReadingProgress = require('../models/ReadingProgress');
const { asyncHandler } = require('../middlewares/errorHandler');
const { VIEW_TARGET_TYPES } = require('../config/constants');
const { getViewerKey, registerView } = require('../utils/viewTracking');

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
  const [prev, next, isNewView] = await Promise.all([
    Chapter.findOne({ novel: novel._id, number: { $lt: number }, published: true })
      .select('number title')
      .sort({ number: -1 }),
    Chapter.findOne({ novel: novel._id, number: { $gt: number }, published: true })
      .select('number title')
      .sort({ number: 1 }),
    registerView(VIEW_TARGET_TYPES.CHAPTER, chapter._id, getViewerKey(req)),
  ]);
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
    novel: { id: novel._id, title: novel.title, slug: novel.slug },
    prev: prev ? { number: prev.number, title: prev.title } : null,
    next: next ? { number: next.number, title: next.title } : null,
  });
});

module.exports = { readChapter };
