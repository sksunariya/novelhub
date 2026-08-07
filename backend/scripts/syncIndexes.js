require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Review = require('../src/models/Review');

const run = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/novelhub';
  console.log('Connecting to MongoDB...');
  await connectDB(uri);

  console.log('Dropping legacy unique review index if present...');
  try {
    await Review.collection.dropIndex('novel_1_chapter_1_user_1');
    console.log('Successfully dropped legacy index "novel_1_chapter_1_user_1".');
  } catch (err) {
    console.log('Legacy index "novel_1_chapter_1_user_1" not found or already dropped.');
  }

  console.log('Syncing Review model indexes with MongoDB...');
  await Review.syncIndexes();
  console.log('Review model indexes synced successfully.');

  await mongoose.disconnect();
  console.log('Done!');
  process.exit(0);
};

run().catch((err) => {
  console.error('Error syncing indexes:', err);
  process.exit(1);
});
