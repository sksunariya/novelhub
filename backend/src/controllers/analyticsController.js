const analyticsService = require('../services/analyticsService');
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

// POST /api/admin/analytics/rebuild — recompute the trailing rollup window.
const rebuildRollups = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 3, 90);
  res.json(await require('../services/rollupService').rebuildRecent(days));
});

module.exports = {
  getNovelLeaderboard,
  getNovelPerformance,
  getFunnel,
  getEconomy,
  getAuthorEarnings,
  getAuthorBreakdown,
  exportAuthorEarnings,
  rebuildRollups,
};
