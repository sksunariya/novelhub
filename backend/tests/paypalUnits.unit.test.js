// Parsing of PayPal's capture response. Pure, and it feeds the amount check
// that decides whether an order is credited — a misparse here would either
// reject good payments or accept mismatched ones.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { readCapture } = require('../src/services/orderService');

const response = (over = {}) => ({
  id: 'PPORDER-1',
  status: 'COMPLETED',
  payer: { payer_id: 'PAYER1', email_address: 'buyer@test.com' },
  purchase_units: [
    {
      payments: {
        captures: [
          {
            id: 'CAP-1',
            status: 'COMPLETED',
            amount: { value: '9.99', currency_code: 'USD' },
            seller_receivable_breakdown: {
              gross_amount: { value: '9.99', currency_code: 'USD' },
              paypal_fee: { value: '0.64', currency_code: 'USD' },
              net_amount: { value: '9.35', currency_code: 'USD' },
            },
          },
        ],
      },
    },
  ],
  ...over,
});

describe('readCapture', () => {
  it('extracts the capture, amount and payer', () => {
    expect(readCapture(response())).toMatchObject({
      id: 'CAP-1',
      status: 'COMPLETED',
      currency: 'USD',
      amountMinorRaw: 9.99,
      payerId: 'PAYER1',
      payerEmail: 'buyer@test.com',
    });
  });

  it('converts the fee and net to integer cents', () => {
    const capture = readCapture(response());
    expect(capture.feeUsdCents).toBe(64);
    expect(capture.netUsdCents).toBe(935);
  });

  it('reads a zero-decimal amount without inventing decimals', () => {
    const jpy = response();
    jpy.purchase_units[0].payments.captures[0].amount = { value: '1549', currency_code: 'JPY' };
    const capture = readCapture(jpy);
    expect(capture.amountMinorRaw).toBe(1549);
    expect(capture.currency).toBe('JPY');
  });

  it('rounds fees rather than leaving float artifacts', () => {
    const r = response();
    r.purchase_units[0].payments.captures[0].seller_receivable_breakdown.paypal_fee = {
      value: '0.575', currency_code: 'USD',
    };
    expect(Number.isInteger(readCapture(r).feeUsdCents)).toBe(true);
  });

  it('surfaces a non-completed status instead of silently succeeding', () => {
    const declined = response();
    declined.purchase_units[0].payments.captures[0].status = 'DECLINED';
    expect(readCapture(declined).status).toBe('DECLINED');
  });

  describe('malformed responses', () => {
    it('survives a missing breakdown', () => {
      const r = response();
      delete r.purchase_units[0].payments.captures[0].seller_receivable_breakdown;
      const capture = readCapture(r);
      expect(capture.feeUsdCents).toBe(0);
      expect(capture.netUsdCents).toBe(0);
      expect(capture.id).toBe('CAP-1');
    });

    it('survives a missing payer', () => {
      const r = response();
      delete r.payer;
      expect(readCapture(r)).toMatchObject({ payerId: '', payerEmail: '' });
    });

    it('survives no captures at all', () => {
      const r = response();
      r.purchase_units[0].payments.captures = [];
      const capture = readCapture(r);
      expect(capture.id).toBeUndefined();
      // An undefined status can never equal COMPLETED, so the order is not credited.
      expect(capture.status).not.toBe('COMPLETED');
    });

    it('survives no purchase units', () => {
      expect(() => readCapture({ id: 'x' })).not.toThrow();
      expect(readCapture({ id: 'x' }).status).toBeUndefined();
    });

    it('survives an empty object', () => {
      expect(() => readCapture({})).not.toThrow();
      expect(readCapture({}).amountMinorRaw).toBe(0);
    });
  });
});

describe('capture amount verification arithmetic', () => {
  // Mirrors the comparison in captureOrder: the locked minor amount is
  // converted to major units and compared with a half-cent tolerance.
  const matches = (lockedMinor, decimals, captured) =>
    Math.abs(captured - lockedMinor / 10 ** decimals) < 0.005;

  it('accepts an exact match', () => {
    expect(matches(999, 2, 9.99)).toBe(true);
    expect(matches(1549, 0, 1549)).toBe(true);
  });

  it('rejects a tampered amount', () => {
    expect(matches(999, 2, 0.01)).toBe(false);
    expect(matches(999, 2, 9.98)).toBe(false);
  });

  it('tolerates float representation noise but not a real cent', () => {
    expect(matches(1010, 2, 10.1)).toBe(true);
    expect(matches(1010, 2, 10.11)).toBe(false);
  });
});
