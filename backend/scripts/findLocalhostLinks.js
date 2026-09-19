#!/usr/bin/env node
/**
 * Find stored links that point at localhost.
 *
 *   npm run check:localhost-links
 *
 * Read-only: it prints what it finds and writes nothing (index builds and
 * collection creation are switched off too).
 *
 * The code no longer invents localhost URLs (src/utils/publicUrl.js), but data
 * can still hold them: a carousel button, spotlight link, campaign link, logo
 * URL or chapter text saved while an admin used a local copy of the site that
 * was pointed at this database. Those reach readers exactly as stored, so they
 * have to be found and edited (most in the admin portal).
 *
 * Every String field of every model is checked, except in the high-volume
 * event, ledger and log collections, which hold nothing a reader can click.
 * Chapter text is scanned too, so on a large library this can take a minute.
 */
require('dotenv').config();
const mongoose = require('mongoose');

// Before any model is compiled: a diagnostic must not build indexes or create
// collections on the database it is inspecting.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const connectDB = require('../src/config/db');
const models = require('../src/models');

// A scheme-less "//" host, so both http:// and https:// (and //host) match.
const PATTERN = /\/\/(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)\b|\/\/\[::1\]/i;
const SHOW_PER_MODEL = 20;

const SKIP = new Set([
  'AdminAuditLog',
  'ChapterRead',
  'ChapterStatsDaily',
  'Counter',
  'CreditTransaction',
  'FxRateSnapshot',
  'GateImpression',
  'JobLock',
  'JobRun',
  'NovelRevenueDaily',
  'PasswordResetCode',
  'PendingSignup',
  'PollVote',
  'RevenueDaily',
  'RevenueEvent',
  'ViewEvent',
  'Vote',
  'WebhookEvent',
]);

/** Every path in `schema` that can hold a string, including inside sub-documents. */
const stringPaths = (schema, prefix = '') => {
  const paths = [];
  schema.eachPath((name, type) => {
    const path = `${prefix}${name}`;
    if (type.instance === 'String' || type.instance === 'Mixed') {
      paths.push(path);
    } else if (type.schema) {
      paths.push(...stringPaths(type.schema, `${path}.`));
    } else if (type.instance === 'Array') {
      const inner = type.embeddedSchemaType || type.caster;
      if (inner && (inner.instance === 'String' || inner.instance === 'Mixed')) paths.push(path);
    }
  });
  return paths;
};

/** All values at a dotted path, flattening arrays on the way down. */
const valuesAt = (value, parts) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, parts));
  if (!parts.length) return [value];
  return typeof value === 'object' ? valuesAt(value[parts[0]], parts.slice(1)) : [];
};

/** A short excerpt around the match, so a hit inside chapter HTML stays readable. */
const excerpt = (text) => {
  const at = text.search(PATTERN);
  const start = Math.max(0, at - 30);
  const snippet = text.slice(start, at + 70).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${snippet}${at + 70 < text.length ? '…' : ''}`;
};

const run = async () => {
  await connectDB(process.env.MONGO_URI);

  let total = 0;
  for (const model of Object.values(models).sort((a, b) => a.modelName.localeCompare(b.modelName))) {
    if (SKIP.has(model.modelName)) continue;
    // Never pull password hashes into memory, even though no hash can match.
    const paths = stringPaths(model.schema).filter((path) => !/(^|\.)password$/i.test(path));
    if (!paths.length) continue;

    const cursor = model
      .find({ $or: paths.map((path) => ({ [path]: PATTERN })) })
      .select(paths.join(' '))
      .lean()
      .cursor();

    let count = 0;
    for await (const doc of cursor) {
      count += 1;
      if (count > SHOW_PER_MODEL) continue;
      if (count === 1) console.log(`\n${model.modelName} (collection "${model.collection.name}")`);
      paths.forEach((path) => {
        valuesAt(doc, path.split('.'))
          .filter((value) => typeof value === 'string' && PATTERN.test(value))
          .forEach((value) => console.log(`  ${doc._id}  ${path}: ${excerpt(value)}`));
      });
    }
    if (count > SHOW_PER_MODEL) console.log(`  … and ${count - SHOW_PER_MODEL} more`);
    total += count;
  }

  console.log(
    total
      ? `\n${total} document(s) hold a localhost link. Replace each with a site path such as /novel/slug, or with the full public URL.`
      : 'No stored localhost links.'
  );
  await mongoose.connection.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
