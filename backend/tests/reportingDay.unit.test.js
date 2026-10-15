const { REPORTING_TZ, dayKey, dayBounds, shiftDay, recentDays } = require('../src/utils/reportingDay');

describe('reportingDay (IST day keys)', () => {
  it('is pinned to Asia/Kolkata', () => {
    expect(REPORTING_TZ).toBe('Asia/Kolkata');
  });

  it('rolls the day over at 00:00 IST, i.e. 18:30 UTC', () => {
    expect(dayKey(new Date('2026-10-15T18:29:59.999Z'))).toBe('2026-10-15');
    expect(dayKey(new Date('2026-10-15T18:30:00.000Z'))).toBe('2026-10-16');
  });

  it('bounds a day as exactly 24h from local midnight', () => {
    const { from, to } = dayBounds('2026-10-16');
    expect(from.toISOString()).toBe('2026-10-15T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-10-16T18:29:59.999Z');
    expect(dayKey(from)).toBe('2026-10-16');
    expect(dayKey(to)).toBe('2026-10-16');
  });

  it('steps across month, year and leap boundaries', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('lists the trailing window in IST, oldest first', () => {
    // 00:30 IST on the 16th is still the 15th in UTC.
    expect(recentDays(2, new Date('2026-10-15T19:00:00Z'))).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
  });
});
