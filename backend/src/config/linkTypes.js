// Linkable entity registry.
//
// The community is general-purpose: a space is about cooking, a city, a game,
// or nothing in particular. But a post SHOULD be able to point at something on
// the platform when that is what it is about.
//
// A hardcoded `linkedNovel` field would bake this platform's domain into a
// general forum and need a schema change for every future entity. Instead,
// `Post.linkedRefs` and `Space.linkedRefs` hold `{ type, id, url, label }` and
// `type` is a key from this file.
//
// Adding a linkable entity later — an author page, an event, a product — is one
// entry here. No schema change, no new UI, no migration. Which types are usable
// at all is the `spaces.links.enabledTypes` setting; emptying it removes
// linking from the product entirely.
//
// Each type declares:
//   key      identifier stored on the document
//   label    what the composer's picker calls it
//   model    Mongoose model name, for internal entities
//   icon     lucide-react icon name the frontend renders
//   search   (query, limit) -> documents, backs the composer's autocomplete
//   toLabel  document -> denormalized display text stored on the ref, so
//            rendering a feed needs no join
//   href     document -> canonical path on this site
//   exists   id -> boolean, validates a ref before it is saved

const TYPES = [
  {
    key: 'novel',
    label: 'Novel',
    model: 'Novel',
    icon: 'BookOpen',
    search: async (query, limit = 10) => {
      const Novel = require('../models/Novel');
      const filter = query
        ? { title: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        : {};
      return Novel.find(filter).select('title slug coverUrl').limit(limit).lean();
    },
    toLabel: (doc) => doc.title,
    href: (doc) => `/novel/${doc.slug}`,
    thumb: (doc) => doc.coverUrl || '',
  },
  {
    key: 'chapter',
    label: 'Chapter',
    model: 'Chapter',
    icon: 'FileText',
    search: async (query, limit = 10) => {
      const Chapter = require('../models/Chapter');
      const filter = query
        ? { title: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        : {};
      return Chapter.find(filter)
        .select('title number novel')
        .populate('novel', 'title slug')
        .limit(limit)
        .lean();
    },
    toLabel: (doc) => `${doc.novel ? `${doc.novel.title} — ` : ''}Ch. ${doc.number}: ${doc.title}`,
    href: (doc) => (doc.novel ? `/novel/${doc.novel.slug}/chapter/${doc.number}` : ''),
    thumb: () => '',
  },
];

const byKey = new Map();
for (const type of TYPES) {
  if (byKey.has(type.key)) throw new Error(`Duplicate link type: ${type.key}`);
  byKey.set(type.key, type);
}

const get = (key) => byKey.get(key) || null;

const has = (key) => byKey.has(key);

const all = () => TYPES;

const keys = () => [...byKey.keys()];

/** Metadata the composer's entity picker renders from. No functions cross the wire. */
const describe = (type) => ({
  key: type.key,
  label: type.label,
  icon: type.icon,
});

/**
 * Confirm a reference points at something that exists, and return the label to
 * denormalize onto the ref. Returns null when the target is gone, so a post can
 * never be saved pointing at a deleted entity.
 */
const resolve = async (key, id) => {
  const type = get(key);
  if (!type) return null;
  const mongoose = require('mongoose');
  if (!mongoose.isValidObjectId(id)) return null;

  const Model = mongoose.model(type.model);
  const query = Model.findById(id);
  // Chapter labels read through to the parent novel for a useful display string.
  if (type.key === 'chapter') query.populate('novel', 'title slug');
  const doc = await query.lean();
  if (!doc) return null;

  return {
    type: type.key,
    id: doc._id,
    label: type.toLabel(doc),
    url: type.href(doc),
    thumb: type.thumb ? type.thumb(doc) : '',
  };
};

/**
 * Validate and normalize an incoming array of refs against the admin's enabled
 * list. Unknown, disabled and dangling references are dropped rather than
 * erroring — a stale picker selection should not fail an otherwise good post.
 */
const resolveMany = async (refs, { enabledTypes = [], max = 3 } = {}) => {
  if (!Array.isArray(refs) || !refs.length || !enabledTypes.length) return [];
  const allowed = new Set(enabledTypes);
  const seen = new Set();
  const out = [];

  for (const ref of refs.slice(0, max * 2)) {
    if (out.length >= max) break;
    if (!ref || !allowed.has(ref.type)) continue;
    const dedupeKey = `${ref.type}:${ref.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const resolved = await resolve(ref.type, ref.id);
    if (resolved) out.push(resolved);
  }
  return out;
};

module.exports = { get, has, all, keys, describe, resolve, resolveMany };
