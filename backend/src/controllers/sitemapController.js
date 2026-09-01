const Space = require('../models/Space');
const Post = require('../models/Post');
const settingsService = require('../services/settingsService');
const cacheService = require('../services/cacheService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { SPACE_STATUS, SPACE_VISIBILITY, POST_STATUS } = require('../config/constants');

// Sitemaps and robots.txt.
//
// SEGMENTED BY CONTENT TYPE, not one giant file. A single sitemap on a large
// site is slow to generate, slow to fetch, and gives no signal about which
// section changed — segmenting means a crawler can re-fetch just the part that
// moved.
//
// WHY THIS EXISTS EVEN THOUGH THERE IS NO SSR: a sitemap is plain XML served by
// the API. It costs nothing, it is correct regardless of how pages render, and
// it is part of what keeps a later move to prerendering cheap rather than a
// from-scratch SEO project.
//
// Cached, because a crawler hitting an uncached sitemap on a large collection
// is a self-inflicted load spike.

const MAX_URLS = 45000; // the spec allows 50,000; leave headroom
const CACHE_SECONDS = 3600;

const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const baseUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');

const urlEntry = ({ loc, lastmod, changefreq, priority }) =>
  `  <url>\n    <loc>${escapeXml(loc)}</loc>\n` +
  (lastmod ? `    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>\n` : '') +
  (changefreq ? `    <changefreq>${changefreq}</changefreq>\n` : '') +
  (priority ? `    <priority>${priority}</priority>\n` : '') +
  '  </url>';

const wrap = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`;

const send = (res, xml) => {
  res.type('application/xml');
  res.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  res.send(xml);
};

const communityEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  return snapshot.get('spaces.enabled') && snapshot.get('spaces.publicBrowsing');
};

/** The index. Points at each segment rather than listing every URL. */
const sitemapIndex = asyncHandler(async (req, res) => {
  const base = baseUrl();
  const segments = ['spaces', 'posts'];
  if (!(await communityEnabled())) {
    return send(res, wrap([]));
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    segments
      .map((s) => `  <sitemap>\n    <loc>${base}/sitemap-${s}.xml</loc>\n  </sitemap>`)
      .join('\n') +
    `\n</sitemapindex>`;
  res.type('application/xml');
  res.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  return res.send(xml);
});

const spacesSitemap = asyncHandler(async (req, res) => {
  if (!(await communityEnabled())) return send(res, wrap([]));

  const xml = await cacheService.wrap('sitemap:spaces', CACHE_SECONDS, async () => {
    const spaces = await Space.find({
      status: SPACE_STATUS.ACTIVE,
      visibility: SPACE_VISIBILITY.PUBLIC,
      excludeFromAll: { $ne: true },
    })
      .select('slug lastPostAt updatedAt postCount')
      .sort({ memberCount: -1 })
      .limit(MAX_URLS)
      .lean();

    const base = baseUrl();
    return wrap(
      spaces
        // An empty space is thin content. Listing it invites a crawl that finds
        // nothing and counts against the whole domain.
        .filter((space) => (space.postCount || 0) > 0)
        .map((space) =>
          urlEntry({
            loc: `${base}/c/${space.slug}`,
            lastmod: space.lastPostAt || space.updatedAt,
            changefreq: 'daily',
            priority: '0.7',
          })
        )
    );
  });

  return send(res, xml);
});

const postsSitemap = asyncHandler(async (req, res) => {
  if (!(await communityEnabled())) return send(res, wrap([]));

  const xml = await cacheService.wrap('sitemap:posts', CACHE_SECONDS, async () => {
    // Public spaces only, resolved once rather than joined per post.
    const spaces = await Space.find({
      status: SPACE_STATUS.ACTIVE,
      visibility: SPACE_VISIBILITY.PUBLIC,
      excludeFromAll: { $ne: true },
    })
      .select('slug')
      .lean();
    const slugById = new Map(spaces.map((s) => [String(s._id), s.slug]));

    const posts = await Post.find({
      space: { $in: [...slugById.keys()] },
      status: POST_STATUS.PUBLISHED,
      nsfw: { $ne: true },
      // Same thin-content rule the page's noindex applies. A sitemap that
      // contradicts the page's own robots directive wastes crawl budget on
      // pages it has been told not to index.
      $or: [{ commentCount: { $gt: 0 } }, { score: { $gt: 1 } }],
    })
      .select('titleSlug space lastActivityAt createdAt')
      .sort({ lastActivityAt: -1 })
      .limit(MAX_URLS)
      .lean();

    const base = baseUrl();
    return wrap(
      posts.map((post) =>
        urlEntry({
          loc: `${base}/c/${slugById.get(String(post.space))}/p/${post._id}/${post.titleSlug || ''}`,
          lastmod: post.lastActivityAt || post.createdAt,
          changefreq: 'weekly',
          priority: '0.5',
        })
      )
    );
  });

  return send(res, xml);
});

/**
 * robots.txt.
 *
 * Blocks sort, filter and deep pagination at the ROBOTS layer rather than with
 * `noindex`. A noindex page still has to be fetched for the directive to be
 * seen, so it consumes crawl budget; a robots rule stops the crawl before it
 * starts. On a large UGC site that difference is the whole game.
 */
const robots = asyncHandler(async (req, res) => {
  const base = baseUrl();
  const enabled = await communityEnabled();

  const lines = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/',
  ];

  if (enabled) {
    lines.push(
      // Every sort and filter variant canonicalises to the post URL anyway;
      // crawling them is pure waste.
      'Disallow: /community/*?sort=',
      'Disallow: /community/*?t=',
      'Disallow: /community/*?cursor=',
      'Disallow: /c/*?sort=',
      'Disallow: /c/*?t=',
      'Disallow: /c/*?cursor=',
      'Disallow: /community/submit',
      'Disallow: /community/create',
      'Disallow: /c/*/submit',
      'Disallow: /c/*/mod'
    );
  } else {
    lines.push('Disallow: /community', 'Disallow: /c/');
  }

  lines.push('', `Sitemap: ${base}/sitemap.xml`);

  res.type('text/plain');
  res.set('Cache-Control', 'public, max-age=3600');
  return res.send(lines.join('\n'));
});

module.exports = { sitemapIndex, spacesSitemap, postsSitemap, robots };
