const { MongoMemoryServer } = require('mongodb-memory-server');

// One in-memory MongoDB for the whole run.
//
// Previously every test file started its own, which is why the suite took
// three minutes and why files could interfere with each other under memory
// pressure. Each file still gets its own database (see setup.js), so isolation
// is unchanged — there is just one mongod instead of thirty-nine.
//
// Deliberately a standalone instance, not a replica set: production runs a
// standalone mongod, so an accidental startSession should fail here rather
// than in production.
module.exports = async () => {
  const server = await MongoMemoryServer.create();
  process.env.MONGO_TEST_URI = server.getUri();
  // Kept on globalThis so globalTeardown can stop the same instance.
  globalThis.__MONGO_SERVER__ = server;
};
