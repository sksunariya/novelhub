const { slugify } = require('../src/utils/slugify');
const { textToHtml, titleFromFilename } = require('../src/utils/parseChapterFile');

describe('utils', () => {
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
