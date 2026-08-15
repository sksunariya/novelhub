// Slug safety for user-created spaces.
//
// `utils/slugify.js` is fine for admin-created novels, where the input is
// trusted. A space slug is chosen by any user, is permanent, and appears in
// every shared link — so it is an impersonation surface.
//
// THREE ATTACKS THIS BLOCKS:
//
//   1. Homoglyphs. `аdmin` with a Cyrillic а renders identically to `admin` in
//      most fonts. Someone registers it, posts as if official, and nobody sees
//      the difference. The slugify() regex above happens to strip non-ASCII, so
//      this codebase is accidentally safe today — but only accidentally, and
//      only for the character classes it happens to drop.
//   2. Confusables within ASCII. `rn` vs `m`, `l` vs `I` vs `1`, `0` vs `o`.
//      Not blockable outright — real words contain them — so these are detected
//      by comparing a skeleton form against existing slugs.
//   3. Reserved names. A space at `/c/admin` or `/c/settings` collides with
//      route names and reads as official.
//
// A slug cannot be changed after creation without breaking every link ever
// shared, so all of this has to happen at creation time.

const MIN_FALLBACK = 3;

// Characters that normalise to something visually identical. Applied before
// comparison, never to the stored slug — this produces a comparison key, not a
// display value.
// Includes the leetspeak substitutions, which are the most common form this
// takes in practice — `4dmin` and `m0d` are impersonation attempts, not
// stylistic choices.
const CONFUSABLE_MAP = {
  0: 'o', 1: 'l', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g',
  i: 'l', j: 'l', '|': 'l',
  vv: 'w', rn: 'm', cl: 'd', nn: 'm',
};

/**
 * Normalise to a comparison skeleton.
 *
 * `rn0dmin` and `modmin` and `m0dmin` all reduce to the same skeleton, so an
 * existence check on the skeleton catches a lookalike that an exact-match check
 * would miss. Stored alongside the slug, indexed, and checked at creation.
 */
const skeleton = (value) => {
  let out = String(value || '').toLowerCase();
  // Multi-character substitutions first — `rn` must become `m` before the
  // single-character pass turns the `n` into something else.
  for (const [from, to] of Object.entries(CONFUSABLE_MAP)) {
    if (from.length > 1) out = out.split(from).join(to);
  }
  out = [...out].map((ch) => CONFUSABLE_MAP[ch] || ch).join('');
  // Separators carry no visual weight in a skeleton comparison.
  return out.replace(/[-_.]/g, '');
};

/**
 * Is this string confined to a single writing system?
 *
 * Mixed-script strings are the classic homoglyph signature — legitimate names
 * are written in one script. A pure non-Latin slug would be fine linguistically,
 * but the slug charset below is ASCII-only anyway, so this is a belt-and-braces
 * check against a future charset widening.
 */
const isSingleScript = (value) => {
  const scripts = new Set();
  for (const ch of String(value || '')) {
    const code = ch.codePointAt(0);
    if (code < 0x30) continue; // punctuation and separators are script-neutral
    if (/[0-9-_]/.test(ch)) continue;
    if (code <= 0x24f) scripts.add('latin');
    else if (code >= 0x370 && code <= 0x3ff) scripts.add('greek');
    else if (code >= 0x400 && code <= 0x4ff) scripts.add('cyrillic');
    else if (code >= 0x590 && code <= 0x5ff) scripts.add('hebrew');
    else if (code >= 0x600 && code <= 0x6ff) scripts.add('arabic');
    else if (code >= 0x4e00 && code <= 0x9fff) scripts.add('han');
    else scripts.add('other');
  }
  return scripts.size <= 1;
};

/**
 * Normalise a candidate to the stored slug form.
 *
 * NFKC first, so full-width and other compatibility forms collapse to their
 * ASCII equivalents before the charset filter rather than being silently
 * dropped by it — `ａdmin` should become `admin`, not `dmin`.
 */
const normalizeSlug = (raw) =>
  String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Validate a candidate slug.
 *
 * Returns `{ ok, slug, skeleton, error }`. The error string is shown to the
 * user, so it says what to do rather than what went wrong internally.
 *
 * @param {string} raw
 * @param {object} options
 * @param {number} options.minLength
 * @param {number} options.maxLength
 * @param {string[]} options.reserved
 */
const validateSlug = (raw, { minLength = 3, maxLength = 24, reserved = [] } = {}) => {
  // NFKC first, THEN the script check. Full-width `ａdmin` is compatibility
  // Latin, not a second script — normalising first turns it into `admin` and
  // lets it be caught as reserved, which is the correct outcome. Checking
  // before normalising would reject it as "mixed alphabet", which is both
  // wrong and unhelpful.
  const original = String(raw || '').normalize('NFKC');

  if (!isSingleScript(original)) {
    return { ok: false, error: 'Use characters from a single alphabet' };
  }

  const slug = normalizeSlug(original);

  if (!slug) {
    return { ok: false, error: 'Use letters and numbers' };
  }
  if (slug.length < Math.max(minLength, MIN_FALLBACK)) {
    return { ok: false, error: `Must be at least ${Math.max(minLength, MIN_FALLBACK)} characters` };
  }
  if (slug.length > maxLength) {
    return { ok: false, error: `Must be ${maxLength} characters or fewer` };
  }
  // A purely numeric slug is indistinguishable from an ID in a URL and makes
  // future routing changes ambiguous.
  if (/^\d+$/.test(slug)) {
    return { ok: false, error: 'Must contain at least one letter' };
  }

  const skel = skeleton(slug);
  const reservedSkeletons = new Set(reserved.map(skeleton));

  if (reserved.includes(slug) || reservedSkeletons.has(skel)) {
    return { ok: false, error: 'That name is reserved' };
  }

  return { ok: true, slug, skeleton: skel };
};

/**
 * Would this slug be confusable with one that already exists?
 *
 * The caller supplies the lookup so this stays pure and testable, and so the
 * query can use the indexed `slugSkeleton` field rather than scanning.
 *
 * @param {string} skel
 * @param {function} existsBySkeleton  async (skeleton) => boolean
 */
const isConfusableWithExisting = async (skel, existsBySkeleton) => {
  if (typeof existsBySkeleton !== 'function') return false;
  return Boolean(await existsBySkeleton(skel));
};

/** Username variant. Same threat, shorter allowance, and `_` is conventional. */
const validateUsername = (raw, { minLength = 3, maxLength = 30, reserved = [] } = {}) => {
  const original = String(raw || '').normalize('NFKC');
  if (!isSingleScript(original)) {
    return { ok: false, error: 'Use characters from a single alphabet' };
  }
  const name = original
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');

  if (name.length < minLength) return { ok: false, error: `Must be at least ${minLength} characters` };
  if (name.length > maxLength) return { ok: false, error: `Must be ${maxLength} characters or fewer` };

  const skel = skeleton(name);
  if (reserved.map(skeleton).includes(skel)) return { ok: false, error: 'That name is reserved' };

  return { ok: true, username: name, skeleton: skel };
};

module.exports = {
  normalizeSlug,
  validateSlug,
  validateUsername,
  skeleton,
  isSingleScript,
  isConfusableWithExisting,
  CONFUSABLE_MAP,
};
