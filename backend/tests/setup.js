const path = require('path');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
// Production runs a standalone mongod, so no test may rely on transactions.
process.env.TRANSACTIONS_ENABLED = 'false';

beforeAll(async () => {
  // One server for the whole run (tests/globalSetup.js), one database per test
  // file — isolation without thirty-nine mongod processes.
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) throw new Error('MONGO_TEST_URI missing — is globalSetup configured?');

  const dbName = `t_${path.basename(expect.getState().testPath).replace(/[^\w]/g, '_')}`;
  await mongoose.connect(uri, { dbName });

  // Build every index before the first test.
  //
  // Mongoose creates indexes in the background after connecting, so without
  // this a fast suite races the index build and unique constraints silently do
  // not apply — a duplicate signup succeeds, three concurrent getOrCreate calls
  // each insert a wallet. Those failures look like application bugs and are not.
  require('../src/app');
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  // deleteMany rather than drop, so the indexes built above survive between tests.
  await Promise.all(collections.map((collection) => collection.deleteMany({})));

  // In-process caches outlive the database wipe and would otherwise leak state
  // across tests: stale settings, and rate-limit counters that make a later
  // test 429 for requests an earlier one made.
  require('../src/services/settingsService').clearCache();
  require('../src/middlewares/rateLimit')._buckets.clear();
  require('../src/services/paypalService').resetTokenCache();
});

afterAll(async () => {
  // Drop this file's database so the shared server does not accumulate them.
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});
