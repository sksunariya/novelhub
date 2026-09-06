// Date-ranged revenue reporting.
//
// Reads the RevenueEvent ledger directly rather than the daily rollups, for one
// reason: rollup rows are keyed by UTC day, and an admin in Asia/Kolkata asking
// for "this month" does not mean the UTC month. Bucketing off the raw event
// timestamp with $dateTrunc lets Mongo apply the configured reporting timezone,
// so the boundaries are the admin's, not the server's, and changing the setting
// needs no migration.
//
// The ledger is small relative to reads — one row per unlock, not one per page
// view — and every query here is served by (novel|chapter|author, occurredAt)
// indexes, so this stays fast without a second rollup shape to keep in sync.

const mongoose = require('mongoose');
const RevenueEvent = require('../models/RevenueEvent');
const ChapterStatsDaily = require('../models/ChapterStatsDaily');
const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const settingsService = require('./settingsService');
const { MICROS_PER_CENT, REPORT_GRANULARITIES } = require('../config/constants');

const oid = (value) => new mongoose.Types.ObjectId(String(value));
const cents = (micros) => Math.round((micros || 0) / MICROS_PER_CENT);

const DAY_MS = 86400000;
const GRANULARITIES = new Set(Object.values(REPORT_GRANULARITIES));

/** Cheap sanity check — an unknown zone makes every $dateTrunc throw. */
const validTimezone = (zone) => {
  if (!zone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const timezone = async () => {
  const zone = await settingsService.get('analytics.reportingTimezone');
  return validTimezone(zone) ? zone : 'UTC';
};

/**
 * The UTC instant at which a local calendar day starts in `zone`.
 *
 * Derived by measuring the zone's offset at that moment rather than assuming a
 * fixed one, so a range that crosses a DST boundary still starts and ends where
 * the admin thinks it does.
 */
const zonedStart = (dateStr, zone) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  // What the guess reads as locally, minus what we wanted, is the offset.
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return new Date(guess - (asLocal - guess));
};

/**
 * Resolve a request into an absolute window plus the comparison window.
 *
 * `to` is inclusive of the whole local day, which is what a date picker means
 * by it; an exclusive end silently drops the most recent day's sales and is the
 * classic way a dashboard reports yesterday's number as today's.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const assertDay = (value, label) => {
  if (value && (!ISO_DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
    throw Object.assign(new Error(`${label} must be a date in YYYY-MM-DD form`), { status: 400 });
  }
};

const resolveRange = async ({ from = null, to = null, days = null, granularity = 'day', compare = false }) => {
  // Unvalidated input reaches Date.UTC(NaN, …) inside zonedStart and surfaces
  // as a 500 with "Invalid time value" rather than as the bad request it is.
  assertDay(from, 'from');
  assertDay(to, 'to');
  if (from && to && from > to) {
    throw Object.assign(new Error('from must not be after to'), { status: 400 });
  }

  const zone = await timezone();
  const now = new Date();

  const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now); // YYYY-MM-DD
  const toStr = to || localToday;
  const fromStr =
    from ||
    (() => {
      const span = Math.max(1, Math.min(Number(days) || 30, 1830));
      const end = zonedStart(toStr, zone);
      return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(end.getTime() - (span - 1) * DAY_MS));
    })();

  const start = zonedStart(fromStr, zone);
  // Exclusive upper bound: the instant the day AFTER `to` begins locally.
  const endExclusive = new Date(zonedStart(toStr, zone).getTime() + DAY_MS);
  const spanMs = endExclusive.getTime() - start.getTime();

  const unit = GRANULARITIES.has(granularity) ? granularity : REPORT_GRANULARITIES.DAY;

  const previous = compare
    ? { start: new Date(start.getTime() - spanMs), endExclusive: new Date(start.getTime()) }
    : null;

  return { zone, from: fromStr, to: toStr, start, endExclusive, unit, previous, spanDays: Math.round(spanMs / DAY_MS) };
};

/** Match stage shared by every query here. */
const windowMatch = (range, extra = {}, useprevious = false) => {
  const window = useprevious ? range.previous : range;
  return { occurredAt: { $gte: window.start, $lt: window.endExclusive }, ...extra };
};

// The figures every scope reports, so a novel row, a chapter row and the
// headline totals cannot drift apart in definition.
const TOTALS_GROUP = {
  grossUsdMicros: { $sum: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, '$attributedUsdMicros', 0] } },
  refundedUsdMicros: { $sum: { $cond: [{ $lt: ['$attributedUsdMicros', 0] }, '$attributedUsdMicros', 0] } },
  netUsdMicros: { $sum: '$attributedUsdMicros' },
  faceValueUsdMicros: { $sum: '$faceValueUsdMicros' },
  creditsSpent: { $sum: '$creditsSpent' },
  grantFundedCredits: { $sum: '$grantFundedCredits' },
  unlocks: { $sum: { $cond: [{ $gte: ['$attributedUsdMicros', 0] }, 1, 0] } },
  refunds: { $sum: { $cond: [{ $lt: ['$attributedUsdMicros', 0] }, 1, 0] } },
  buyers: { $addToSet: { $cond: [{ $gt: ['$attributedUsdMicros', 0] }, '$user', '$$REMOVE'] } },
};

const shapeTotals = (row) => {
  const paidCredits = (row?.creditsSpent || 0) - (row?.grantFundedCredits || 0);
  const net = row?.netUsdMicros || 0;
  const unlocks = row?.unlocks || 0;
  return {
    revenueUsdCents: cents(net),
    grossUsdCents: cents(row?.grossUsdMicros || 0),
    refundedUsdCents: Math.abs(cents(row?.refundedUsdMicros || 0)),
    faceValueUsdCents: cents(row?.faceValueUsdMicros || 0),
    creditsSpent: row?.creditsSpent || 0,
    paidCredits,
    grantFundedCredits: row?.grantFundedCredits || 0,
    grantFundedPct: row?.creditsSpent ? +((row.grantFundedCredits / row.creditsSpent) * 100).toFixed(1) : 0,
    unlocks,
    refunds: row?.refunds || 0,
    buyers: row?.buyers ? row.buyers.length : 0,
    // What one unlock was worth. The number that actually moves when pricing
    // changes, and the one a per-chapter table is read for.
    arpuUsdCents: unlocks ? Math.round(net / MICROS_PER_CENT / unlocks) : 0,
  };
};

/** Percentage change, or null when there is no baseline to compare against. */
const delta = (current, previous) => {
  if (previous === null || previous === undefined) return null;
  if (!previous) return current ? null : 0;
  return +(((current - previous) / Math.abs(previous)) * 100).toFixed(1);
};

const withComparison = (current, previous) => {
  if (!previous) return { ...current, previous: null, change: null };
  return {
    ...current,
    previous,
    change: {
      revenueUsdCents: delta(current.revenueUsdCents, previous.revenueUsdCents),
      unlocks: delta(current.unlocks, previous.unlocks),
      buyers: delta(current.buyers, previous.buyers),
      creditsSpent: delta(current.creditsSpent, previous.creditsSpent),
      arpuUsdCents: delta(current.arpuUsdCents, previous.arpuUsdCents),
    },
  };
};

const scopeMatch = ({ novelId = null, chapterId = null, authorId = null }) => {
  const match = {};
  if (novelId) match.novel = oid(novelId);
  if (chapterId) match.chapter = oid(chapterId);
  if (authorId) match.author = authorId === 'unattributed' ? null : oid(authorId);
  return match;
};

/** Totals for one window and scope. */
const totalsFor = async (range, scope, usePrevious = false) => {
  const [row] = await RevenueEvent.aggregate([
    { $match: windowMatch(range, scopeMatch(scope), usePrevious) },
    { $group: { _id: null, ...TOTALS_GROUP } },
  ]);
  return shapeTotals(row);
};

/**
 * The revenue series.
 *
 * Empty buckets are filled in rather than skipped: a chart drawn from only the
 * days that had sales compresses a quiet week into a single point and makes a
 * flat period look like a busy one.
 */
const series = async (range, scope) => {
  const bucketed = (usePrevious) =>
    RevenueEvent.aggregate([
      { $match: windowMatch(range, scopeMatch(scope), usePrevious) },
      {
        $group: {
          _id: { $dateTrunc: { date: '$occurredAt', unit: range.unit, timezone: range.zone } },
          ...TOTALS_GROUP,
        },
      },
      { $sort: { _id: 1 } },
    ]);

  const [rows, previousRows] = await Promise.all([
    bucketed(false),
    range.previous ? bucketed(true) : Promise.resolve([]),
  ]);

  const walk = (from, until, byBucket) =>
    bucketStarts({ start: from, endExclusive: until, unit: range.unit, zone: range.zone }).map((cursor) => ({
      bucket: cursor.toISOString(),
      label: bucketLabel(cursor, range),
      ...shapeTotals(byBucket.get(cursor.toISOString())),
    }));

  const current = walk(range.start, range.endExclusive, new Map(rows.map((row) => [row._id.toISOString(), row])));
  if (!range.previous) return current;

  // Zipped by POSITION, not by date: the point of the overlay is "day 3 of this
  // period against day 3 of the last one", and the two windows have different
  // calendar dates by construction.
  const prior = walk(
    range.previous.start,
    range.previous.endExclusive,
    new Map(previousRows.map((row) => [row._id.toISOString(), row]))
  );
  return current.map((point, index) => ({
    ...point,
    previous: prior[index] ? { ...prior[index] } : null,
  }));
};

/**
 * Every bucket start in the window, as the instants $dateTrunc would return.
 *
 * The series is joined to the aggregation by these keys, so any drift between
 * the two shows up as a chart of correctly-labelled empty buckets beside a
 * totals card with the right number. Exported for exactly that test.
 */
const bucketStarts = ({ start, endExclusive, unit, zone }) => {
  const out = [];
  const cursor = new Date(truncate(start, unit, zone));
  // Bounded independently of the date maths: a step that failed to advance
  // would otherwise hang the request rather than return a wrong answer.
  for (let guard = 0; cursor < endExclusive && guard < 4000; guard += 1) {
    out.push(new Date(cursor));
    const before = cursor.getTime();
    advance(cursor, unit, zone);
    if (cursor.getTime() <= before) break;
  }
  return out;
};

/** Local-calendar truncation, matching what $dateTrunc does server-side. */
const truncate = (date, unit, zone) => {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(date);
  if (unit === REPORT_GRANULARITIES.MONTH) return zonedStart(`${local.slice(0, 7)}-01`, zone);
  if (unit === REPORT_GRANULARITIES.WEEK) {
    // $dateTrunc weeks start on Sunday. The weekday must come from the LOCAL
    // calendar date: in Asia/Kolkata a local midnight is 18:30 the previous day
    // in UTC, so reading the weekday off the instant lands a week early.
    const weekday = new Date(`${local}T00:00:00Z`).getUTCDay();
    const start = zonedStart(local, zone);
    return new Date(start.getTime() - weekday * DAY_MS);
  }
  return zonedStart(local, zone);
};

/**
 * Step one bucket forward in the LOCAL calendar.
 *
 * Adding a fixed 86,400,000 ms is wrong across a DST change: the day after a
 * spring-forward is 23 hours long, so a fixed step lands an hour off local
 * midnight and every subsequent key stops matching the ones $dateTrunc
 * produced — the chart then draws correctly-labelled days at zero from the
 * transition onwards while the totals card shows the real figure.
 */
const advance = (cursor, unit, zone) => {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(cursor);

  if (unit === REPORT_GRANULARITIES.MONTH) {
    const [y, m] = local.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    cursor.setTime(zonedStart(next, zone).getTime());
    return;
  }

  // Land in the middle of the target day, then snap back to its local start —
  // midday is far enough from either boundary that no real offset shift can
  // push it into the wrong date.
  const days = unit === REPORT_GRANULARITIES.WEEK ? 7 : 1;
  const midday = new Date(`${local}T12:00:00Z`).getTime() + days * DAY_MS;
  const target = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(midday));
  cursor.setTime(zonedStart(target, zone).getTime());
};

const bucketLabel = (date, range) => {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: range.zone }).format(date);
  return range.unit === REPORT_GRANULARITIES.MONTH ? local.slice(0, 7) : local;
};

/**
 * Readership context for the same window.
 *
 * Sourced from ChapterStatsDaily, whose buckets are UTC days. In a non-UTC
 * reporting zone the read counts can therefore be off by the part of a day at
 * each edge of the range; revenue is exact regardless. Callers surface this as
 * `readsApproximate` rather than quietly presenting the two as equally precise.
 */
const readership = async (range, scope) => {
  const match = {};
  if (scope.novelId) match.novel = oid(scope.novelId);
  if (scope.chapterId) match.chapter = oid(scope.chapterId);
  const [row] = await ChapterStatsDaily.aggregate([
    {
      $match: {
        ...match,
        day: {
          $gte: new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(range.start),
          $lte: new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(range.endExclusive.getTime() - 1)),
        },
      },
    },
    {
      $group: {
        _id: null,
        reads: { $sum: '$reads' },
        readerDays: { $sum: '$uniqueReaders' },
        gateImpressions: { $sum: '$gateImpressions' },
      },
    },
  ]);
  return {
    reads: row?.reads || 0,
    // Named for what it is. Summing daily uniques across a range counts a
    // returning reader once per day they came back, and calling that "unique
    // readers" is how a dashboard doubles its own audience.
    readerDays: row?.readerDays || 0,
    gateImpressions: row?.gateImpressions || 0,
    readsApproximate: range.zone !== 'UTC',
  };
};

/** Headline summary: totals, comparison, series, readership. */
const summary = async (options = {}) => {
  const range = await resolveRange(options);
  const scope = scopeMatch(options);
  const hasScope = Object.keys(scope).length > 0;

  const [current, previous, points, reads, basis] = await Promise.all([
    totalsFor(range, options),
    range.previous ? totalsFor(range, options, true) : Promise.resolve(null),
    series(range, options),
    readership(range, options),
    settingsService.get('analytics.revenueBasis'),
  ]);

  return {
    range: {
      from: range.from,
      to: range.to,
      timezone: range.zone,
      granularity: range.unit,
      days: range.spanDays,
      comparedTo: range.previous
        ? {
            from: new Intl.DateTimeFormat('en-CA', { timeZone: range.zone }).format(range.previous.start),
            to: new Intl.DateTimeFormat('en-CA', { timeZone: range.zone }).format(
              new Date(range.previous.endExclusive.getTime() - 1)
            ),
          }
        : null,
    },
    // The setting existed and was read by nothing. It now says which figure the
    // UI should lead with; both are always present so switching costs a render,
    // not a query.
    revenueBasis: basis || 'attributed_cash',
    scoped: hasScope,
    totals: withComparison(current, previous),
    readership: reads,
    series: points,
  };
};

/** Per-novel table for the window, ranked by net revenue. */
const novelBreakdown = async ({ limit = 50, sort = 'revenue', ...options } = {}) => {
  const range = await resolveRange(options);

  const run = (usePrevious) =>
    RevenueEvent.aggregate([
      { $match: windowMatch(range, scopeMatch(options), usePrevious) },
      { $group: { _id: '$novel', ...TOTALS_GROUP } },
    ]);

  const [rows, previousRows] = await Promise.all([
    run(false),
    range.previous ? run(true) : Promise.resolve([]),
  ]);

  const previousByNovel = new Map(previousRows.map((row) => [String(row._id), shapeTotals(row)]));

  // withDeleted so a binned novel still shows what it earned instead of
  // disappearing from a period it was live for.
  const novels = await Novel.find({ _id: { $in: rows.map((r) => r._id) } })
    .select('title slug coverUrl author authorRef deletedAt')
    .populate({ path: 'authorRef', select: 'name' })
    .setOptions({ withDeleted: true });
  const byId = new Map(novels.map((novel) => [String(novel._id), novel]));

  const SORTS = {
    revenue: (a, b) => b.revenueUsdCents - a.revenueUsdCents,
    unlocks: (a, b) => b.unlocks - a.unlocks,
    buyers: (a, b) => b.buyers - a.buyers,
    arpu: (a, b) => b.arpuUsdCents - a.arpuUsdCents,
    title: (a, b) => a.title.localeCompare(b.title),
  };

  return rows
    .map((row) => {
      const key = String(row._id);
      const novel = byId.get(key);
      return {
        novelId: row._id,
        title: novel?.title || '(removed)',
        slug: novel?.slug || null,
        coverUrl: novel?.coverUrl || '',
        authorName: novel?.authorRef?.name || novel?.author || '',
        deleted: Boolean(novel?.deletedAt),
        ...withComparison(shapeTotals(row), previousByNovel.get(key) || null),
      };
    })
    .sort(SORTS[sort] || SORTS.revenue)
    .slice(0, Math.min(limit, 500));
};

/**
 * Per-chapter table for one novel over the window.
 *
 * Published chapters with no activity in the range are included with zeroes —
 * a chapter earning nothing this month is the finding, and omitting it hides
 * exactly the rows worth looking at.
 */
const chapterBreakdown = async (novelId, options = {}) => {
  const range = await resolveRange(options);

  const run = (usePrevious) =>
    RevenueEvent.aggregate([
      { $match: windowMatch(range, { novel: oid(novelId) }, usePrevious) },
      { $group: { _id: '$chapter', chapterNumber: { $max: '$chapterNumber' }, ...TOTALS_GROUP } },
    ]);

  const [rows, previousRows, chapters] = await Promise.all([
    run(false),
    range.previous ? run(true) : Promise.resolve([]),
    Chapter.find({ novel: oid(novelId), published: true })
      .select('number title publishedAt wordCount accessType priceCredits createdAt')
      .sort({ number: 1 }),
  ]);

  const current = new Map(rows.map((row) => [String(row._id), row]));
  const previous = new Map(previousRows.map((row) => [String(row._id), shapeTotals(row)]));

  const utcFrom = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(range.start);
  const utcTo = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(range.endExclusive.getTime() - 1));
  const readRows = await ChapterStatsDaily.aggregate([
    { $match: { novel: oid(novelId), day: { $gte: utcFrom, $lte: utcTo } } },
    {
      $group: {
        _id: '$chapter',
        reads: { $sum: '$reads' },
        readerDays: { $sum: '$uniqueReaders' },
        gateImpressions: { $sum: '$gateImpressions' },
      },
    },
  ]);
  const reads = new Map(readRows.map((row) => [String(row._id), row]));

  const row = (chapter, key, extra = {}) => {
    const read = reads.get(key);
    const totals = shapeTotals(current.get(key));
    const gate = read?.gateImpressions || 0;
    return {
      chapterId: chapter._id,
      number: chapter.number,
      title: chapter.title,
      publishedAt: chapter.publishedAt || chapter.createdAt || null,
      wordCount: chapter.wordCount || 0,
      reads: read?.reads || 0,
      readerDays: read?.readerDays || 0,
      gateImpressions: gate,
      conversionPct: gate ? +((totals.unlocks / gate) * 100).toFixed(1) : null,
      ...extra,
      ...withComparison(totals, previous.get(key) || null),
    };
  };

  const out = chapters.map((chapter) => row(chapter, String(chapter._id)));
  const listed = new Set(out.map((entry) => String(entry.chapterId)));

  // Chapters that earned in this window but are no longer published — binned,
  // or unpublished since. Without a row for them the table silently sums to
  // less than the total above it and nothing explains the gap. The ledger
  // carries the chapter number, so they can be shown without the document.
  for (const [key, aggregate] of current) {
    if (listed.has(key)) continue;
    out.push(
      row({ _id: aggregate._id, number: aggregate.chapterNumber || 0, title: '(removed chapter)' }, key, {
        unavailable: true,
      })
    );
  }

  return out.sort((a, b) => a.number - b.number);
};

/** Per-author table for the window. */
const authorBreakdown = async (options = {}) => {
  const range = await resolveRange(options);

  const run = (usePrevious) =>
    RevenueEvent.aggregate([
      { $match: windowMatch(range, {}, usePrevious) },
      {
        $group: {
          _id: { author: '$author', authorName: '$authorName' },
          novels: { $addToSet: '$novel' },
          ...TOTALS_GROUP,
        },
      },
    ]);

  const [rows, previousRows] = await Promise.all([
    run(false),
    range.previous ? run(true) : Promise.resolve([]),
  ]);

  const key = (row) => `${row._id.author || 'null'}::${row._id.authorName || ''}`;
  const previous = new Map(previousRows.map((row) => [key(row), shapeTotals(row)]));

  return rows
    .map((row) => ({
      authorId: row._id.author,
      authorName: row._id.authorName || '(unattributed)',
      linked: Boolean(row._id.author),
      novelCount: row.novels.length,
      ...withComparison(shapeTotals(row), previous.get(key(row)) || null),
    }))
    .sort((a, b) => b.revenueUsdCents - a.revenueUsdCents);
};

module.exports = {
  resolveRange,
  bucketStarts,
  summary,
  novelBreakdown,
  chapterBreakdown,
  authorBreakdown,
  totalsFor,
  series,
  zonedStart,
};
