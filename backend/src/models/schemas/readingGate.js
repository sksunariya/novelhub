const mongoose = require('mongoose');
const { GATE_REQUIREMENTS, GATE_RECURRENCE, GATE_DEFAULTS } = require('../../config/constants');

// Reading-gate configuration, shared by SiteSettings (site-wide defaults) and
// Novel (per-novel override). `extraFields` lets the novel copy add its own
// `override` switch without duplicating the field list.
const buildReadingGateSchema = (extraFields = {}) =>
  new mongoose.Schema(
    {
      loginEnabled: { type: Boolean, default: false },
      loginAfterChapter: { type: Number, default: 0, min: 0 },
      engagementEnabled: { type: Boolean, default: false },
      engagementAfterChapter: { type: Number, default: 0, min: 0 },
      recurrence: { type: String, enum: Object.values(GATE_RECURRENCE), default: GATE_RECURRENCE.ONCE },
      everyChapters: { type: Number, default: GATE_DEFAULTS.EVERY_CHAPTERS, min: 1 },
      chapterNumbers: [{ type: Number, min: 1 }],
      requirements: {
        type: [{ type: String, enum: Object.values(GATE_REQUIREMENTS) }],
        default: [GATE_REQUIREMENTS.NOVEL_COMMENT, GATE_REQUIREMENTS.NOVEL_REVIEW],
      },
      // Past this chapter the gate switches to `escalatedRequirements` — set to 0
      // to keep one requirement set for the whole novel.
      escalateAfterChapter: { type: Number, default: 0, min: 0 },
      escalatedRequirements: {
        type: [{ type: String, enum: Object.values(GATE_REQUIREMENTS) }],
        default: [GATE_REQUIREMENTS.CHAPTER_COMMENT, GATE_REQUIREMENTS.CHAPTER_REVIEW],
      },
      message: { type: String, default: '', maxlength: 500 },
      ...extraFields,
    },
    { _id: false }
  );

module.exports = { buildReadingGateSchema };
