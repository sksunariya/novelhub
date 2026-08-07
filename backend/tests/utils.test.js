const { slugify } = require('../src/utils/slugify');
const { textToHtml, titleFromFilename } = require('../src/utils/parseChapterFile');
const { REACTIONS, toggleReaction } = require('../src/utils/reactions');
const { resolveGate, resolveCheckpoint, requirementsFor, needsLogin, nextCheckpointAfter } = require('../src/utils/readingGate');
const { GATE_RECURRENCE, GATE_REQUIREMENTS } = require('../src/config/constants');

describe('utils', () => {
  describe('readingGate', () => {
    const gate = (overrides) => ({
      engagementEnabled: true,
      engagementAfterChapter: 0,
      recurrence: GATE_RECURRENCE.ONCE,
      everyChapters: 10,
      chapterNumbers: [],
      requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT],
      escalateAfterChapter: 0,
      escalatedRequirements: [GATE_REQUIREMENTS.CHAPTER_COMMENT],
      ...overrides,
    });

    it('uses the novel gate only when it overrides', () => {
      const site = { engagementAfterChapter: 5 };
      expect(resolveGate(site, { override: false, engagementAfterChapter: 1 }).engagementAfterChapter).toBe(5);
      expect(resolveGate(site, { override: true, engagementAfterChapter: 1 }).engagementAfterChapter).toBe(1);
      expect(resolveGate(site, null).engagementAfterChapter).toBe(5);
    });

    it('leaves the free run ungated', () => {
      const config = gate({ engagementAfterChapter: 3 });
      expect(resolveCheckpoint(config, 1)).toBe(0);
      expect(resolveCheckpoint(config, 3)).toBe(0);
      expect(resolveCheckpoint(config, 4)).toBe(4);
    });

    it('points every later chapter at one checkpoint when asking once', () => {
      const config = gate({ engagementAfterChapter: 3, recurrence: GATE_RECURRENCE.ONCE });
      expect(resolveCheckpoint(config, 4)).toBe(4);
      expect(resolveCheckpoint(config, 50)).toBe(4);
    });

    it('makes every chapter its own checkpoint', () => {
      const config = gate({ recurrence: GATE_RECURRENCE.ALL });
      expect(resolveCheckpoint(config, 1)).toBe(1);
      expect(resolveCheckpoint(config, 7)).toBe(7);
    });

    it('walks back to the most recent interval checkpoint', () => {
      const config = gate({ recurrence: GATE_RECURRENCE.EVERY, engagementAfterChapter: 10, everyChapters: 10 });
      expect(resolveCheckpoint(config, 10)).toBe(0);
      expect(resolveCheckpoint(config, 11)).toBe(11);
      expect(resolveCheckpoint(config, 20)).toBe(11);
      expect(resolveCheckpoint(config, 21)).toBe(21);
    });

    it('walks back to the most recent listed checkpoint', () => {
      const config = gate({ recurrence: GATE_RECURRENCE.CHAPTERS, chapterNumbers: [5, 12] });
      expect(resolveCheckpoint(config, 4)).toBe(0);
      expect(resolveCheckpoint(config, 6)).toBe(5);
      expect(resolveCheckpoint(config, 12)).toBe(12);
      expect(resolveCheckpoint(config, 99)).toBe(12);
    });

    it('escalates requirements past the configured chapter', () => {
      const config = gate({ recurrence: GATE_RECURRENCE.ALL, escalateAfterChapter: 5 });
      expect(requirementsFor(config, 5)).toEqual([GATE_REQUIREMENTS.NOVEL_COMMENT]);
      expect(requirementsFor(config, 6)).toEqual([GATE_REQUIREMENTS.CHAPTER_COMMENT]);
    });

    it('falls back to the base requirements when the escalated set is empty', () => {
      const config = gate({ escalateAfterChapter: 5, escalatedRequirements: [] });
      expect(requirementsFor(config, 9)).toEqual([GATE_REQUIREMENTS.NOVEL_COMMENT]);
    });

    it('only demands a login past the free run when enabled', () => {
      expect(needsLogin({ loginEnabled: false, loginAfterChapter: 2 }, 9)).toBe(false);
      expect(needsLogin({ loginEnabled: true, loginAfterChapter: 2 }, 2)).toBe(false);
      expect(needsLogin({ loginEnabled: true, loginAfterChapter: 2 }, 3)).toBe(true);
    });

    it('reports the next checkpoint so readers can be warned', () => {
      const config = gate({ recurrence: GATE_RECURRENCE.EVERY, engagementAfterChapter: 10, everyChapters: 10 });
      expect(nextCheckpointAfter(config, 5)).toBe(11);
      expect(nextCheckpointAfter(config, 11)).toBe(21);
      expect(nextCheckpointAfter({ ...config, engagementEnabled: false }, 11)).toBe(0);
      expect(nextCheckpointAfter(gate({ recurrence: GATE_RECURRENCE.ONCE, engagementAfterChapter: 1 }), 9)).toBe(0);
      expect(nextCheckpointAfter(gate({ recurrence: GATE_RECURRENCE.ALL }), 4)).toBe(5);
      expect(
        nextCheckpointAfter(gate({ recurrence: GATE_RECURRENCE.CHAPTERS, chapterNumbers: [5, 12] }), 6)
      ).toBe(12);
    });
  });

  describe('toggleReaction', () => {
    const userId = 'user-1';

    it('adds and removes the reaction for the same user', () => {
      const doc = { likes: [], dislikes: [] };
      expect(toggleReaction(doc, REACTIONS.LIKE, userId)).toEqual({
        liked: true,
        disliked: false,
        likeCount: 1,
        dislikeCount: 0,
      });
      expect(toggleReaction(doc, REACTIONS.LIKE, userId)).toEqual({
        liked: false,
        disliked: false,
        likeCount: 0,
        dislikeCount: 0,
      });
    });

    it('clears the opposite reaction when switching', () => {
      const doc = { likes: [userId], dislikes: [] };
      expect(toggleReaction(doc, REACTIONS.DISLIKE, userId)).toEqual({
        liked: false,
        disliked: true,
        likeCount: 0,
        dislikeCount: 1,
      });
      expect(doc.likes).toEqual([]);
      expect(doc.dislikes).toEqual([userId]);
    });

    it('leaves other users reactions untouched', () => {
      const doc = { likes: ['user-2'], dislikes: ['user-3'] };
      const counts = toggleReaction(doc, REACTIONS.LIKE, userId);
      expect(counts).toEqual({ liked: true, disliked: false, likeCount: 2, dislikeCount: 1 });
      expect(doc.likes).toEqual(['user-2', userId]);
      expect(doc.dislikes).toEqual(['user-3']);
    });

    it('tolerates documents created before the dislikes field existed', () => {
      const doc = { likes: undefined, dislikes: undefined };
      expect(toggleReaction(doc, REACTIONS.DISLIKE, userId)).toEqual({
        liked: false,
        disliked: true,
        likeCount: 0,
        dislikeCount: 1,
      });
    });
  });

  describe('slugify', () => {
    it('converts titles to url-safe slugs', () => {
      expect(slugify('Blood Moon: Chronicles!')).toBe('blood-moon-chronicles');
      expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
      expect(slugify('UPPER_case_Title')).toBe('upper-case-title');
    });
  });

  describe('textToHtml', () => {
    it('converts paragraphs and escapes html', () => {
      expect(textToHtml('Hello <b>world</b>\n\nSecond & third')).toBe(
        '<p>Hello &lt;b&gt;world&lt;/b&gt;</p><p>Second &amp; third</p>'
      );
    });

    it('converts single newlines to line breaks', () => {
      expect(textToHtml('line one\nline two')).toBe('<p>line one<br/>line two</p>');
    });
  });

  describe('titleFromFilename', () => {
    it('derives readable titles from filenames', () => {
      expect(titleFromFilename('chapter-1-the-awakening.txt')).toBe('chapter 1 the awakening');
      expect(titleFromFilename('folder/chapter_2.docx')).toBe('chapter 2');
    });
  });
});
