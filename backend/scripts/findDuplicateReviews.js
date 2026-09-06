// Pre-flight for the unique (novel, chapter, user) review index.
//
// Run BEFORE deploying the index. It only reports; nothing is written. If it
// finds anything, decide per group which review to keep — usually the most
// recently edited — and soft-delete the rest, then re-run until it is clean.
//
//   node scripts/findDuplicateReviews.js

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Review = require('../src/models/Review');

const run = async () => {
  await connectDB(process.env.MONGO_URI);

  const groups = await Review.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: { novel: '$novel', chapter: '$chapter', user: '$user' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
        ratings: { $push: '$rating' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]).option({ withDeleted: true });

  if (!groups.length) {
    console.log('No duplicate reviews. The unique index will build cleanly.');
  } else {
    console.log(`${groups.length} duplicate group(s) — the index will NOT build until these are resolved:\n`);
    for (const group of groups) {
      console.log(
        `  novel=${group._id.novel} chapter=${group._id.chapter || '-'} user=${group._id.user}` +
          ` — ${group.count} reviews, ratings [${group.ratings.join(', ')}]`
      );
      console.log(`    ids: ${group.ids.join(', ')}`);
    }
    console.log('\nKeep one per group (usually the newest) and soft-delete the rest.');
  }

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
