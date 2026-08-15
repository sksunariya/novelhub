const express = require('express');
const cors = require('cors');
const path = require('path');
// Register every model up front so indexes are built regardless of which
// services happen to require them, and when.
require('./models');
const authRoutes = require('./routes/authRoutes');
const novelRoutes = require('./routes/novelRoutes');
const communityRoutes = require('./routes/communityRoutes');
const spaceRoutes = require('./routes/spaceRoutes');
const postRoutes = require('./routes/postRoutes');
const feedRoutes = require('./routes/feedRoutes');
const postCommentRoutes = require('./routes/commentRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const reportRoutes = require('./routes/reportRoutes');
const communityUserRoutes = require('./routes/communityUserRoutes');
const libraryRoutes = require('./routes/libraryRoutes');
const walletRoutes = require('./routes/walletRoutes');
const storeRoutes = require('./routes/storeRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const carouselRoutes = require('./routes/carouselRoutes');
const adminRoutes = require('./routes/adminRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const maintenanceGuard = require('./middlewares/maintenance');
const requestLogger = require('./middlewares/requestLogger');
const { securityHeaders, cspReportHandler, REPORT_PATH } = require('./middlewares/securityHeaders');
const { optionalAuth } = require('./middlewares/auth');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const sitemap = require('./controllers/sitemapController');

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CLIENT_URL || true }));
app.use(express.json({ limit: '5mb' }));
// Report-only until CSP_ENFORCE=true. See middlewares/securityHeaders.js.
app.use(securityHeaders());
app.use(requestLogger);

// Violation reports. Browsers send application/csp-report, which express.json
// does not match on its own, so the type is declared explicitly. Mounted ahead
// of the maintenance guard — reports are diagnostics and must keep arriving
// while the site is down.
app.post(REPORT_PATH, express.json({ type: ['application/csp-report', 'application/json'], limit: '64kb' }), cspReportHandler);

// nosniff and no-cache on user uploads: an uploaded file whose bytes are HTML
// must never be sniffed and executed, and a moderated-away image should not
// linger in a shared cache.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  })
);

// Sitemaps and robots.txt sit OUTSIDE /api — a crawler expects them at the
// site root, and they must keep serving during maintenance so a crawl does not
// record the whole site as gone.
app.get('/sitemap.xml', sitemap.sitemapIndex);
app.get('/sitemap-spaces.xml', sitemap.spacesSitemap);
app.get('/sitemap-posts.xml', sitemap.postsSitemap);
app.get('/robots.txt', sitemap.robots);

// Liveness probe. Must not depend on the database or on maintenance mode.
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Payment webhooks are mounted OUTSIDE /api, ahead of the maintenance guard.
// Inside /api they would be 503'd whenever maintenance mode is on; PayPal
// would retry for days, give up, and buyers who paid would never be credited.
app.use('/webhooks', webhookRoutes);

// optionalAuth runs before the guard so its admin exemption actually works.
// Previously req.user was only populated inside the routers, which run after
// the guard, so the exemption was dead code and admins were locked out of
// their own site during maintenance.
app.use('/api', optionalAuth, maintenanceGuard);

app.use('/api/auth', authRoutes);
app.use('/api/novels', novelRoutes);
// Chapter comments and reviews. A different feature with a different data
// model — deliberately not merged with the community system below.
app.use('/api/community', communityRoutes);
// The community: user-created spaces. Every route 404s while spaces.enabled
// is false, so this can ship to production long before it is launched.
app.use('/api/spaces', spaceRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/comments', postCommentRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/u', communityUserRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/carousel', carouselRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
