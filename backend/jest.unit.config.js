// Fast feedback loop: pure-logic suites only, no database.
//
// A suite qualifies by being named *.unit.test.js, so the split stays
// self-maintaining — a new pure suite is included by its filename rather than
// by remembering to add it to a list here.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.unit.test.js'],
  // No globalSetup and no setupFilesAfterEach: these never touch Mongo.
};
