const express = require('express');
const cors = require('cors');
const path = require('path');
// Register every model up front so indexes are built regardless of which
// services happen to require them, and when.
require('./models');
const authRoutes = require('./routes/authRoutes');
const novelRoutes = require('./routes/novelRoutes');
const communityRoutes = require('./routes/communityRoutes');
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
const { optionalAuth } = require('./middlewares/auth');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CLIENT_URL || true }));
app.use(express.json({ limit: '5mb' }));
app.use(requestLogger);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
app.use('/api/community', communityRoutes);
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
