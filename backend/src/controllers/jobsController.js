const JobRun = require('../models/JobRun');
const scheduler = require('../services/schedulerService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');

// GET /api/admin/jobs
const getJobs = asyncHandler(async (req, res) => {
  res.json(await scheduler.status());
});

// POST /api/admin/jobs/:name/run
const triggerJob = asyncHandler(async (req, res) => {
  const result = await scheduler.runJob(req.params.name, {
    trigger: 'manual',
    triggeredBy: req.user._id,
    // A manual run from the portal steals the lock: the admin is explicitly
    // asking for it now, and a stale lock should not block them.
    force: req.query.force === 'true',
  });
  res.json({ job: req.params.name, ...result });
});

// GET /api/admin/jobs/runs
const getJobRuns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.job) filter.job = req.query.job;
  if (req.query.status) filter.status = req.query.status;

  const [runs, total] = await Promise.all([
    JobRun.find(filter)
      .populate({ path: 'triggeredBy', select: 'username', options: { withDeleted: true } })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit),
    JobRun.countDocuments(filter),
  ]);
  res.json({ runs, total, page, pages: Math.ceil(total / limit) });
});

module.exports = { getJobs, triggerJob, getJobRuns };
