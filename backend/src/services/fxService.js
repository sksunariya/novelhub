// Exchange rates and the currency calculator.
//
// The calculator is the piece that decides what a reader in a given country
// sees and what PayPal actually charges them. Those are not always the same
// number: PayPal settles in only 25 currencies, so for most of the world the
// local figure is an estimate and the charge happens in USD.

const Currency = require('../models/Currency');
const FxRateSnapshot = require('../models/FxRateSnapshot');
const settingsService = require('./settingsService');
const { roundMoney, formatMoney, decimalsFor } = require('../utils/money');
const { SETTLEMENT_MODES, PAYPAL_CURRENCIES } = require('../config/constants');

const badRequest = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * Pull fresh rates.
 *
 * A provider outage must never block the store, so a failure is recorded and
 * the last known good rates stay in place.
 */
const refreshRates = async () => {
  const snapshot = await settingsService.snapshot();
  const url = snapshot.get('fx.providerUrl');

  let payload;
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`provider responded ${response.status}`);
    payload = await response.json();
  } catch (error) {
    await FxRateSnapshot.create({ provider: url, ok: false, error: error.message, rates: {} });
    return { ok: false, error: error.message, updated: 0 };
  }

  const rates = payload.rates || payload.conversion_rates;
  if (!rates || typeof rates !== 'object') {
    await FxRateSnapshot.create({ provider: url, ok: false, error: 'unrecognised response shape', rates: {} });
    return { ok: false, error: 'unrecognised response shape', updated: 0 };
  }

  await FxRateSnapshot.create({ provider: url, ok: true, rates });

  const currencies = await Currency.find({});
  let updated = 0;
  const now = new Date();
  for (const currency of currencies) {
    const rate = currency.code === 'USD' ? 1 : rates[currency.code];
    if (!Number.isFinite(rate) || rate <= 0) continue;
    currency.autoRate = rate;
    currency.lastRateAt = now;
    currency.lastRateSource = url;
    await currency.save();
    updated += 1;
  }
  return { ok: true, updated, fetchedAt: now };
};

/** Resolve which currency to price in for this request. */
const resolveCurrency = async ({ requested, user, ipCountry }) => {
  const snapshot = await settingsService.snapshot();
  const fallbackCode = snapshot.get('currency.default');

  const candidates = [];
  if (requested && snapshot.get('currency.allowUserOverride')) candidates.push(String(requested).toUpperCase());
  if (user && user.preferredCurrency) candidates.push(String(user.preferredCurrency).toUpperCase());
  if (snapshot.get('currency.autoDetect') && ipCountry) {
    const byCountry = await Currency.findOne({ enabled: true, code: await currencyForCountry(ipCountry) });
    if (byCountry) candidates.push(byCountry.code);
  }
  candidates.push(fallbackCode);

  for (const code of candidates) {
    if (!code) continue;
    const found = await Currency.findOne({ code, enabled: true });
    if (found) return found;
  }
  // Nothing configured: fall back to a synthetic USD so the store still works
  // before an admin has set up the currency table.
  return (
    (await Currency.findOne({ code: 'USD' })) ||
    new Currency({ code: 'USD', name: 'US Dollar', symbol: '$', enabled: true, autoRate: 1, isDefault: true })
  );
};

// Minimal country -> currency map for auto-detection. Only currencies an admin
// has actually enabled are ever used, so an unmapped country just falls back.
const COUNTRY_CURRENCY = {
  US: 'USD', GB: 'GBP', AU: 'AUD', CA: 'CAD', NZ: 'NZD', JP: 'JPY', CN: 'CNY',
  HK: 'HKD', SG: 'SGD', MY: 'MYR', TH: 'THB', PH: 'PHP', TW: 'TWD', IL: 'ILS',
  MX: 'MXN', BR: 'BRL', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RU: 'RUB',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR',
  AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR',
};

const currencyForCountry = async (country) => COUNTRY_CURRENCY[String(country).toUpperCase()] || null;

/**
 * Price a USD amount in a currency, and decide how it will actually settle.
 *
 * Returns both a `display` block (what the buyer sees) and a `settle` block
 * (what PayPal is asked to charge). They diverge whenever PayPal cannot settle
 * in the buyer's currency — which is most of the world, including INR.
 */
const quote = async (usdCents, currency, { snapshot = null } = {}) => {
  const config = snapshot || (await settingsService.snapshot());
  const staleAfterHours = config.get('fx.staleAfterHours');
  const onStale = config.get('fx.onStaleRates');
  const globalMarkup = config.get('currency.globalMarkupPct');

  const isUsd = currency.code === 'USD';
  let stale = false;

  if (!isUsd && currency.isStale(staleAfterHours)) {
    stale = true;
    if (onStale === 'block_purchases') {
      throw badRequest('Currency conversion is temporarily unavailable, please try again shortly', 503);
    }
    if (onStale === 'fallback_usd') {
      return usdQuote(usdCents, { estimateFrom: null, stale: true });
    }
    // use_last_known: fall through with whatever rate we still hold
  }

  const rate = isUsd ? 1 : currency.effectiveRate() * (1 + (globalMarkup || 0) / 100);
  if (!Number.isFinite(rate) || rate <= 0) {
    return usdQuote(usdCents, { estimateFrom: null, stale: true });
  }

  const decimals = decimalsFor(currency.code, currency.decimals);
  const majorAmount = (usdCents / 100) * rate;
  let displayMinor = isUsd ? usdCents : roundMoney(majorAmount, currency.rounding, decimals);
  if (currency.minChargeMinor) displayMinor = Math.max(displayMinor, currency.minChargeMinor);

  const settleLocally = currency.settlementMode === SETTLEMENT_MODES.LOCAL && currency.paypalSupported && !stale;

  return {
    display: {
      code: currency.code,
      minor: displayMinor,
      decimals,
      symbol: currency.symbol,
      formatted: formatMoney(displayMinor, {
        symbol: currency.symbol,
        symbolPosition: currency.symbolPosition,
        decimals,
        code: currency.code,
      }),
    },
    settle: settleLocally
      ? { currency: currency.code, amountMinor: displayMinor, decimals }
      : { currency: 'USD', amountMinor: usdCents, decimals: 2 },
    // The buyer must be told when the figure they see is not the figure charged.
    isEstimate: !settleLocally && !isUsd,
    paypalSupported: currency.paypalSupported,
    rateUsed: rate,
    rateAt: currency.lastRateAt || null,
    stale,
  };
};

const usdQuote = (usdCents, { stale = false } = {}) => ({
  display: {
    code: 'USD',
    minor: usdCents,
    decimals: 2,
    symbol: '$',
    formatted: formatMoney(usdCents, { symbol: '$', decimals: 2, code: 'USD' }),
  },
  settle: { currency: 'USD', amountMinor: usdCents, decimals: 2 },
  isEstimate: false,
  paypalSupported: true,
  rateUsed: 1,
  rateAt: null,
  stale,
});

/** Currencies an admin has switched on, for the store's picker. */
const listEnabled = async () => {
  const rows = await Currency.find({ enabled: true }).sort({ isDefault: -1, code: 1 });
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    decimals: decimalsFor(row.code, row.decimals),
    paypalSupported: row.paypalSupported,
    settlesLocally: row.settlementMode === SETTLEMENT_MODES.LOCAL && row.paypalSupported,
  }));
};

/** Seed the table so an admin has something to switch on. */
const seedDefaults = async () => {
  const defaults = [
    ['USD', 'US Dollar', '$'], ['EUR', 'Euro', '€'], ['GBP', 'Pound Sterling', '£'],
    ['INR', 'Indian Rupee', '₹'], ['JPY', 'Japanese Yen', '¥'], ['CAD', 'Canadian Dollar', 'CA$'],
    ['AUD', 'Australian Dollar', 'A$'], ['BRL', 'Brazilian Real', 'R$'], ['PHP', 'Philippine Peso', '₱'],
    ['IDR', 'Indonesian Rupiah', 'Rp'], ['SGD', 'Singapore Dollar', 'S$'], ['MYR', 'Malaysian Ringgit', 'RM'],
  ];
  let created = 0;
  for (const [code, name, symbol] of defaults) {
    const exists = await Currency.findOne({ code });
    if (exists) continue;
    await Currency.create({
      code,
      name,
      symbol,
      enabled: code === 'USD',
      isDefault: code === 'USD',
      autoRate: code === 'USD' ? 1 : 0,
      settlementMode: PAYPAL_CURRENCIES.includes(code) ? SETTLEMENT_MODES.LOCAL : SETTLEMENT_MODES.USD,
    });
    created += 1;
  }
  return { created };
};

module.exports = { refreshRates, resolveCurrency, quote, listEnabled, seedDefaults, currencyForCountry };
