const Comment = require('../models/Comment');
const Review = require('../models/Review');
const { GATE_REQUIREMENTS, GATE_RECURRENCE, GATE_REASONS } = require('../config/constants');

const toPlain = (gate) => (gate && typeof gate.toObject === 'function' ? gate.toObject() : gate || {});

// A novel's own gate wins only when the admin ticked `override`.
const resolveGate = (settingsGate, novelGate) => {
  const novel = toPlain(novelGate);
  return novel.override ? novel : toPlain(settingsGate);
};

// The chapter whose requirements guard `number`: the most recent checkpoint at or
// before it. Returns 0 when the chapter sits in the free run.
const resolveCheckpoint = (gate, number) => {
  const start = (gate.engagementAfterChapter || 0) + 1;
  if (number < start) {
    return 0;
  }
  if (gate.recurrence === GATE_RECURRENCE.ALL) {
    return number;
  }
  if (gate.recurrence === GATE_RECURRENCE.EVERY) {
    const step = Math.max(gate.everyChapters || 1, 1);
    return start + Math.floor((number - start) / step) * step;
  }
  if (gate.recurrence === GATE_RECURRENCE.CHAPTERS) {
    const passed = (gate.chapterNumbers || []).filter((entry) => entry >= start && entry <= number);
    return passed.length ? Math.max(...passed) : 0;
  }
  return start;
};

// Requirements escalate past `escalateAfterChapter`, judged on the chapter the
// reader opened rather than on its checkpoint — otherwise a single-checkpoint gate
// (recurrence "once") could never escalate. An empty escalated list falls back to
// the base list so a half-configured gate still behaves.
const requirementsFor = (gate, chapterNumber) => {
  const base = gate.requirements || [];
  if (!gate.escalateAfterChapter || chapterNumber <= gate.escalateAfterChapter) {
    return base;
  }
  const escalated = gate.escalatedRequirements || [];
  return escalated.length ? escalated : base;
};

const needsLogin = (gate, number) => Boolean(gate.loginEnabled) && number > (gate.loginAfterChapter || 0);

const CHAPTER_SCOPED = [GATE_REQUIREMENTS.CHAPTER_COMMENT, GATE_REQUIREMENTS.CHAPTER_REVIEW];

const isChapterScoped = (requirement) => CHAPTER_SCOPED.includes(requirement);

const checkRequirement = async (requirement, { novelId, checkpointId, userId }) => {
  if (isChapterScoped(requirement) && !checkpointId) {
    return true;
  }
  if (requirement === GATE_REQUIREMENTS.NOVEL_COMMENT) {
    return Boolean(await Comment.exists({ novel: novelId, user: userId }));
  }
  if (requirement === GATE_REQUIREMENTS.NOVEL_REVIEW) {
    return Boolean(await Review.exists({ novel: novelId, chapter: null, user: userId }));
  }
  if (requirement === GATE_REQUIREMENTS.CHAPTER_COMMENT) {
    return Boolean(await Comment.exists({ chapter: checkpointId, user: userId }));
  }
  if (requirement === GATE_REQUIREMENTS.CHAPTER_REVIEW) {
    return Boolean(await Review.exists({ chapter: checkpointId, user: userId }));
  }
  return true;
};

// Returns { locked, reason, requirements, checkpointNumber } for a chapter read.
const evaluateReadingGate = async ({ gate, novel, chapterNumber, checkpoint, user }) => {
  if (needsLogin(gate, chapterNumber) && !user) {
    return { locked: true, reason: GATE_REASONS.LOGIN, requirements: [], checkpointNumber: 0 };
  }
  if (!gate.engagementEnabled) {
    return { locked: false };
  }
  const checkpointNumber = resolveCheckpoint(gate, chapterNumber);
  if (!checkpointNumber) {
    return { locked: false };
  }
  // A chapter-scoped requirement with no reachable checkpoint chapter (unpublished
  // or deleted) would be impossible to satisfy, so it is dropped rather than
  // stranding the reader.
  const required = requirementsFor(gate, chapterNumber).filter((key) => checkpoint || !isChapterScoped(key));
  if (!required.length) {
    return { locked: false };
  }
  if (!user) {
    return {
      locked: true,
      reason: GATE_REASONS.LOGIN,
      requirements: required.map((key) => ({ key, satisfied: false })),
      checkpointNumber,
    };
  }
  // Chapter-scoped requirements point at the checkpoint chapter, which may sit
  // earlier in the novel than the chapter being opened.
  const checkpointId = checkpoint ? checkpoint._id : null;
  const results = await Promise.all(
    required.map(async (key) => ({
      key,
      satisfied: await checkRequirement(key, { novelId: novel._id, checkpointId, userId: user._id }),
    }))
  );
  const unmet = results.filter((entry) => !entry.satisfied);
  return unmet.length
    ? { locked: true, reason: GATE_REASONS.ENGAGEMENT, requirements: results, checkpointNumber }
    : { locked: false };
};

// The next chapter that will ask for engagement, so the reader can be warned early.
const nextCheckpointAfter = (gate, number) => {
  if (!gate.engagementEnabled) {
    return 0;
  }
  const start = (gate.engagementAfterChapter || 0) + 1;
  if (number < start) {
    return start;
  }
  if (gate.recurrence === GATE_RECURRENCE.ALL) {
    return number + 1;
  }
  if (gate.recurrence === GATE_RECURRENCE.EVERY) {
    return resolveCheckpoint(gate, number) + Math.max(gate.everyChapters || 1, 1);
  }
  if (gate.recurrence === GATE_RECURRENCE.CHAPTERS) {
    const upcoming = (gate.chapterNumbers || []).filter((entry) => entry > number);
    return upcoming.length ? Math.min(...upcoming) : 0;
  }
  return 0;
};

module.exports = {
  resolveGate,
  resolveCheckpoint,
  requirementsFor,
  needsLogin,
  isChapterScoped,
  evaluateReadingGate,
  nextCheckpointAfter,
};
