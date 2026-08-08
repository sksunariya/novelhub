// Utilities for keeping chapter content readable across every reader theme.
//
// Pasted rich text from Google Docs often has two major issues:
//   1. Hardcoded inline colors that break across reader themes.
//   2. Every paragraph arrives as an <h1> (with inline font-size to look normal
//      in Docs), and empty <h1> tags act as line spacers — creating massive
//      vertical gaps on the site.
// These utilities fix both problems at paste time and at render time.

// Properties that pin text/background color regardless of the reader theme.
const COLOR_PROPS = ['color', 'background-color', 'background'];

// Inline style properties that Google Docs adds which should be stripped so
// that the reader's chosen font, size, and color take effect.
const GDOCS_JUNK_PROPS = ['color', 'font-family', 'font-size', 'background-color', 'background'];

const parseHtml = (html) => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(html, 'text/html');
};

const stripStyleProps = (doc, props) => {
  doc.querySelectorAll('[style]').forEach((el) => {
    props.forEach((prop) => el.style.removeProperty(prop));
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  });
  // Legacy presentational attribute, e.g. <font color="white">.
  doc.querySelectorAll('[color]').forEach((el) => el.removeAttribute('color'));
};

// Google Docs pastes body text as <h1> with an inline font-size (e.g. 13pt).
// Convert these fake headings back to <p> tags so they render as normal prose.
const demoteGDocsHeadings = (doc) => {
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    // A real heading will typically be short and intentional. Google Docs fakes
    // use inline font-size on a <span> child that looks like body text.
    // Safest heuristic: if *any* child span carries an explicit font-size
    // that is body-text sized (≤ 16pt / ≤ 21px), treat it as a paragraph.
    const spans = heading.querySelectorAll('span[style]');
    const isGDocsFake =
      spans.length > 0 &&
      [...spans].some((span) => {
        const fs = span.style.fontSize;
        if (!fs) return false;
        const val = parseFloat(fs);
        if (fs.endsWith('pt')) return val <= 16;
        if (fs.endsWith('px')) return val <= 21;
        return false;
      });

    if (isGDocsFake) {
      const p = doc.createElement('p');
      // Preserve inline attributes (e.g. dir, style) but switch the tag.
      [...heading.attributes].forEach((attr) => p.setAttribute(attr.name, attr.value));
      p.innerHTML = heading.innerHTML;
      heading.replaceWith(p);
    }
  });
};

// Remove empty block-level elements (p, h1-h6, div) that act as spacers.
// Google Docs (and others) insert these between real paragraphs, and each one
// takes up full margin + line-height, creating excessive spacing.
const stripEmptyBlocks = (doc) => {
  doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div').forEach((el) => {
    // "Empty" = no visible text content after trimming whitespace.
    if (el.textContent.trim() === '') {
      el.remove();
    }
  });
};

// Unwrap spans that have no remaining attributes (after style stripping).
// This cleans up the DOM so we don't have <p><span>text</span></p> everywhere.
const unwrapNakedSpans = (doc) => {
  doc.querySelectorAll('span').forEach((span) => {
    if (!span.attributes.length) {
      span.replaceWith(...span.childNodes);
    }
  });
};

// Used on paste in the editor: fully sanitise Google Docs clipboard HTML.
// Drops colors, demotes fake headings, removes empty spacers, and strips
// inline font-size/font-family so the reader theme controls appearance.
export const stripPastedColors = (html) => {
  if (!html) return html;
  const doc = parseHtml(html);
  if (!doc) return html;
  demoteGDocsHeadings(doc);
  stripStyleProps(doc, GDOCS_JUNK_PROPS);
  stripEmptyBlocks(doc);
  unwrapNakedSpans(doc);
  return doc.body.innerHTML;
};

// Used when rendering in the reader: fix chapters that were saved before
// these sanitisation rules existed. Demotes fake headings, strips hardcoded
// text color, removes empty spacers, and cleans up leftover spans.
export const stripTextColor = (html) => {
  if (!html) return html;
  const doc = parseHtml(html);
  if (!doc) return html;
  demoteGDocsHeadings(doc);
  stripStyleProps(doc, GDOCS_JUNK_PROPS);
  stripEmptyBlocks(doc);
  unwrapNakedSpans(doc);
  return doc.body.innerHTML;
};

