// Server-side HTML sanitization for user-authored content.
//
// WHY THIS EXISTS SEPARATELY FROM frontend/src/utils/sanitizeContent.js:
// that file is a presentation cleaner. It strips Google Docs styling so pasted
// chapter text renders correctly across reader themes, and it runs in the
// browser. A sanitizer that runs in the browser is not a security control —
// the attacker controls that environment. Community post and comment bodies are
// attacker-authored HTML, so they must be sanitized on the server, on write.
//
// DESIGN: the policy (which tags, which attributes, which URL schemes, what
// `rel` to force) is this file's own code and is unit-testable on its own. The
// parsing and serialization engine is `sanitize-html`. Keeping them separate
// means swapping the engine later — DOMPurify under jsdom, say — changes one
// function, not the policy.
//
// DEFENCE IN DEPTH: sanitize on write AND escape on render. This is the write
// half. Neither half is sufficient alone.

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

// Schemes that execute or smuggle. `data:` is included because `data:text/html`
// is a script vector, and allowing only image data URLs is not worth the
// parsing surface — images go through the upload pipeline instead.
const DANGEROUS_SCHEMES = new Set([
  'javascript', 'vbscript', 'data', 'file', 'blob', 'about', 'jar', 'view-source',
]);

const SAFE_SCHEMES = ['http', 'https', 'mailto'];

// Link rel is forced, never inherited from the input:
//   noopener/noreferrer — stops window.opener tab-nabbing
//   nofollow ugc        — tells crawlers this is user-generated and unvouched.
//                         Without it the community becomes an SEO spam target,
//                         and adding it later does not undo the damage.
const FORCED_REL = 'noopener noreferrer nofollow ugc';

/**
 * Characters a browser ignores when resolving a URL scheme.
 *
 * `java\tscript:`, `java\0script:` and `java​script:` all execute, so a
 * check against the raw string does not see the scheme it is trying to block.
 * Expressed as code point ranges rather than a regex character class — the
 * literal characters do not survive being copied between files, and the ranges
 * say what they mean.
 */
const isIgnorable = (ch) => {
  const c = ch.codePointAt(0);
  return (
    c <= 0x20 || // C0 controls and space
    (c >= 0x7f && c <= 0x9f) || // DEL and C1 controls
    c === 0xa0 || // no-break space
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200f) || // en/em spaces, zero-width, bidi marks
    c === 0x2028 || c === 0x2029 || // line/paragraph separators
    c === 0x202f || c === 0x205f || c === 0x2060 ||
    c === 0x3000 || // ideographic space
    c === 0xfeff // BOM / zero-width no-break space
  );
};

/**
 * Is this URL safe to keep as an href/src?
 *
 * Rejects dangerous schemes, the control characters used to smuggle them, and
 * protocol-relative URLs, which inherit the page's scheme and slip past a naive
 * http/https check.
 *
 * Exported because it is the part most worth testing directly, and because the
 * Phase 4 link policy reuses it.
 */
const isSafeUrl = (value) => {
  if (typeof value !== 'string') return false;

  const cleaned = [...value].filter((ch) => !isIgnorable(ch)).join('');
  if (!cleaned) return false;

  // Protocol-relative: //evil.com inherits the current scheme.
  if (cleaned.startsWith('//')) return false;
  // Backslash forms some parsers normalise into protocol-relative.
  if (cleaned.startsWith('\\')) return false;

  const match = SCHEME.exec(cleaned);
  if (!match) return true; // relative path or anchor

  const scheme = match[1].toLowerCase();
  if (DANGEROUS_SCHEMES.has(scheme)) return false;
  return SAFE_SCHEMES.includes(scheme);
};

/**
 * Content profiles.
 *
 * Comments get less than posts because a comment does not need headings,
 * tables or images to do its job, and every allowed tag is surface area.
 */
const PROFILES = {
  post: {
    allowedTags: [
      'p', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      code: ['class'], // language-* for syntax highlighting
      span: ['class'],
      div: ['class'],
    },
  },

  comment: {
    allowedTags: [
      'p', 'br',
      'strong', 'b', 'em', 'i', 'u', 's',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      code: ['class'],
      span: ['class'],
    },
  },

  spaceDescription: {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u',
      'ul', 'ol', 'li', 'a', 'h3', 'h4', 'blockquote', 'code',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
    },
  },

  // Titles, flair text, rule headings. No markup at all.
  plain: {
    allowedTags: [],
    allowedAttributes: {},
  },
};

// No `style` attribute on anything, in any profile. Inline style is a CSS
// injection surface and it breaks theming — which is why the existing reader
// strips it from pasted chapter content too.
const FORBIDDEN_ATTRIBUTES = ['style', 'onerror', 'onload', 'onclick', 'srcset', 'formaction'];

// A bare class attribute lets a post borrow the app's own styles to build a
// convincing fake UI — a fake login prompt, a fake admin banner. Prefix filter.
const ALLOWED_CLASS_PREFIXES = ['language-', 'hljs', 'spoiler'];

const filterClasses = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .split(/\s+/)
    .filter((name) => ALLOWED_CLASS_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix)))
    .join(' ');
};

const classOnly = (tagName) => (name, attribs) => {
  const cls = filterClasses(attribs.class);
  return { tagName, attribs: cls ? { class: cls } : {} };
};

/**
 * Build the options object for the engine.
 *
 * Exported so the policy can be asserted in tests without the engine being
 * installed. The shape of the allowlist *is* the security boundary, so it is
 * worth testing on its own.
 */
const buildOptions = (profileName = 'post') => {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown sanitize profile: ${profileName}`);

  return {
    allowedTags: [...profile.allowedTags],
    allowedAttributes: JSON.parse(JSON.stringify(profile.allowedAttributes)),
    allowedSchemes: SAFE_SCHEMES,
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    // Dropped along with their contents — these can carry executable payload,
    // so keeping the inner text would be keeping the attack.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
    enforceHtmlBoundary: true,
    transformTags: {
      a: (tagName, attribs) => {
        if (!isSafeUrl(attribs.href)) {
          // Drop the href, keep the link text. Removing the element would
          // silently delete what the user wrote.
          return { tagName: 'a', attribs: { rel: FORCED_REL } };
        }
        return {
          tagName: 'a',
          attribs: {
            href: attribs.href,
            ...(attribs.title ? { title: attribs.title } : {}),
            rel: FORCED_REL,
            target: '_blank',
          },
        };
      },
      img: (tagName, attribs) => {
        if (!isSafeUrl(attribs.src)) return { tagName: 'span', attribs: {} };
        return {
          tagName: 'img',
          attribs: {
            src: attribs.src,
            alt: attribs.alt || '',
            ...(attribs.width ? { width: attribs.width } : {}),
            ...(attribs.height ? { height: attribs.height } : {}),
            loading: 'lazy',
          },
        };
      },
      code: classOnly('code'),
      span: classOnly('span'),
      div: classOnly('div'),
    },
  };
};

let engine = null;
const loadEngine = () => {
  if (engine) return engine;
  try {
    // eslint-disable-next-line global-require
    engine = require('sanitize-html');
  } catch (error) {
    // Deliberately fatal. A sanitizer that degrades to a pass-through when its
    // dependency is missing is worse than no sanitizer at all, because the
    // calling code believes it is protected.
    throw new Error(
      'sanitize-html is not installed. User HTML cannot be sanitized safely without it. ' +
        'Run `npm install` in backend/.'
    );
  }
  return engine;
};

/** Is the engine available? Lets a caller degrade deliberately rather than crash. */
const isAvailable = () => {
  try {
    loadEngine();
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Sanitize user-authored HTML.
 *
 * @param {string} dirty
 * @param {string} profile  'post' | 'comment' | 'spaceDescription' | 'plain'
 * @returns {string} safe HTML
 */
const sanitize = (dirty, profile = 'post') => {
  if (typeof dirty !== 'string' || !dirty) return '';
  return loadEngine()(dirty, buildOptions(profile));
};

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
};

/**
 * Strip every tag and collapse whitespace.
 *
 * `bodyText` feeds the text index and the banned-word scanner. Both must see
 * exactly what the sanitizer kept — deriving it separately is how the two
 * drift, and a banned word hidden inside markup the scanner never sees is a
 * bypass. So this always runs against already-sanitized HTML.
 */
const toText = (safeHtml) => {
  if (typeof safeHtml !== 'string' || !safeHtml) return '';
  let text = loadEngine()(safeHtml, { allowedTags: [], allowedAttributes: {} });
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  return text.replace(/\s+/g, ' ').trim();
};

/**
 * The call every controller should use: one pass, both outputs, guaranteed
 * consistent.
 *
 *   const { html, text } = sanitizeHtml.process(req.body.body, 'post');
 */
const process = (dirty, profile = 'post') => {
  const html = sanitize(dirty, profile);
  return { html, text: toText(html) };
};

module.exports = {
  sanitize,
  toText,
  process,
  isAvailable,
  // Exported for tests, and reused by the Phase 4 link policy.
  isSafeUrl,
  isIgnorable,
  buildOptions,
  filterClasses,
  PROFILES,
  FORCED_REL,
  SAFE_SCHEMES,
  DANGEROUS_SCHEMES,
  FORBIDDEN_ATTRIBUTES,
  ALLOWED_CLASS_PREFIXES,
};
