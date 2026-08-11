// Registers every model at boot.
//
// Models that are only required lazily inside a service are not registered
// when the app starts, so their indexes are never built by the test harness or
// by a fresh deployment. That silently disables unique constraints — which for
// the rollup collections would let a concurrent upsert create duplicate daily
// rows, and for Author would allow two records with the same name.
//
// Requiring the directory once removes the dependency on load order.

const fs = require('fs');
const path = require('path');

const files = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.js') && file !== 'index.js' && /^[A-Z]/.test(file));

const models = {};
for (const file of files) {
  const model = require(path.join(__dirname, file));
  if (model && model.modelName) models[model.modelName] = model;
}

module.exports = models;
