const { parseCron, isValidCron, matches, nextRun } = require('../src/utils/cron');

const at = (iso) => new Date(iso);

describe('cron parsing', () => {
  it('accepts the shapes the registry ships', () => {
    ['0 3 * * *', '0 */6 * * *', '0 4 * * 1', '*/15 * * * *', '5 * * * *', '30 4 * * *'].forEach((expr) =>
      expect(isValidCron(expr)).toBe(true)
    );
  });

  it('rejects malformed expressions', () => {
    ['', '0 3 * *', '0 3 * * * *', '60 * * * *', '* 25 * * *', '* * 0 * *', '* * * 13 *', '* * * * 7', 'a b c d e']
      .forEach((expr) => expect(isValidCron(expr)).toBe(false));
  });

  it('rejects a reversed range and a zero step', () => {
    expect(isValidCron('10-5 * * * *')).toBe(false);
    expect(isValidCron('*/0 * * * *')).toBe(false);
  });

  it('expands each field syntax', () => {
    const [minute] = parseCron('0,15,30,45 * * * *');
    expect([...minute.values].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);

    const [step] = parseCron('*/20 * * * *');
    expect([...step.values].sort((a, b) => a - b)).toEqual([0, 20, 40]);

    const [range] = parseCron('5-8 * * * *');
    expect([...range.values].sort((a, b) => a - b)).toEqual([5, 6, 7, 8]);

    const [rangeStep] = parseCron('0-30/10 * * * *');
    expect([...rangeStep.values].sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
  });
});

describe('matching', () => {
  it('matches an exact minute and hour', () => {
    expect(matches('0 3 * * *', at('2026-08-08T03:00:00'))).toBe(true);
    expect(matches('0 3 * * *', at('2026-08-08T03:01:00'))).toBe(false);
    expect(matches('0 3 * * *', at('2026-08-08T04:00:00'))).toBe(false);
  });

  it('matches a step schedule', () => {
    expect(matches('*/15 * * * *', at('2026-08-08T10:00:00'))).toBe(true);
    expect(matches('*/15 * * * *', at('2026-08-08T10:15:00'))).toBe(true);
    expect(matches('*/15 * * * *', at('2026-08-08T10:16:00'))).toBe(false);
  });

  it('matches a weekday schedule', () => {
    // 2026-08-10 is a Monday.
    expect(matches('0 4 * * 1', at('2026-08-10T04:00:00'))).toBe(true);
    expect(matches('0 4 * * 1', at('2026-08-11T04:00:00'))).toBe(false);
  });

  it('treats Sunday as both 0 and the start of the week', () => {
    expect(matches('0 0 * * 0', at('2026-08-09T00:00:00'))).toBe(true); // Sunday
  });

  it('ORs day-of-month against day-of-week when both are restricted', () => {
    // Standard cron quirk: "1st of the month OR any Monday".
    expect(matches('0 0 1 * 1', at('2026-08-01T00:00:00'))).toBe(true); // the 1st, a Saturday
    expect(matches('0 0 1 * 1', at('2026-08-10T00:00:00'))).toBe(true); // a Monday
    expect(matches('0 0 1 * 1', at('2026-08-12T00:00:00'))).toBe(false);
  });

  it('honours a month restriction', () => {
    expect(matches('0 0 1 8 *', at('2026-08-01T00:00:00'))).toBe(true);
    expect(matches('0 0 1 8 *', at('2026-09-01T00:00:00'))).toBe(false);
  });
});

describe('nextRun', () => {
  it('finds the next occurrence', () => {
    const next = nextRun('0 3 * * *', at('2026-08-08T04:00:00'));
    expect(next.getDate()).toBe(9);
    expect(next.getHours()).toBe(3);
    expect(next.getMinutes()).toBe(0);
  });

  it('never returns the current minute', () => {
    const now = at('2026-08-08T03:00:00');
    expect(nextRun('0 3 * * *', now).getTime()).toBeGreaterThan(now.getTime());
  });

  it('handles a weekly schedule', () => {
    const next = nextRun('0 4 * * 1', at('2026-08-08T00:00:00')); // Saturday
    expect(next.getDay()).toBe(1);
  });
});
