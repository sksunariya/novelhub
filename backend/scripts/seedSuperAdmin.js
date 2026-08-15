#!/usr/bin/env node
/**
 * Create or promote the superadmin account.
 *
 *   npm run seed:superadmin
 *
 * Reads SUPERADMIN_EMAIL, SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD from the
 * environment. If an account with that email exists it is promoted; otherwise
 * one is created.
 *
 * Deliberately not an HTTP endpoint. The first owner account is the root of the
 * whole permission system, and anything reachable over the network is one
 * misconfiguration away from being reachable by everyone. Whoever can run this
 * already has the database credentials, so it grants nothing they did not have.
 *
 * Idempotent: safe to re-run. An existing superadmin is left alone unless
 * --reset-password is passed.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const AdminAuditLog = require('../src/models/AdminAuditLog');
const { ROLES } = require('../src/config/constants');

const RESET_PASSWORD = process.argv.includes('--reset-password');
const log = (...args) => console.info(...args);

const run = async () => {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const username = (process.env.SUPERADMIN_USERNAME || 'superadmin').trim();
  const password = process.env.SUPERADMIN_PASSWORD || '';

  if (!email) {
    throw new Error('SUPERADMIN_EMAIL is not set. Add it to backend/.env and re-run.');
  }

  await connectDB(process.env.MONGO_URI);
  log(`\n  target             ${email}`);

  // withDeleted: a soft-deleted account still holds the email, and creating a
  // second one would leave two records fighting over the same login.
  const existing = await User.findOne({ email }).setOptions({ withDeleted: true });

  if (existing) {
    const previousRole = existing.role;

    if (existing.deletedAt) {
      existing.deletedAt = null;
      log('  restored           account was soft-deleted');
    }
    existing.role = ROLES.SUPERADMIN;
    existing.banned = false;
    // Module overrides describe an admin's portal. A superadmin sees all of it,
    // so leaving them behind would only mislead whoever reads the record next.
    existing.adminModules = undefined;

    if (RESET_PASSWORD) {
      if (!password) throw new Error('--reset-password needs SUPERADMIN_PASSWORD to be set.');
      existing.password = password; // hashed by the pre-save hook
      log('  password           reset');
    }

    await existing.save();

    if (previousRole !== ROLES.SUPERADMIN) {
      await AdminAuditLog.create({
        actor: existing._id,
        actorLabel: 'seed:superadmin',
        action: 'admin_access.role.change',
        entity: 'admin_access',
        entityId: String(existing._id),
        changes: [{ key: 'role', before: previousRole, after: ROLES.SUPERADMIN }],
        note: 'Promoted by scripts/seedSuperAdmin.js',
      });
    }

    log(`  result             promoted (${previousRole} → superadmin)`);
  } else {
    if (!password) {
      throw new Error('SUPERADMIN_PASSWORD is not set, and it is required to create a new account.');
    }
    const created = await User.create({
      username,
      email,
      password,
      role: ROLES.SUPERADMIN,
    });

    await AdminAuditLog.create({
      actor: created._id,
      actorLabel: 'seed:superadmin',
      action: 'admin_access.role.change',
      entity: 'admin_access',
      entityId: String(created._id),
      changes: [{ key: 'role', before: null, after: ROLES.SUPERADMIN }],
      note: 'Created by scripts/seedSuperAdmin.js',
    });

    log(`  result             created (${username})`);
  }

  const total = await User.countDocuments({ role: ROLES.SUPERADMIN });
  log(`  superadmins        ${total}`);
  if (total > 1) {
    log('\n  Note: more than one superadmin exists. Every one of them can see and');
    log('  change everything, including each other. Keep the number small.');
  }
  log('\nDone.\n');

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('\nSeed failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
