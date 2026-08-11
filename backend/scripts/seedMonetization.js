#!/usr/bin/env node
/**
 * Seed a working monetization setup for local development.
 *
 * Exists so the reader UI can be built and exercised before the admin portal
 * does — otherwise the store has nothing to sell and the two stages would be
 * forced into the wrong order.
 *
 *   node scripts/seedMonetization.js
 *   node scripts/seedMonetization.js --enable   # also switch monetization on
 *
 * Idempotent: re-running updates rather than duplicating.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const ENABLE = process.argv.includes('--enable');
const log = (...args) => console.info(...args);

const PACKS = [
  { name: 'Taster', slug: 'taster', credits: 300, bonusCredits: 0, priceUsdCents: 299, sortOrder: 0 },
  { name: 'Reader', slug: 'reader', credits: 1000, bonusCredits: 100, priceUsdCents: 899, sortOrder: 1, badge: 'POPULAR' },
  { name: 'Devotee', slug: 'devotee', credits: 2500, bonusCredits: 500, priceUsdCents: 1999, sortOrder: 2, badge: 'BEST VALUE' },
  { name: 'Patron', slug: 'patron', credits: 6000, bonusCredits: 1800, priceUsdCents: 4499, sortOrder: 3 },
];

// A deliberate mix: PayPal-settleable currencies and two that are not, so the
// estimate-pricing path is exercised during development rather than discovered
// in production by a reader in India.
const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', enabled: true, isDefault: true, manualRate: 1 },
  { code: 'EUR', name: 'Euro', symbol: '€', enabled: true, manualRate: 0.92, settlementMode: 'local' },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', enabled: true, manualRate: 0.79, settlementMode: 'local' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', enabled: true, manualRate: 152, settlementMode: 'local' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', enabled: true, manualRate: 83.2, rounding: 'nearest_10' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', enabled: true, manualRate: 15800, rounding: 'nearest_100' },
];

const run = async () => {
  await connectDB(process.env.MONGO_URI);

  const CreditPack = require('../src/models/CreditPack');
  const Currency = require('../src/models/Currency');
  const PricingRule = require('../src/models/PricingRule');
  const settingsService = require('../src/services/settingsService');

  log('\nSeeding monetization...\n');

  for (const pack of PACKS) {
    const existing = await CreditPack.findOne({ slug: pack.slug });
    if (existing) {
      Object.assign(existing, pack);
      await existing.save();
      log(`  pack     updated  ${pack.name}`);
    } else {
      await CreditPack.create(pack);
      log(`  pack     created  ${pack.name} — ${pack.credits + pack.bonusCredits} credits for $${(pack.priceUsdCents / 100).toFixed(2)}`);
    }
  }

  for (const currency of CURRENCIES) {
    const existing = await Currency.findOne({ code: currency.code });
    const target = existing || new Currency({ code: currency.code });
    // Manual rates so a dev machine needs no FX provider call.
    Object.assign(target, currency, { rateSource: 'manual', lastRateAt: new Date() });
    await target.save();
    const note = target.paypalSupported ? target.settlementMode : 'usd (PayPal cannot settle)';
    log(`  currency ${existing ? 'updated' : 'created'}  ${target.code.padEnd(4)} → ${note}`);
  }

  const ruleName = 'Back catalogue at half price';
  if (!(await PricingRule.findOne({ name: ruleName }))) {
    await PricingRule.create({
      name: ruleName,
      active: true,
      priority: 10,
      scope: 'global',
      conditions: { chapterAgeDaysFrom: 90 },
      action: { mode: 'multiply', multiplier: 0.5 },
    });
    log(`  rule     created  ${ruleName}`);
  }

  await settingsService.update({
    'pricing.defaultChapterCredits': 10,
    'pricing.defaultFreeChapterCount': 5,
    'store.enabled': true,
    ...(ENABLE ? { 'monetization.enabled': true } : {}),
  });
  settingsService.clearCache();

  log('\n  chapter price      10 credits');
  log('  free chapters      first 5');
  log(`  monetization       ${ENABLE ? 'ENABLED' : 'still off — re-run with --enable, or use the admin portal'}`);
  log('\nDone.\n');

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error('\nSeed failed:', error.message);
  process.exit(1);
});
