// Utilities for keeping chapter content readable across every reader theme.
//
// Pasted rich text often carries hardcoded colors (e.g. `color: rgb(255,255,255)`)
// from the source. Those inline colors override the reader theme, so white text
// that looks fine on the dark theme becomes invisible on the light/sepia themes.
// We strip them so chapter text always inherits the active theme's color.

// Properties that pin text/background color regardless of the reader theme.
const COLOR_PROPS = ['color', 'background-color', 'background'];

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

// Used on paste in the editor: drop both text and background colors so pasted
// text starts clean. Authors can still apply colors afterward via the toolbar.
export const stripPastedColors = (html) => {
  if (!html) return html;
  const doc = parseHtml(html);
  if (!doc) return html;
  stripStyleProps(doc, COLOR_PROPS);
  return doc.body.innerHTML;
};

// Used when rendering in the reader: drop hardcoded text color so prose always
// follows the reader theme, fixing chapters that were saved with pasted colors.
export const stripTextColor = (html) => {
  if (!html) return html;
  const doc = parseHtml(html);
  if (!doc) return html;
  stripStyleProps(doc, ['color']);
  return doc.body.innerHTML;
};
