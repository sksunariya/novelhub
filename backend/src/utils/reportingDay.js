/**
 * The calendar every stored day key is written in.
 *
 * Rollup rows (ChapterStatsDaily, NovelRevenueDaily, RevenueDaily), the
 * RevenueEvent.day denormalization and GateImpression/read buckets are all
 * keyed "YYYY-MM-DD" in this zone. It is a constant, not a setting: changing it
 * means re-keying stored rows (scripts/rekeyReportingDays.js), so it must not
 * be flipped from the admin panel. Ranged reports that bucket off raw
 * timestamps use `analytics.reportingTimezone` instead, which defaults to the
 * same zone.
 *
 * Asia/Kolkata has no DST, so a day is always exactly 24h starting at
 * 00:00 +05:30. The helpers still go through Intl for the key so they stay
 * correct if this constant is ever pointed at a DST zone — but dayBounds and
 * shiftDay rely on the fixed offset, and would need revisiting then.
 */
const REPORTING_TZ = 'Asia/Kolkata';
const REPORTING_OFFSET = '+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;

const keyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Day key ("YYYY-MM-DD") of an instant, in the reporting zone. */
const dayKey = (date = new Date()) => keyFormat.format(new Date(date));

/** First and last millisecond of a reporting-zone day, as UTC instants. */
const dayBounds = (day) => {
  const from = new Date(`${day}T00:00:00.000${REPORTING_OFFSET}`);
  return { from, to: new Date(from.getTime() + DAY_MS - 1) };
};

/** The day key `n` days after (negative: before) `day`. */
const shiftDay = (day, n) => dayKey(new Date(dayBounds(day).from.getTime() + n * DAY_MS + DAY_MS / 2));

/** Days from `back` days ago through today, oldest first. */
const recentDays = (back, now = new Date()) => {
  const today = dayKey(now);
  const days = [];
  for (let i = back; i >= 0; i -= 1) days.push(shiftDay(today, -i));
  return days;
};

module.exports = { REPORTING_TZ, dayKey, dayBounds, shiftDay, recentDays };
