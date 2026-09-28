const mongoose = require('mongoose');
const {
  CHAPTER_ISSUE_CATEGORY_KEYS,
  CHAPTER_ISSUE_STATUS,
  CHAPTER_ISSUE_LIMITS,
} = require('../config/constants');

// A problem a reader reported from the chapter reader: missing text, a
// duplicated chapter, broken formatting, an access error.
//
// Not the community Report model. That one hides content once enough people
// report it; these never change what readers see. They are a work queue for
// whoever maintains the chapters.
//
// The novel/chapter titles and the chapter number are copied at filing time.
// A chapter can be renumbered, retitled or deleted to fix the very problem
// reported, and the queue still has to say what the reader was looking at.

const chapterIssueSchema = new mongoose.Schema(
  {
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    novel: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    snapshot: {
      novelTitle: { type: String, default: '' },
      novelSlug: { type: String, default: '' },
      chapterNumber: { type: Number, default: null },
      chapterTitle: { type: String, default: '' },
      reporterName: { type: String, default: '' },
    },

    category: { type: String, enum: CHAPTER_ISSUE_CATEGORY_KEYS, required: true },
    details: { type: String, default: '', maxlength: CHAPTER_ISSUE_LIMITS.DETAILS_MAX },
    // The passage the reader had selected when they opened the report, so the
    // admin can find a typo without reading the whole chapter.
    quote: { type: String, default: '', maxlength: CHAPTER_ISSUE_LIMITS.QUOTE_MAX },

    // Where and how the reader was reading. Rendering problems are often
    // specific to one browser, theme or font size.
    context: {
      progress: { type: Number, min: 0, max: 100, default: null },
      theme: { type: String, default: '' },
      font: { type: String, default: '' },
      fontSize: { type: Number, default: null },
      viewport: { type: String, default: '' },
      userAgent: { type: String, default: '', maxlength: CHAPTER_ISSUE_LIMITS.USER_AGENT_MAX },
    },

    // The same reader filing the same category again while it is still open
    // updates this report rather than adding a row.
    submissions: { type: Number, default: 1 },
    lastSubmittedAt: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: Object.values(CHAPTER_ISSUE_STATUS),
      default: CHAPTER_ISSUE_STATUS.OPEN,
    },
    resolutionNote: { type: String, default: '', maxlength: CHAPTER_ISSUE_LIMITS.NOTE_MAX },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
    reporterNotified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// The admin queue, newest first within a status.
chapterIssueSchema.index({ status: 1, createdAt: -1 });
// Filtering the queue by novel.
chapterIssueSchema.index({ novel: 1, status: 1, createdAt: -1 });
// "Other open reports on this chapter", and bulk-resolving a chapter.
chapterIssueSchema.index({ chapter: 1, status: 1 });
// The resubmission lookup.
chapterIssueSchema.index({ reporter: 1, chapter: 1, category: 1, status: 1 });

module.exports = mongoose.model('ChapterIssue', chapterIssueSchema);
