const SpotlightRail = require('../models/SpotlightRail');
const AdminAuditLog = require('../models/AdminAuditLog');
const spotlightService = require('../services/spotlightService');
const spotlightTypes = require('../config/spotlightTypes');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');

// Homepage curation.
//
// The public half serves one composed payload; the admin half is CRUD over the
// rails plus the entity picker that fills them.
//
// Curating is a PUBLISHING act, not a moderation one: the `spotlight` module
// decides who may put something on the front page, and it does not confer any
// authority over the thing itself. An admin who can feature a space still
// cannot ban it. What stops that from becoming a loophole is that featuring
// only ever surfaces content that is already public — enforced in
// spotlightService, at read time, for every item on every request.

/** Admin writes here are rare, consequential and visible to everyone. Log them. */
const audit = (req, { action, entityId, changes = [], note = '' }) =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email || '',
    action: `spotlight.${action}`,
    entity: 'spotlight_rail',
    entityId: String(entityId),
    changes,
    note,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  }).catch((error) => {
    // A failed audit write must not fail the action it describes.
    console.error('spotlight: audit write failed:', error.message);
  });

// ------------------------------------------------------------------ public

/**
 * GET /api/spotlight
 *
 * The entire homepage below the hero, in one request. One request rather than
 * one per section: the old homepage fired six parallel calls from the browser
 * and rendered whichever arrived first, so the page reflowed as it loaded and
 * the order depended on the network.
 */
const getSpotlight = asyncHandler(async (req, res) => {
  const settings = await settingsService.snapshot();
  const payload = await spotlightService.resolve({ viewer: req.user || null, settings });

  // Short shared-cache lifetime. The payload varies by viewer once someone is
  // signed in — vote state, poll answers, audience — so it is private then.
  res.set('Cache-Control', req.user ? 'private, no-store' : 'public, max-age=30');
  return res.json(payload);
});

// ------------------------------------------------------------------- admin

const listRails = asyncHandler(async (req, res) => {
  const rails = await SpotlightRail.find().sort({ order: 1, createdAt: 1 }).lean();
  return res.json({ rails });
});

/** Registry metadata the admin picker renders from. No functions cross the wire. */
const getTypes = asyncHandler(async (req, res) =>
  res.json({ types: spotlightTypes.all().map(spotlightTypes.describe) })
);

/**
 * GET /api/admin/spotlight/search?type=&q=
 *
 * Backs the picker's autocomplete. Every type searches through its own registry
 * entry, so this endpoint never learns what a novel or a space is.
 */
const searchEntities = asyncHandler(async (req, res) => {
  const { type, q = '' } = req.query;
  if (!spotlightTypes.has(type)) return res.status(400).json({ message: 'Unknown type' });
  const results = await spotlightTypes.searchType(type, q, 12);
  return res.json({ results });
});

/**
 * GET /api/admin/spotlight/preview
 *
 * What the homepage will actually look like, resolved through exactly the same
 * service the public endpoint uses. A preview built from a second code path is
 * a preview of something that does not exist.
 *
 * `as` picks the audience to preview: an admin needs to see the anonymous
 * homepage, which is the one they never otherwise get.
 */
const previewSpotlight = asyncHandler(async (req, res) => {
  const settings = await settingsService.snapshot();
  const viewer = req.query.as === 'anon' ? null : req.user;
  const payload = await spotlightService.resolve({ viewer, settings });
  return res.json(payload);
});

const WRITABLE = [
  'title', 'subtitle', 'icon', 'accent', 'layout', 'source', 'items', 'query',
  'audience', 'startAt', 'endAt', 'isActive', 'maxItems', 'viewAllUrl', 'viewAllLabel',
];

/** Stamp who pinned what, so a rail's history survives the person who made it. */
const stampItems = (items, actorId) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    type: item.type,
    refId: item.refId || null,
    label: item.label || '',
    thumb: item.thumb || '',
    url: item.url || '',
    note: item.note || '',
    badge: item.badge || '',
    order: item.order === undefined ? index : item.order,
    pinnedAt: item.pinnedAt || new Date(),
    pinnedBy: item.pinnedBy || actorId,
  }));

const createRail = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.title) return res.status(400).json({ message: 'A title is required' });

  const key = String(body.key || body.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!key) return res.status(400).json({ message: 'Could not derive a key from that title' });

  if (await SpotlightRail.findOne({ key })) {
    return res.status(409).json({ message: 'A rail with that key already exists' });
  }

  const last = await SpotlightRail.findOne().sort({ order: -1 }).select('order');

  const rail = await SpotlightRail.create({
    ...Object.fromEntries(Object.entries(body).filter(([k]) => WRITABLE.includes(k))),
    key,
    items: stampItems(body.items, req.user._id),
    order: last ? last.order + 1 : 0,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await audit(req, { action: 'create', entityId: rail._id, note: rail.title });
  return res.status(201).json({ rail });
});

const updateRail = asyncHandler(async (req, res) => {
  const rail = await SpotlightRail.findById(req.params.id);
  if (!rail) return res.status(404).json({ message: 'Rail not found' });

  const body = req.body || {};
  const changes = [];
  for (const field of WRITABLE) {
    if (body[field] === undefined) continue;
    const next = field === 'items' ? stampItems(body.items, req.user._id) : body[field];
    // Items and query are arrays and subdocuments; diffing them field by field
    // in the audit log would be noise. Record that they changed and how much.
    if (field === 'items') {
      changes.push({ key: 'items', before: rail.items.length, after: next.length });
    } else if (field === 'query') {
      changes.push({ key: 'query', before: 'changed', after: next.kind || '' });
    } else if (String(rail[field]) !== String(next)) {
      changes.push({ key: field, before: rail[field], after: next });
    }
    rail[field] = next;
  }
  rail.updatedBy = req.user._id;
  await rail.save();

  if (changes.length) await audit(req, { action: 'update', entityId: rail._id, changes, note: rail.title });
  return res.json({ rail });
});

/**
 * Reorder in one call.
 *
 * Saving each rail's position separately would leave the homepage in a
 * half-reordered state if the browser closed mid-drag.
 */
const reorderRails = asyncHandler(async (req, res) => {
  const { railIds } = req.body || {};
  if (!Array.isArray(railIds)) return res.status(400).json({ message: 'railIds must be an array' });

  await SpotlightRail.bulkWrite(
    railIds.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: index, updatedBy: req.user._id } } },
    }))
  );

  await audit(req, { action: 'reorder', entityId: 'all', note: `${railIds.length} rails` });
  return res.json({ message: 'Reordered' });
});

const deleteRail = asyncHandler(async (req, res) => {
  const rail = await SpotlightRail.findById(req.params.id);
  if (!rail) return res.status(404).json({ message: 'Rail not found' });

  await SpotlightRail.deleteOne({ _id: rail._id });
  await audit(req, { action: 'delete', entityId: rail._id, note: rail.title });
  return res.json({ message: 'Rail deleted' });
});

module.exports = {
  getSpotlight,
  listRails,
  getTypes,
  searchEntities,
  previewSpotlight,
  createRail,
  updateRail,
  reorderRails,
  deleteRail,
};
