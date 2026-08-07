export const REDIRECT_PARAM = 'redirect';

export const GATE_REQUIREMENTS = {
  NOVEL_COMMENT: 'novelComment',
  NOVEL_REVIEW: 'novelReview',
  CHAPTER_COMMENT: 'chapterComment',
  CHAPTER_REVIEW: 'chapterReview',
};

export const GATE_RECURRENCE = {
  ONCE: 'once',
  EVERY: 'every',
  CHAPTERS: 'chapters',
  ALL: 'all',
};

export const GATE_REASONS = {
  LOGIN: 'login',
  ENGAGEMENT: 'engagement',
};

export const REQUIREMENT_OPTIONS = [
  { key: GATE_REQUIREMENTS.NOVEL_COMMENT, label: 'Comment on the novel', reader: 'Leave a comment' },
  { key: GATE_REQUIREMENTS.NOVEL_REVIEW, label: 'Review the novel', reader: 'Rate and review the novel' },
  { key: GATE_REQUIREMENTS.CHAPTER_COMMENT, label: 'Comment on the gate chapter', reader: 'Comment on this chapter' },
  { key: GATE_REQUIREMENTS.CHAPTER_REVIEW, label: 'Review the gate chapter', reader: 'Rate and review this chapter' },
];

export const RECURRENCE_OPTIONS = [
  { key: GATE_RECURRENCE.ONCE, label: 'Once', hint: 'Ask a single time, then the rest of the novel stays open.' },
  { key: GATE_RECURRENCE.EVERY, label: 'Every N chapters', hint: 'Ask again at a fixed interval past the free run.' },
  { key: GATE_RECURRENCE.CHAPTERS, label: 'Specific chapters', hint: 'Ask only at the chapter numbers you list.' },
  { key: GATE_RECURRENCE.ALL, label: 'Every chapter', hint: 'Ask on every chapter past the free run.' },
];

export const requirementLabel = (key) => REQUIREMENT_OPTIONS.find((option) => option.key === key)?.reader || key;

export const unmetRequirements = (requirements) =>
  (requirements || []).filter((entry) => !entry.satisfied).map((entry) => entry.key);

export const needsAny = (keys, ...candidates) => candidates.some((candidate) => keys.includes(candidate));
