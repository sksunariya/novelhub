// The site's public address: the one readers type into a browser.
//
// Anything the server hands to someone outside it has to be absolute and has to
// point here: the "View Details" button in a notification email, the <loc>
// entries of the sitemap, the Sitemap line in robots.txt, and the pages PayPal
// sends a buyer back to.
//
// Those used to read their own variables with their own fallbacks. The mailer
// read APP_URL, which is set nowhere (not even in .env.example), and fell back
// to http://localhost:5173, so every notification email sent from a server
// linked to the reader's own machine. They all resolve through here now.
//
// Resolution order:
//   1. APP_URL    - optional override, kept because the mailer always read it.
//   2. CLIENT_URL - the frontend's address; CORS already depends on it.
// The first value that parses as an absolute http(s) URL wins. There is no
// built-in fallback: with neither set this returns '' and callers leave the
// link out. A localhost URL only ever appears because it was configured.

const SOURCES = ['APP_URL', 'CLIENT_URL'];

/** An absolute http(s) URL without its trailing slash, or '' when `value` is not one. */
const normalise = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  // A path is kept (a site served from a sub-path); a query or hash is not.
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
};

/** True for localhost, *.localhost, 127.0.0.0/8, 0.0.0.0 and [::1]. */
const isLoopback = (value) => {
  let hostname;
  try {
    ({ hostname } = new URL(value));
  } catch {
    return false;
  }
  return (
    /(^|\.)localhost$/i.test(hostname) ||
    /^127(\.\d{1,3}){3}$/.test(hostname) ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  );
};

/**
 * The configured public base URL without a trailing slash, or '' when none is.
 * Read on every call, not at load, so tests and scripts can change the env.
 */
const publicBaseUrl = () => {
  for (const name of SOURCES) {
    const base = normalise(process.env[name]);
    if (base) return base;
  }
  return '';
};

/**
 * A link to a loopback address ("http://localhost:5173/novel/x", pasted by an
 * admin working on a local copy) as the site path it stands for ("/novel/x").
 * Anything else is returned unchanged. A localhost link is never right for a
 * reader, so notifications store the path and the mailer puts the real host
 * back in front of it.
 */
const stripLoopbackOrigin = (link) => {
  if (typeof link !== 'string' || !/^\s*https?:\/\//i.test(link)) return link;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return link;
  }
  return isLoopback(url.href) ? `${url.pathname}${url.search}${url.hash}` : link;
};

/**
 * Turn a stored site link ("/novel/slug") into one that works outside the site.
 *
 * A path is joined to the public base. An absolute http(s) link is returned
 * unchanged, unless it points at a loopback address, in which case its path is
 * moved onto the public base. Returns '' when there is nothing usable, so the
 * caller can drop the link. A protocol-relative "//host/..." or another scheme
 * ("javascript:", "mailto:") is refused rather than treated as a path.
 */
const absoluteUrl = (link, base = publicBaseUrl()) => {
  if (typeof link !== 'string') return '';
  const trimmed = stripLoopbackOrigin(link.trim());
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!base || trimmed.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return '';
  return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
};

/**
 * Where to send a browser back to mid-flow (PayPal return and cancel pages).
 *
 * The request's own Origin wins: it is the address this reader is actually on,
 * which also keeps local development and staging working. The configured public
 * URL covers a request that carries none.
 */
const clientBaseUrl = (req) => normalise(req && req.headers ? req.headers.origin : '') || publicBaseUrl();

/**
 * Log, once at startup, a configuration that would send broken links.
 * Returns the problems found so tests can assert on them.
 */
const warnIfMisconfigured = (log = console.warn) => {
  const problems = [];

  SOURCES.forEach((name) => {
    const raw = process.env[name];
    if (raw && raw.trim() && !normalise(raw)) {
      problems.push(`${name}="${raw}" is not a valid absolute http(s) URL, so it is ignored.`);
    }
  });

  const base = publicBaseUrl();
  if (!base) {
    problems.push(
      'No public site URL is configured. Set CLIENT_URL to the address readers use (for example https://example.com). ' +
        'Until then notification emails go out without a link and sitemap URLs are relative.'
    );
  } else if (isLoopback(base) && (process.env.NODE_ENV === 'production' || process.env.SMTP_HOST)) {
    problems.push(
      `Links in outgoing email and the sitemap point at ${base}. ` +
        'On a server, set CLIENT_URL (or APP_URL) to the address readers use, for example https://example.com.'
    );
  }

  problems.forEach((problem) => log(`[publicUrl] ${problem}`));
  return problems;
};

module.exports = {
  normalise,
  isLoopback,
  publicBaseUrl,
  stripLoopbackOrigin,
  absoluteUrl,
  clientBaseUrl,
  warnIfMisconfigured,
};
