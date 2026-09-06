const analyticsService = require('../services/analyticsService');
const revenueReportService = require('../services/revenueReportService');
const { asyncHandler } = require('../middlewares/errorHandler');

// GET /api/admin/analytics/novels
const getNovelLeaderboard = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json({ novels: await analyticsService.novelLeaderboard({ limit }) });
});

// GET /api/admin/analytics/novels/:id — backs the retention-vs-paywall chart
const getNovelPerformance = asyncHandler(async (req, res) => {
  res.json(await analyticsService.novelChapterPerformance(req.params.id));
});

// GET /api/admin/analytics/funnel
const getFunnel = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  res.json(
    await analyticsService.paywallFunnel({
      novelId: req.query.novelId || null,
      since: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    })
  );
});

// GET /api/admin/analytics/economy
const getEconomy = asyncHandler(async (req, res) => {
  res.json(await analyticsService.creditEconomy());
});

// GET /api/admin/analytics/authors?from=YYYY-MM-DD&to=YYYY-MM-DD
const getAuthorEarnings = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  res.json({ authors: await analyticsService.authorEarnings({ from, to }) });
});

// GET /api/admin/analytics/authors/:id
const getAuthorBreakdown = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  res.json({ novels: await analyticsService.authorNovelBreakdown(req.params.id, { from, to }) });
});

// GET /api/admin/analytics/authors.csv — what actually goes into a negotiation.
const exportAuthorEarnings = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const rows = await analyticsService.authorEarnings({ from, to });

  const header = 'Author,Novels,Readers,Unlocks,Credits earned,Revenue USD,Grant-funded credits,Grant-funded %';
  const escape = (value) => (/[",]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : value);
  const body = rows
    .map((row) =>
      [
        escape(row.authorName),
        row.novelCount,
        row.readers,
        row.unlocks,
        row.creditsEarned,
        (row.revenueUsdCents / 100).toFixed(2),
        row.grantFundedCredits,
        row.grantFundedPct,
      ].join(',')
    )
    .join('\n');

  const range = from || to ? `-${from || 'start'}_${to || 'today'}` : '';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="author-earnings${range}.csv"`);
  res.send(`${header}\n${body}\n`);
});

// --- Ranged revenue reporting --------------------------------------------
//
// Every endpoint below takes the same window contract, so the client has one
// query-string shape to build and the server has one place that parses it:
//   from, to   YYYY-MM-DD in the configured reporting timezone (inclusive)
//   days       shorthand for a trailing window when `from` is absent
//   granularity  day | week | month
//   compare    include the equal-length preceding window and its deltas

const rangeParams = (req) => ({
  from: req.query.from || null,
  to: req.query.to || null,
  days: req.query.days || null,
  granularity: req.query.granularity || 'day',
  compare: req.query.compare === 'true' || req.query.compare === '1',
});

// GET /api/admin/analytics/revenue
const getRevenueSummary = asyncHandler(async (req, res) => {
  res.json(
    await revenueReportService.summary({
      ...rangeParams(req),
      novelId: req.query.novelId || null,
      chapterId: req.query.chapterId || null,
      authorId: req.query.authorId || null,
    })
  );
});

// GET /api/admin/analytics/revenue/novels
const getRevenueByNovel = asyncHandler(async (req, res) => {
  res.json({
    novels: await revenueReportService.novelBreakdown({
      ...rangeParams(req),
      authorId: req.query.authorId || null,
      sort: req.query.sort || 'revenue',
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 500),
    }),
  });
});

// GET /api/admin/analytics/revenue/novels/:id — summary + per-chapter rows
const getRevenueByChapter = asyncHandler(async (req, res) => {
  const params = rangeParams(req);
  const [summary, chapters] = await Promise.all([
    revenueReportService.summary({ ...params, novelId: req.params.id }),
    revenueReportService.chapterBreakdown(req.params.id, params),
  ]);
  res.json({ ...summary, chapters });
});

// GET /api/admin/analytics/revenue/authors
const getRevenueByAuthor = asyncHandler(async (req, res) => {
  res.json({ authors: await revenueReportService.authorBreakdown(rangeParams(req)) });
});

const csvEscape = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : value);

const sendCsv = (res, filename, header, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send([header.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n') + '\n');
};

// GET /api/admin/analytics/revenue/export.csv?scope=novels|chapters|authors
const exportRevenue = asyncHandler(async (req, res) => {
  const params = rangeParams(req);
  const scope = req.query.scope || 'novels';
  const stamp = `${params.from || 'start'}_${params.to || 'today'}`;

  if (scope === 'chapters') {
    if (!req.query.novelId) {
      return res.status(400).json({ message: 'novelId is required to export chapters' });
    }
    const rows = await revenueReportService.chapterBreakdown(req.query.novelId, params);
    return sendCsv(
      res,
      `chapter-revenue-${stamp}.csv`,
      ['Chapter', 'Title', 'Reads', 'Gate impressions', 'Unlocks', 'Conversion %', 'Credits', 'Revenue USD', 'Refunded USD', 'Face value USD'],
      rows.map((row) => [
        row.number, row.title, row.reads, row.gateImpressions, row.unlocks,
        row.conversionPct ?? '', row.creditsSpent,
        (row.revenueUsdCents / 100).toFixed(2),
        (row.refundedUsdCents / 100).toFixed(2),
        (row.faceValueUsdCents / 100).toFixed(2),
      ])
    );
  }

  if (scope === 'authors') {
    const rows = await revenueReportService.authorBreakdown(params);
    return sendCsv(
      res,
      `author-revenue-${stamp}.csv`,
      ['Author', 'Linked', 'Novels', 'Unlocks', 'Buyers', 'Credits', 'Paid credits', 'Grant-funded %', 'Revenue USD', 'Refunded USD'],
      rows.map((row) => [
        row.authorName, row.linked ? 'yes' : 'no', row.novelCount, row.unlocks, row.buyers,
        row.creditsSpent, row.paidCredits, row.grantFundedPct,
        (row.revenueUsdCents / 100).toFixed(2),
        (row.refundedUsdCents / 100).toFixed(2),
      ])
    );
  }

  const rows = await revenueReportService.novelBreakdown({ ...params, limit: 500 });
  return sendCsv(
    res,
    `novel-revenue-${stamp}.csv`,
    ['Novel', 'Author', 'Unlocks', 'Buyers', 'Credits', 'Grant-funded %', 'Revenue USD', 'Refunded USD', 'ARPU USD'],
    rows.map((row) => [
      row.title, row.authorName, row.unlocks, row.buyers, row.creditsSpent, row.grantFundedPct,
      (row.revenueUsdCents / 100).toFixed(2),
      (row.refundedUsdCents / 100).toFixed(2),
      (row.arpuUsdCents / 100).toFixed(2),
    ])
  );
});

// POST /api/admin/analytics/rebuild — recompute the trailing rollup window.
const rebuildRollups = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 3, 90);
  res.json(await require('../services/rollupService').rebuildRecent(days));
});

module.exports = {
  getRevenueSummary,
  getRevenueByNovel,
  getRevenueByChapter,
  getRevenueByAuthor,
  exportRevenue,
  getNovelLeaderboard,
  getNovelPerformance,
  getFunnel,
  getEconomy,
  getAuthorEarnings,
  getAuthorBreakdown,
  exportAuthorEarnings,
  rebuildRollups,
};
