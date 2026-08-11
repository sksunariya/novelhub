const { roundMoney, formatForPaypal, formatMoney, decimalsFor } = require('../src/utils/money');
const { ROUNDING_MODES, PAYPAL_CURRENCIES, ZERO_DECIMAL_CURRENCIES } = require('../src/config/constants');

describe('rounding', () => {
  it('charm_99 picks the nearest .99, not the next one up', () => {
    // Always rounding up would turn 9.19 into 9.99 — an 8.7% silent markup.
    expect(roundMoney(9.19, ROUNDING_MODES.CHARM_99, 2)).toBe(899);
    expect(roundMoney(8.7431, ROUNDING_MODES.CHARM_99, 2)).toBe(899);
    expect(roundMoney(9.95, ROUNDING_MODES.CHARM_99, 2)).toBe(999);
    expect(roundMoney(12.02, ROUNDING_MODES.CHARM_99, 2)).toBe(1199);
  });

  it('never rounds a real price below the charm floor', () => {
    expect(roundMoney(0.4, ROUNDING_MODES.CHARM_99, 2)).toBe(99);
    expect(roundMoney(0.05, ROUNDING_MODES.CHARM_95, 2)).toBe(95);
  });

  it('falls back to whole units when the currency has no decimals', () => {
    expect(roundMoney(1548.6, ROUNDING_MODES.CHARM_99, 0)).toBe(1549);
  });

  it('supports the nearest-N modes', () => {
    expect(roundMoney(856.2, ROUNDING_MODES.NEAREST_10, 0)).toBe(860);
    expect(roundMoney(862, ROUNDING_MODES.NEAREST_50, 0)).toBe(850);
    expect(roundMoney(1240, ROUNDING_MODES.NEAREST_100, 0)).toBe(1200);
  });

  it('rounds plainly when asked to', () => {
    expect(roundMoney(8.7431, ROUNDING_MODES.NONE, 2)).toBe(874);
    expect(roundMoney(8.2, ROUNDING_MODES.CEIL_INT, 2)).toBe(900);
    expect(roundMoney(8.2, ROUNDING_MODES.NEAREST_INT, 2)).toBe(800);
  });
});

describe('PayPal amount formatting', () => {
  it('sends no decimals for zero-decimal currencies', () => {
    // PayPal errors on a decimal JPY amount.
    expect(formatForPaypal(1549, 'JPY')).toBe('1549');
    expect(formatForPaypal(2500, 'HUF')).toBe('2500');
    expect(formatForPaypal(800, 'TWD')).toBe('800');
  });

  it('sends two decimals otherwise', () => {
    expect(formatForPaypal(999, 'USD')).toBe('9.99');
    expect(formatForPaypal(999, 'EUR')).toBe('9.99');
    expect(formatForPaypal(100000, 'GBP')).toBe('1000.00');
  });

  it('knows which currencies take decimals', () => {
    expect(decimalsFor('JPY')).toBe(0);
    expect(decimalsFor('USD')).toBe(2);
  });
});

describe('display formatting', () => {
  it('places the symbol and adds thousands separators', () => {
    expect(formatMoney(86000, { symbol: '₹', decimals: 2 })).toBe('₹860.00');
    expect(formatMoney(1234567, { symbol: '$', decimals: 2 })).toBe('$12,345.67');
    expect(formatMoney(1549, { symbol: 'kr', symbolPosition: 'after', decimals: 0 })).toBe('1,549kr');
  });
});

describe('PayPal currency support', () => {
  it('matches the documented list of 25', () => {
    expect(PAYPAL_CURRENCIES).toHaveLength(25);
    expect(PAYPAL_CURRENCIES).toContain('USD');
    expect(PAYPAL_CURRENCIES).toContain('JPY');
  });

  it('excludes the currencies PayPal cannot settle', () => {
    // The constraint that forces estimate pricing for much of the world.
    ['INR', 'AED', 'ZAR', 'KRW', 'IDR', 'VND', 'NGN'].forEach((code) => {
      expect(PAYPAL_CURRENCIES).not.toContain(code);
    });
  });

  it('flags the three zero-decimal currencies', () => {
    expect(ZERO_DECIMAL_CURRENCIES.sort()).toEqual(['HUF', 'JPY', 'TWD']);
    ZERO_DECIMAL_CURRENCIES.forEach((code) => expect(PAYPAL_CURRENCIES).toContain(code));
  });
});
