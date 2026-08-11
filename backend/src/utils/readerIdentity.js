// Stable identity for a reader, signed in or not.
//
// The existing view dedup keys anonymous readers on `ip:${req.ip}`. Behind a
// CDN, corporate NAT or mobile carrier NAT that collapses thousands of distinct
// readers into one — and it undercounts worst in exactly the markets with the
// most shared egress. A signed cookie gives each browser its own identity
// without storing anything personal.

const crypto = require('crypto');

const COOKIE_NAME = 'nh_did';
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // browser cap for cookies

// Conservative list: matching a crawler wrongly loses one read, matching a real
// reader wrongly would inflate every funnel denominator.
const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discordbot|preview|headless|phantom|curl|wget|python-requests|axios|go-http|scrapy|lighthouse|pingdom|uptime/i;

const isBot = (userAgent) => (userAgent ? BOT_PATTERN.test(userAgent) : true);

const secret = () => process.env.JWT_SECRET || 'device-id-fallback';

const sign = (value) =>
  crypto.createHmac('sha256', secret()).update(value).digest('base64url').slice(0, 22);

const parseCookies = (header) => {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
};

/** Verify a cookie we issued; reject anything tampered with. */
const readDeviceId = (req) => {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw || !raw.includes('.')) return null;
  const [id, signature] = raw.split('.');
  if (!id || !signature) return null;
  return sign(id) === signature ? id : null;
};

const issueDeviceId = (res) => {
  const id = crypto.randomBytes(12).toString('base64url');
  const value = `${id}.${sign(id)}`;
  res.cookie(COOKIE_NAME, value, {
    maxAge: COOKIE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return id;
};

/**
 * Identity for analytics.
 *
 * Signed-in readers key on their user id so the same person on phone and laptop
 * counts once. Anonymous readers get a device cookie, issued on the fly.
 */
const resolveReader = (req, res) => {
  if (req.user) return { readerKey: `u:${req.user._id}`, user: req.user._id, anonymous: false };
  const existing = readDeviceId(req);
  const deviceId = existing || (res ? issueDeviceId(res) : null);
  if (!deviceId) return null;
  return { readerKey: `d:${deviceId}`, user: null, anonymous: true };
};

/** UTC day bucket. Reports must not shift with the server's timezone. */
const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

module.exports = { resolveReader, readDeviceId, issueDeviceId, isBot, dayKey, COOKIE_NAME, parseCookies };
