// Money helpers. Everything is integer minor units — never a float.
//
// The rounding modes exist because a converted price like "8.7431 EUR" is not
// something you show a buyer. Charm rounding lands on .99/.95; the nearest_N
// modes suit currencies where the smallest sensible increment is 10 or 100.

const { ROUNDING_MODES, ZERO_DECIMAL_CURRENCIES } = require('../config/constants');

const pow10 = (n) => 10 ** n;

/**
 * Convert a major-unit amount to rounded minor units.
 *
 * @param {number} majorAmount e.g. 8.7431
 * @param {string} mode        one of ROUNDING_MODES
 * @param {number} decimals    currency exponent (0 for JPY)
 * @returns {number} integer minor units
 */
const roundMoney = (majorAmount, mode, decimals = 2) => {
  const factor = pow10(decimals);

  // Charm pricing needs minor units to land on. With none, fall back to whole.
  const charmable = decimals > 0;

  switch (mode) {
    case ROUNDING_MODES.NONE:
      return Math.round(majorAmount * factor);

    case ROUNDING_MODES.NEAREST_INT:
      return Math.round(majorAmount) * factor;

    case ROUNDING_MODES.CEIL_INT:
      return Math.ceil(majorAmount) * factor;

    case ROUNDING_MODES.CHARM_99:
    case ROUNDING_MODES.CHARM_95: {
      if (!charmable) return Math.round(majorAmount) * factor;
      const ending = mode === ROUNDING_MODES.CHARM_99 ? 0.99 : 0.95;
      // Pick the NEAREST x.99, not the next one up. Always rounding up would
      // turn a 9.19 conversion into 9.99 — an 8.7% silent markup on top of the
      // FX spread the admin already configured.
      const whole = Math.floor(majorAmount);
      const upper = whole + ending;
      const lower = whole - 1 + ending;
      const chosen = Math.abs(majorAmount - lower) < Math.abs(upper - majorAmount) ? lower : upper;
      // Never round a real price down to zero or below the charm floor.
      return Math.max(Math.round(chosen * factor), Math.round(ending * factor));
    }

    case ROUNDING_MODES.NEAREST_10:
      return Math.max(10, Math.round(majorAmount / 10) * 10) * factor;

    case ROUNDING_MODES.NEAREST_50:
      return Math.max(50, Math.round(majorAmount / 50) * 50) * factor;

    case ROUNDING_MODES.NEAREST_100:
      return Math.max(100, Math.round(majorAmount / 100) * 100) * factor;

    default:
      return Math.round(majorAmount * factor);
  }
};

const minorToMajor = (minor, decimals = 2) => minor / pow10(decimals);

/** PayPal wants a string, and rejects decimals on zero-decimal currencies. */
const formatForPaypal = (minor, currency) => {
  const decimals = ZERO_DECIMAL_CURRENCIES.includes(currency) ? 0 : 2;
  return (minor / pow10(decimals)).toFixed(decimals);
};

const decimalsFor = (currency, fallback = 2) =>
  ZERO_DECIMAL_CURRENCIES.includes(currency) ? 0 : fallback;

/** Human-readable price for display, e.g. "€9.99" or "¥1549". */
const formatMoney = (minor, { symbol = '', symbolPosition = 'before', decimals = 2, code = '' } = {}) => {
  const major = minorToMajor(minor, decimals).toFixed(decimals);
  const withSeparators = major.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = symbol || `${code} `;
  return symbolPosition === 'after' ? `${withSeparators}${sign}` : `${sign}${withSeparators}`;
};

module.exports = { roundMoney, minorToMajor, formatForPaypal, formatMoney, decimalsFor };
