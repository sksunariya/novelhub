const { slugify } = require('../src/utils/slugify');
const { textToHtml, titleFromFilename } = require('../src/utils/parseChapterFile');
const { REACTIONS, toggleReaction } = require('../src/utils/reactions');

describe('utils', () => {
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
