require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const SiteSettings = require('./models/SiteSettings');
const { ROLES } = require('./config/constants');

const LOGO_SOURCE = path.join(__dirname, '..', '..', 'assets', 'logo.PNG');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const seedLogo = async (settings) => {
  if (settings.logoUrl || !fs.existsSync(LOGO_SOURCE)) {
    return;
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  fs.copyFileSync(LOGO_SOURCE, path.join(UPLOAD_DIR, 'logo.png'));
  settings.logoUrl = '/uploads/logo.png';
  settings.faviconUrl = '/uploads/logo.png';
  await settings.save();
  console.info('Default logo installed from assets/logo.PNG');
};

const seed = async () => {
  await connectDB(process.env.MONGO_URI);
  const email = process.env.ADMIN_EMAIL || 'admin@novelhub.com';
  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({
      username: process.env.ADMIN_USERNAME || 'user',
      email,
      password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
      role: ROLES.USER,
    });
    console.info(`Admin user created: ${email}`);
  } else {
    console.info('Admin user already exists');
  }
  const settings = await SiteSettings.getSettings();
  await seedLogo(settings);
  await mongoose.disconnect();
};

seed();
