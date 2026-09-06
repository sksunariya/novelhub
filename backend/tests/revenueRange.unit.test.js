// Range resolution is pure date arithmetic and the easiest thing in the
// reporting stack to get subtly wrong: an exclusive end silently drops the most
// recent day, and a half-hour offset zone breaks any code that assumes whole
// hours. Both failures produce a plausible-looking dashboard, so they are
// tested directly rather than through an endpoint.

// Mocked so the range maths can be exercised without a database. `clearCache`
// is part of the shape because tests/setup.js calls it after every test when
// this file is picked up by the full (DB-backed) jest config as well.
jest.mock('../src/services/settingsService', () => ({
  get: jest.fn(),
  snapshot: jest.fn(),
  clearCache: jest.fn(),
  update: jest.fn(),
}));

const settingsService = require('../src/services/settingsService');
const { resolveRange, zonedStart, bucketStarts } = require('../src/services/revenueReportService');

const useZone = (zone) => {
  settingsService.get.mockImplementation((key) =>
    Promise.resolve(key === 'analytics.reportingTimezone' ? zone : null)
  );
};

describe('zonedStart', () => {
  it('finds the UTC instant a local day begins', async () => {
    expect(zonedStart('2026-09-02', 'UTC').toISOString()).toBe('2026-09-02T00:00:00.000Z');
    // Half-hour offset — the case that breaks whole-hour assumptions.
    expect(zonedStart('2026-09-02', 'Asia/Kolkata').toISOString()).toBe('2026-09-01T18:30:00.000Z');
    expect(zonedStart('2026-09-02', 'Australia/Sydney').toISOString()).toBe('2026-09-01T14:00:00.000Z');
  });

  it('uses the offset actually in force, not a fixed one', () => {
    // New York is UTC-4 in September and UTC-5 in January. A cached offset
    // would put one of these an hour out.
    expect(zonedStart('2026-09-02', 'America/New_York').toISOString()).toBe('2026-09-02T04:00:00.000Z');
    expect(zonedStart('2026-01-15', 'America/New_York').toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('resolveRange', () => {
  beforeEach(() => useZone('UTC'));

  it('includes the whole of the final day', async () => {
    const range = await resolveRange({ from: '2026-03-01', to: '2026-03-31' });
    expect(range.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // Exclusive bound sits at the START of 1 April, so a sale at 23:59 on the
    // 31st is inside the range. An end of 31 Mar 00:00 would lose that day.
    expect(range.endExclusive.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(range.spanDays).toBe(31);
  });

  it('shifts both boundaries into the reporting timezone', async () => {
    useZone('Asia/Kolkata');
    const range = await resolveRange({ from: '2026-03-01', to: '2026-03-01' });
    expect(range.start.toISOString()).toBe('2026-02-28T18:30:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-03-01T18:30:00.000Z');
    expect(range.spanDays).toBe(1);
  });

  it('derives a trailing window from `days` inclusive of today', async () => {
    const range = await resolveRange({ to: '2026-03-31', days: 7 });
    expect(range.from).toBe('2026-03-25');
    expect(range.to).toBe('2026-03-31');
    expect(range.spanDays).toBe(7);
  });

  it('compares against the equal-length window immediately before', async () => {
    const range = await resolveRange({ from: '2026-03-08', to: '2026-03-14', compare: true });
    expect(range.previous.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // Ends exactly where the current window starts: no gap, no overlap.
    expect(range.previous.endExclusive.toISOString()).toBe(range.start.toISOString());
  });

  it('omits the comparison window unless asked', async () => {
    const range = await resolveRange({ from: '2026-03-08', to: '2026-03-14' });
    expect(range.previous).toBeNull();
  });

  it('accepts only known granularities', async () => {
    expect((await resolveRange({ from: '2026-03-01', to: '2026-03-31', granularity: 'week' })).unit).toBe('week');
    expect((await resolveRange({ from: '2026-03-01', to: '2026-03-31', granularity: 'month' })).unit).toBe('month');
    // An unknown unit would make $dateTrunc throw, so it falls back rather
    // than reaching the database.
    expect((await resolveRange({ from: '2026-03-01', to: '2026-03-31', granularity: 'fortnight' })).unit).toBe('day');
  });

  it('falls back to UTC when the configured zone is not a real one', async () => {
    useZone('Mars/Olympus_Mons');
    const range = await resolveRange({ from: '2026-03-01', to: '2026-03-01' });
    expect(range.zone).toBe('UTC');
    expect(range.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('caps an absurd `days` rather than scanning the whole ledger', async () => {
    const range = await resolveRange({ to: '2026-03-31', days: 999999 });
    expect(range.spanDays).toBeLessThanOrEqual(1830);
  });
});

describe('bucketStarts', () => {
  // The series is joined to the aggregation on these keys. If they drift from
  // what $dateTrunc returns, the chart draws correctly-labelled empty buckets
  // next to a totals card showing the real figure — which reads as "we sold
  // nothing after the 8th" rather than as a bug.
  const trunc = (dateStr, zone) => zonedStart(dateStr, zone).toISOString();
  const localDate = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(date);

  const agrees = (zone, from, to, unit = 'day') => {
    const keys = bucketStarts({
      start: zonedStart(from, zone),
      endExclusive: zonedStart(to, zone),
      unit,
      zone,
    });
    return keys.every((key) => key.toISOString() === trunc(localDate(key, zone), zone));
  };

  it('matches $dateTrunc across a spring-forward', () => {
    // Adding a flat 24h here lands an hour off local midnight from 9 March on.
    expect(agrees('America/New_York', '2026-03-05', '2026-03-13')).toBe(true);
  });

  it('matches $dateTrunc across a fall-back', () => {
    expect(agrees('America/New_York', '2026-10-28', '2026-11-05')).toBe(true);
  });

  it('matches in southern-hemisphere and half-hour zones', () => {
    expect(agrees('Australia/Sydney', '2026-04-01', '2026-04-10')).toBe(true);
    expect(agrees('Asia/Kolkata', '2026-03-05', '2026-03-25')).toBe(true);
  });

  it('produces one bucket per day, DST notwithstanding', () => {
    const zone = 'America/New_York';
    const keys = bucketStarts({
      start: zonedStart('2026-03-05', zone),
      endExclusive: zonedStart('2026-03-13', zone),
      unit: 'day',
      zone,
    });
    expect(keys).toHaveLength(8);
    // The offset really does change mid-window; this is not a UTC no-op.
    expect(keys[0].toISOString()).toBe('2026-03-05T05:00:00.000Z');
    expect(keys[7].toISOString()).toBe('2026-03-12T04:00:00.000Z');
  });

  it('always terminates', () => {
    const keys = bucketStarts({
      start: zonedStart('2026-01-01', 'UTC'),
      endExclusive: zonedStart('2027-01-01', 'UTC'),
      unit: 'month',
      zone: 'UTC',
    });
    expect(keys).toHaveLength(12);
  });
});
