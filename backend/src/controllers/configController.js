const settingsService = require('../services/settingsService');
const registry = require('../config/settingsRegistry');
const AdminAuditLog = require('../models/AdminAuditLog');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');

const requestContext = (req) => ({
  actor: req.user,
  ip: req.ip,
  userAgent: (req.headers['user-agent'] || '').slice(0, 300),
});

// GET /api/admin/config/registry — form metadata, no values.
const getRegistry = asyncHandler(async (req, res) => {
  res.json({
    sections: registry.sections(),
    settings: registry.all().map(registry.describe),
  });
});

// GET /api/admin/config?section=monetization.general
const getConfig = asyncHandler(async (req, res) => {
  const { section } = req.query;
  if (section && !registry.sections().includes(section)) {
    return res.status(404).json({ message: 'Unknown section' });
  }
  const settings = await settingsService.getForAdmin(section || null);
  res.json({ section: section || null, settings });
});

// PATCH /api/admin/config — partial update, all-or-nothing validation.
const updateConfig = asyncHandler(async (req, res) => {
  const patch = req.body && req.body.settings ? req.body.settings : req.body;
  try {
    const result = await settingsService.update(patch, {
      ...requestContext(req),
      note: (req.body && req.body.note) || '',
    });
    const settings = await settingsService.getForAdmin(req.body && req.body.section ? req.body.section : null);
    res.json({ ...result, settings });
  } catch (error) {
    if (error.status === 400 && error.errors) {
      return res.status(400).json({ message: error.message, errors: error.errors });
    }
    throw error;
  }
});

// POST /api/admin/config/reset  { keys: [...] }
const resetConfig = asyncHandler(async (req, res) => {
  const { keys } = req.body || {};
  if (!Array.isArray(keys) || !keys.length) {
    return res.status(400).json({ message: 'keys must be a non-empty array' });
  }
  const result = await settingsService.reset(keys, requestContext(req));
  res.json(result);
});

// POST /api/admin/config/preview-impact  { key, value }
// Read-only: shows what a change would do before it is committed.
const previewImpact = asyncHandler(async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ message: 'key is required' });
  res.json(await require('../services/impactService').preview(key, value));
});

// GET /api/admin/config/search?q=credit — powers the portal's settings search.
const searchConfig = asyncHandler(async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.json({ results: [] });
  }
  const snapshot = await settingsService.snapshot();
  const results = registry
    .searchIndex()
    .filter((entry) => entry.haystack.includes(query))
    .slice(0, 40)
    .map((entry) => {
      const def = registry.get(entry.key);
      return {
        key: entry.key,
        section: entry.section,
        label: entry.label,
        value: def.secret ? undefined : snapshot.get(entry.key),
      };
    });
  res.json({ results });
});

// GET /api/admin/config/audit
const getAuditLog = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.key) filter['changes.key'] = req.query.key;
  const [entries, total] = await Promise.all([
    AdminAuditLog.find(filter)
      .populate({ path: 'actor', select: 'username email', options: { withDeleted: true } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AdminAuditLog.countDocuments(filter),
  ]);
  res.json({ entries, total, page, pages: Math.ceil(total / limit) });
});

module.exports = {
  getRegistry,
  getConfig,
  updateConfig,
  resetConfig,
  searchConfig,
  getAuditLog,
  previewImpact,
};
