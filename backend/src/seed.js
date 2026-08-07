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

const CarouselSlide = require('./models/CarouselSlide');
const Novel = require('./models/Novel');

const seedCarouselSlides = async (adminId) => {
  const count = await CarouselSlide.countDocuments();
  if (count > 0) return;

  const novels = await Novel.find({ published: true }).limit(3);

  const sampleSlides = [
    {
      title: novels[0]?.title || 'Shadow Monarch Returns',
      subtitle: 'EXCLUSIVE RELEASE • CHAPTER 50 OUT NOW',
      description: novels[0]?.synopsis || 'Step into the abyss of shadows where power meets fate. Follow the journey of the strongest necromancer.',
      imageUrl: novels[0]?.coverUrl || '',
      badgeText: 'FEATURED',
      badgeColor: 'crimson',
      primaryButtonText: 'Start Reading',
      primaryButtonUrl: novels[0] ? `/novel/${novels[0].slug}` : '/browse',
      secondaryButtonText: 'Top Rankings',
      secondaryButtonUrl: '/rankings',
      novelId: novels[0]?._id || null,
      autoSyncWithNovel: true,
      themeStyle: 'dark-crimson',
      order: 0,
      isActive: true,
      createdBy: adminId,
    },
    {
      title: novels[1]?.title || 'The Sovereign Cultivator',
      subtitle: 'POPULAR THIS WEEK • 120+ CHAPTERS',
      description: novels[1]?.synopsis || 'Reborn into a ruined clan with an ancient sovereign relic, a young martial artist defies celestial judgment.',
      imageUrl: novels[1]?.coverUrl || '',
      badgeText: 'TRENDING #1',
      badgeColor: 'amber',
      primaryButtonText: 'Read Ch. 1',
      primaryButtonUrl: novels[1] ? `/novel/${novels[1].slug}` : '/browse',
      secondaryButtonText: 'Browse All',
      secondaryButtonUrl: '/browse',
      novelId: novels[1]?._id || null,
      autoSyncWithNovel: true,
      themeStyle: 'dark-gold',
      order: 1,
      isActive: true,
      createdBy: adminId,
    },
  ];

  await CarouselSlide.insertMany(sampleSlides);
  console.info('Sample carousel slides seeded successfully');
};

const seed = async () => {
  await connectDB(process.env.MONGO_URI);
  const email = process.env.ADMIN_EMAIL || 'admin@novelhub.com';
  let adminUser = await User.findOne({ email });
  if (!adminUser) {
    adminUser = await User.create({
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
  await seedCarouselSlides(adminUser._id);
  await mongoose.disconnect();
};

seed();
