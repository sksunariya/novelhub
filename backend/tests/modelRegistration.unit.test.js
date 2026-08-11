const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// A model only required lazily inside a service is not registered at boot, so
// its indexes are never built — silently disabling unique constraints. This
// caught three collections; the guard stops a fourth.
describe('model registration', () => {
  it('registers every model file when the app loads', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    require('../src/app');

    const dir = path.join(__dirname, '../src/models');
    const onDisk = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.js') && file !== 'index.js' && /^[A-Z]/.test(file))
      .map((file) => file.replace('.js', ''));

    const unregistered = onDisk.filter((name) => !mongoose.models[name]);
    expect(unregistered).toEqual([]);
  });
});
