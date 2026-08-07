const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const novelRoutes = require('./routes/novelRoutes');
const communityRoutes = require('./routes/communityRoutes');
const libraryRoutes = require('./routes/libraryRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const carouselRoutes = require('./routes/carouselRoutes');
const adminRoutes = require('./routes/adminRoutes');
const maintenanceGuard = require('./middlewares/maintenance');
const requestLogger = require('./middlewares/requestLogger');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CLIENT_URL || true }));
app.use(express.json({ limit: '5mb' }));
app.use(requestLogger);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api', maintenanceGuard);
app.use('/api/auth', authRoutes);
app.use('/api/novels', novelRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/carousel', carouselRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
