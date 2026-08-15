const settingsService = require('../services/settingsService');
const registry = require('../config/settingsRegistry');
const AdminAuditLog = require('../models/AdminAuditLog');
const moduleAccess = require('../services/moduleAccessService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');
const { CONFIG_PREFIX_MODULES } = require('../config/constants');

const requestContext = (req) => ({
  actor: req.user,
  ip: req.ip,
  userAgent: (req.headers['user-agent'] || '').slice(0, 300),
});

// --- module scoping -------------------------------------------------------
//
// The settings registry is one screen covering three domains — platform.*,
// monetization.* and spaces.* — so a single guard on /admin/config would make
// "hide monetization settings" also hide auth, ranking and community rules.
// Each request is filtered to the sections the caller's modules cover instead.
//
// Filtering rather than refusing matters on the collection reads: an admin with
// two of the three modules should see two thirds of the screen, not a 404.

/** Section prefix ("monetization.pricing" -> "monetization"). */
const prefixOf = (section) => String(section || '').split('.')[0];

const canTouchSection = (user, section) => {
  const moduleId = CONFIG_PREFIX_MODULES[prefixOf(section)];
  // A section belonging to no module is unclassified; treat it as platform
  // configuration rather than leaving it ungoverned.
  if (!moduleId) return moduleAccess.hasCapability(user, 'platform_config');
  return moduleAccess.hasCapability(user, moduleId);
};

const allowedSections = (user) => registry.sections().filter((section) => canTouchSection(user, section));

/** Keys whose section the caller may not touch. */
const forbiddenKeys = (user, keys) =>
  keys.filter((key) => {
    const def = registry.get(key);
    // Unknown keys are left to the service's own validation, which reports them
    // better than a permission error would.
    return def && !canTouchSection(user, def.section);
  });

/**
 * Trim a settings payload to the caller's sections.
 *
 * Every path that returns settings has to go through this, not just the read
 * endpoint — settingsService.update() answers with the FULL registry, so a
 * restricted admin patching one platform setting would otherwise be handed
 * every monetization value in the response to their own write.
 */
const visibleSettings = (user, settings) => {
  if (!Array.isArray(settings)) return settings;
  const allowed = new Set(allowedSections(user));
  return settings.filter((entry) => allowed.has(entry.section));
};

// GET /api/admin/config/registry — form metadata, no values.
const getRegistry = asyncHandler(async (req, res) => {
  const sections = allowedSections(req.user);
  const allowed = new Set(sections);
  res.json({
    sections,
    settings: registry
      .all()
      .filter((def) => allowed.has(def.section))
      .map(registry.describe),
  });
});

// GET /api/admin/config?section=monetization.general
const getConfig = asyncHandler(async (req, res) => {
  const { section } = req.query;
  if (section && !registry.sections().includes(section)) {
    return res.status(404).json({ message: 'Unknown section' });
  }
  // 404, not 403: a section this admin has no module for should look like it
  // does not exist, matching how the portal's route guards behave.
  if (section && !canTouchSection(req.user, section)) {
    return res.status(404).json({ message: 'Unknown section' });
  }

  const settings = await settingsService.getForAdmin(section || null);
  // A named section was already checked above; the whole-registry read is
  // trimmed to what they hold.
  res.json({ section: section || null, settings: section ? settings : visibleSettings(req.user, settings) });
});

// PATCH /api/admin/config — partial update, all-or-nothing validation.
const updateConfig = asyncHandler(async (req, res) => {
  const patch = req.body && req.body.settings ? req.body.settings : req.body;

  const denied = forbiddenKeys(req.user, Object.keys(patch || {}));
  if (denied.length) {
    return res.status(403).json({
      message: 'Some of those settings are outside the sections you have access to',
      keys: denied,
    });
  }

  try {
    const result = await settingsService.update(patch, {
      ...requestContext(req),
      note: (req.body && req.body.note) || '',
    });
    const section = (req.body && req.body.section) || null;
    const settings = await settingsService.getForAdmin(section);
    // `result` carries its own unfiltered `settings` on the no-op path, so the
    // filtered copy must come last and win.
    res.json({ ...result, settings: section ? settings : visibleSettings(req.user, settings) });
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
  const denied = forbiddenKeys(req.user, keys);
  if (denied.length) {
    return res.status(403).json({
      message: 'Some of those settings are outside the sections you have access to',
      keys: denied,
    });
  }
  const result = await settingsService.reset(keys, requestContext(req));
  res.json(result);
});

// POST /api/admin/config/preview-impact  { key, value }
// Read-only: shows what a change would do before it is committed.
const previewImpact = asyncHandler(async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ message: 'key is required' });
  if (forbiddenKeys(req.user, [key]).length) {
    return res.status(404).json({ message: 'Unknown setting' });
  }
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
    // Filtered before the slice, so a restricted admin gets 40 results they can
    // act on rather than 40 slots mostly filled by settings they cannot see.
    .filter((entry) => canTouchSection(req.user, entry.section))
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
//
// The only reader of the audit log, so scoping happens here or nowhere.
//
// Two things are withheld from an ordinary admin. Governance records —
// `admin_access.*` — are the superadmin's decisions about who may see what,
// including decisions about the person reading; showing an admin the log entry
// that restricted them, and the entries restricting their colleagues, hands
// over the whole permission map. And settings changes are trimmed to the
// sections the reader holds, so the log cannot be used to read values the
// settings screen itself would refuse them.
const GOVERNANCE_ACTION_PREFIX = 'admin_access.';

const getAuditLog = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const isSuper = moduleAccess.isSuperAdmin(req.user);

  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.key) filter['changes.key'] = req.query.key;
  if (!isSuper) {
    filter.action = filter.action
      ? // A caller asking explicitly for a governance action gets nothing,
        // rather than getting it because they named it.
        { $in: [filter.action].filter((action) => !action.startsWith(GOVERNANCE_ACTION_PREFIX)) }
      : { $not: new RegExp(`^${GOVERNANCE_ACTION_PREFIX}`) };
  }

  const [rows, total] = await Promise.all([
    AdminAuditLog.find(filter)
      .populate({ path: 'actor', select: 'username email', options: { withDeleted: true } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AdminAuditLog.countDocuments(filter),
  ]);

  if (isSuper) {
    return res.json({ entries: rows, total, page, pages: Math.ceil(total / limit) });
  }

  // Redact individual changed keys outside the reader's sections. An entry left
  // with nothing visible is dropped: it would otherwise announce that a change
  // happened somewhere they cannot look.
  const entries = rows
    .map((row) => {
      const changes = (row.changes || []).filter(
        (change) => !registry.get(change.key) || !forbiddenKeys(req.user, [change.key]).length
      );
      if (!changes.length && (row.changes || []).length) return null;
      return { ...row.toObject(), changes };
    })
    .filter(Boolean);

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
