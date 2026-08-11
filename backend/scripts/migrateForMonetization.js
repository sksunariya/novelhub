#!/usr/bin/env node
/**
 * One-time migration for an existing NovelHub install.
 *
 * Idempotent and resumable — safe to run repeatedly. Defaults to a dry run;
 * pass --apply to write.
 *
 *   node scripts/migrateForMonetization.js            # report only
 *   node scripts/migrateForMonetization.js --apply    # write
 *
 * IMPORTANT: run the originalNumber backfill BEFORE anyone renumbers a
 * chapter. The renumber guard uses originalNumber to decide what counts as a
 * free chapter, and backfilling after a reorder would freeze the wrong value.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const APPLY = process.argv.includes('--apply');
const BATCH = 500;

const log = (...args) => console.info(...args);

/** Chapters published before publishedAt existed have no date to age from. */
const backfillPublishedAt = async (Chapter) => {
  const filter = { published: true, publishedAt: null };
  const count = await Chapter.countDocuments(filter);
  if (!APPLY || !count) return { name: 'publishedAt', count };

  // createdAt is the best available proxy for chapters that predate the field.
  const result = await Chapter.collection.updateMany(filter, [
    { $set: { publishedAt: '$createdAt' } },
  ]);
  return { name: 'publishedAt', count, updated: result.modifiedCount };
};

/** originalNumber freezes what "chapter N" meant when it was written. */
const backfillOriginalNumber = async (Chapter) => {
  const filter = { originalNumber: { $in: [null, undefined] } };
  const count = await Chapter.countDocuments(filter);
  if (!APPLY || !count) return { name: 'originalNumber', count };

  const result = await Chapter.collection.updateMany(filter, [{ $set: { originalNumber: '$number' } }]);
  return { name: 'originalNumber', count, updated: result.modifiedCount };
};

/** wordCount enables word-count pricing rules without re-parsing on every read. */
const backfillWordCount = async (Chapter) => {
  const filter = { $or: [{ wordCount: 0 }, { wordCount: { $exists: false } }] };
  const count = await Chapter.countDocuments(filter);
  if (!APPLY || !count) return { name: 'wordCount', count };

  // Needs real HTML stripping, so it runs in batches rather than in the server.
  let processed = 0;
  let lastId = null;
  for (;;) {
    const query = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
    const batch = await Chapter.find(query).select('_id content').sort({ _id: 1 }).limit(BATCH);
    if (!batch.length) break;

    const ops = batch.map((chapter) => ({
      updateOne: {
        filter: { _id: chapter._id },
        update: { $set: { wordCount: Chapter.countWords(chapter.content) } },
      },
    }));
    await Chapter.bulkWrite(ops, { ordered: false });

    processed += batch.length;
    lastId = batch[batch.length - 1]._id;
    log(`    wordCount: ${processed}/${count}`);
  }
  return { name: 'wordCount', count, updated: processed };
};

/**
 * Every user gets a wallet.
 *
 * creditService provisions lazily, so reads already work — but a complete table
 * makes the admin wallet list, balance filters and audience targeting honest
 * rather than silently missing anyone who has not transacted yet.
 */
const provisionWallets = async (User, Wallet) => {
  const withWallets = await Wallet.distinct('user');
  const filter = { _id: { $nin: withWallets }, deletedAt: null };
  const count = await User.countDocuments(filter);
  if (!APPLY || !count) return { name: 'wallets', count };

  let created = 0;
  let lastId = null;
  for (;;) {
    const query = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
    const batch = await User.find(query).select('_id').sort({ _id: 1 }).limit(BATCH);
    if (!batch.length) break;

    await Wallet.insertMany(
      batch.map((user) => ({ user: user._id })),
      { ordered: false }
    ).catch((error) => {
      // Duplicates just mean a wallet appeared between the scan and the write.
      if (error.code !== 11000 && !error.writeErrors) throw error;
    });

    created += batch.length;
    lastId = batch[batch.length - 1]._id;
    log(`    wallets: ${created}/${count}`);
  }
  return { name: 'wallets', count, updated: created };
};

/** lastActiveAt drives the win-back audience filters. */
const seedLastActive = async (User, ReadingProgress) => {
  const filter = { lastActiveAt: null, deletedAt: null };
  const count = await User.countDocuments(filter);
  if (!APPLY || !count) return { name: 'lastActiveAt', count };

  const latest = await ReadingProgress.aggregate([
    { $group: { _id: '$user', at: { $max: '$updatedAt' } } },
  ]);
  if (!latest.length) return { name: 'lastActiveAt', count, updated: 0 };

  const ops = latest.map((row) => ({
    updateOne: { filter: { _id: row._id, lastActiveAt: null }, update: { $set: { lastActiveAt: row.at } } },
  }));
  const result = await User.bulkWrite(ops, { ordered: false });
  return { name: 'lastActiveAt', count, updated: result.modifiedCount };
};

const run = async () => {
  await connectDB(process.env.MONGO_URI);

  const Chapter = require('../src/models/Chapter');
  const User = require('../src/models/User');
  const Wallet = require('../src/models/Wallet');
  const ReadingProgress = require('../src/models/ReadingProgress');

  log(APPLY ? '\nApplying migration...\n' : '\nDry run — pass --apply to write.\n');

  const results = [];
  results.push(await backfillPublishedAt(Chapter));
  results.push(await backfillOriginalNumber(Chapter));
  results.push(await backfillWordCount(Chapter));
  results.push(await provisionWallets(User, Wallet));
  results.push(await seedLastActive(User, ReadingProgress));

  log('\n  field            needing backfill   written');
  log('  ---------------------------------------------');
  for (const r of results) {
    log(`  ${r.name.padEnd(16)} ${String(r.count).padStart(16)}   ${String(r.updated ?? '-').padStart(7)}`);
  }

  const total = results.reduce((sum, r) => sum + r.count, 0);
  log(
    APPLY
      ? '\nDone. Re-run to confirm every count is now zero.\n'
      : `\n${total} document(s) would be updated. Re-run with --apply.\n`
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error('\nMigration failed:', error.message);
  process.exit(1);
});
