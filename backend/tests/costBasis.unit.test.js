// The property the whole revenue model rests on: what a chapter earns is the
// money that actually arrived, whatever the credit price was on the day.
//
// These are pure arithmetic against CreditBucket.costFor and the face-value
// helper, so they run without a database and guard the one thing that must
// never regress — a pack re-price silently restating what past chapters earned.

const CreditBucket = require('../src/models/CreditBucket');
const { faceValueMicros } = require('../src/services/revenueService');
const { MICROS_PER_CENT } = require('../src/config/constants');

/** A tranche as `credit()` would create it: cash spread over every credit. */
const tranche = (credits, usdCents) => ({
  remaining: credits,
  remainingCostMicros: usdCents * MICROS_PER_CENT,
});

/** Spend `credits` from a tranche and return both the cash and what is left. */
const spend = (bucket, credits) => {
  const cost = CreditBucket.costFor(bucket, credits);
  return {
    cost,
    rest: { remaining: bucket.remaining - credits, remainingCostMicros: bucket.remainingCostMicros - cost },
  };
};

describe('cost basis under a fluctuating credit price', () => {
  // The exact scenario: the pack price moved twice, and three readers each
  // bought at a different rate before unlocking the same 10-credit chapter.
  const RATES = [
    { label: '$5 = 100 credits', credits: 100, cents: 500 },
    { label: '$5 = 80 credits', credits: 80, cents: 500 },
    { label: '$5 = 107 credits', credits: 107, cents: 500 },
  ];

  it('charges each reader against the price THEY paid', () => {
    const costs = RATES.map((rate) => spend(tranche(rate.credits, rate.cents), 10).cost);

    expect(costs[0]).toBe(500000); // 50.0c — cheapest credits, so the least cash
    expect(costs[1]).toBe(625000); // 62.5c — bought when credits were dearest
    expect(costs[2]).toBe(467289); // 46.7c — bought on the best-value pack

    // The chapter earned the sum of three different real prices, not one
    // notional rate applied three times.
    expect(costs.reduce((sum, value) => sum + value, 0)).toBe(1592289);
  });

  it('never attributes more cash than the reader handed over', () => {
    for (const rate of RATES) {
      let bucket = tranche(rate.credits, rate.cents);
      let recognized = 0;
      // Drain the tranche ten credits at a time; repeated integer division is
      // where an accounting model usually springs a leak.
      while (bucket.remaining >= 10) {
        const result = spend(bucket, 10);
        recognized += result.cost;
        bucket = result.rest;
      }
      if (bucket.remaining > 0) recognized += spend(bucket, bucket.remaining).cost;

      // Every micro accounted for: nothing orphaned, nothing invented.
      expect(recognized).toBe(rate.cents * MICROS_PER_CENT);
    }
  });

  it('dilutes bonus credits instead of inventing revenue', () => {
    // "1000 + 200 bonus" for $9.99. Face value would call this 1200c of stock.
    const bucket = tranche(1200, 999);
    expect(spend(bucket, 1200).cost).toBe(999 * MICROS_PER_CENT);
    // One credit is worth 8325 micros, not the 10000 face value implies.
    expect(CreditBucket.costFor(bucket, 1)).toBe(8325);
  });

  it('earns nothing from granted credits', () => {
    const granted = tranche(500, 0);
    expect(spend(granted, 10).cost).toBe(0);
  });

  it('sweeps the last withdrawal exactly', () => {
    // 7 credits for 100 micros: no split divides evenly, so the final draw must
    // take the remainder or micros are stranded in a drained tranche forever.
    const bucket = { remaining: 7, remainingCostMicros: 100 };
    const first = spend(bucket, 3);
    const second = spend(first.rest, 4);
    expect(first.cost + second.cost).toBe(100);
    expect(second.rest.remainingCostMicros).toBe(0);
  });
});

describe('face value is a snapshot, not a live conversion', () => {
  it('values the same spend differently at different rates', () => {
    expect(faceValueMicros(10, 100)).toBe(100000); // $0.10 at 100 credits/USD
    expect(faceValueMicros(10, 80)).toBe(125000); // $0.125 at 80
    expect(faceValueMicros(10, 20)).toBe(500000); // $0.50 at 20
  });

  it('reverses to exactly what it added', () => {
    // A refund replays the ORIGINAL rate, so face value nets to zero rather
    // than leaving a residue whenever the rate has moved since.
    expect(faceValueMicros(10, 100) + faceValueMicros(-10, 100)).toBe(0);
  });

  it('is zero rather than infinite when no rate is configured', () => {
    expect(faceValueMicros(10, 0)).toBe(0);
  });
});
