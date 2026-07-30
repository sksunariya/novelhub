/**
 * One-time migration: sync database indexes with the current schemas.
 *
 * The soft-delete feature changed several unique indexes to *partial* unique
 * indexes (enforced only where deletedAt is null) and added a `deletedAt` index
 * to each soft-deletable model. Mongoose does not replace mismatched indexes on
 * its own, so run this once against each environment after deploying:
 *
 *   node scripts/syncIndexes.js        (or: npm run sync-indexes)
 *
 * Model.syncIndexes() drops indexes that no longer match the schema and builds
 * the ones that are missing. Safe to re-run; it's a no-op once in sync. Prefer a
 * low-traffic window on large collections, since building indexes takes a lock.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

// Models whose indexes changed with soft delete.
const models = {
  Novel: require('../src/models/Novel'),
  Chapter: require('../src/models/Chapter'),
  Review: require('../src/models/Review'),
  Comment: require('../src/models/Comment'),
  User: require('../src/models/User'),
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Aborting.');
    process.exit(1);
  }
  await connectDB(process.env.MONGO_URI);
  console.info(`Syncing indexes on: ${Object.keys(models).join(', ')}\n`);

  for (const [name, Model] of Object.entries(models)) {
    try {
      const dropped = await Model.syncIndexes();
      const indexes = Object.keys(await Model.collection.indexInformation());
      console.info(`✓ ${name}`);
      if (dropped.length) console.info(`    dropped stale: ${dropped.join(', ')}`);
      console.info(`    current: ${indexes.join(', ')}`);
    } catch (err) {
      console.error(`✗ ${name}: ${err.message}`);
    }
  }

  await mongoose.disconnect();
  console.info('\nDone.');
  process.exit(0);
};

run().catch(async (err) => {
  console.error('Index sync failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
