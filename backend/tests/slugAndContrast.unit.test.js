// Slug safety and colour contrast.
//
// Both guard a user-chosen value that becomes permanent and public: a slug
// appears in every shared link and cannot be changed without breaking them, and
// an accent colour is applied to every control inside a space.

const {
  validateSlug,
  validateUsername,
  normalizeSlug,
  skeleton,
  isSingleScript,
} = require('../src/utils/slugSafety');
const {
  validateAccent,
  contrastRatio,
  parseHex,
  lightenToRatio,
  SURFACES,
  AA_UI_COMPONENT,
} = require('../src/utils/colorContrast');

const RESERVED = ['admin', 'api', 'mod', 'settings', 'all', 'support', 'staff', 'help'];
const opts = { minLength: 3, maxLength: 24, reserved: RESERVED };

describe('slug — impersonation defence', () => {
  it('rejects an exact reserved word', () => {
    expect(validateSlug('admin', opts).error).toMatch(/reserved/);
  });

  it('rejects a Cyrillic homoglyph', () => {
    // `аdmin` with U+0430 renders identically to `admin` in most fonts.
    expect(validateSlug('аdmin', opts).ok).toBe(false);
  });

  it('normalises full-width Latin before judging it', () => {
    // Full-width is compatibility Latin, not a second script. NFKC turns it
    // into `admin`, which is then correctly caught as reserved — rejecting it
    // as "mixed alphabet" would be both wrong and unhelpful.
    expect(validateSlug('ａdmin', opts).error).toMatch(/reserved/);
  });

  it.each([
    ['4dmin', 'admin'],
    ['m0d', 'mod'],
    ['5upport', 'support'],
    ['5t4ff', 'staff'],
    ['rnod', 'mod'],
    ['he1p', 'help'],
  ])('rejects %s as confusable with %s', (candidate) => {
    expect(validateSlug(candidate, opts).error).toMatch(/reserved/);
  });

  it('gives confusable variants the same skeleton', () => {
    expect(skeleton('4dmin')).toBe(skeleton('admin'));
    expect(skeleton('rn0d')).toBe(skeleton('mod'));
    expect(skeleton('my-space')).toBe(skeleton('myspace'));
  });

  it('does not collapse genuinely different names', () => {
    expect(skeleton('cooking')).not.toBe(skeleton('coding'));
    expect(skeleton('gaming')).not.toBe(skeleton('gardening'));
  });

  it('rejects a mixed-script name', () => {
    expect(isSingleScript('adмin')).toBe(false);
    expect(isSingleScript('admin')).toBe(true);
    expect(isSingleScript('my-space-2')).toBe(true);
  });
});

describe('slug — shape', () => {
  it.each([
    ['my-space', 'my-space'],
    ['My Space', 'my-space'],
    ['my   space', 'my-space'],
    ['my_space', 'my-space'],
    ['--trim--', 'trim'],
    ['Café Chat', 'caf-chat'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });

  it('enforces the length bounds', () => {
    expect(validateSlug('ab', opts).error).toMatch(/at least/);
    expect(validateSlug('a'.repeat(30), opts).error).toMatch(/fewer/);
    expect(validateSlug('abc', opts).ok).toBe(true);
  });

  it('rejects a purely numeric slug', () => {
    // Indistinguishable from an ID in a URL, which makes future routing
    // changes ambiguous.
    expect(validateSlug('12345', opts).error).toMatch(/at least one letter/);
  });

  it('rejects input that normalises to nothing', () => {
    for (const bad of ['', '   ', '!!!', '---', null, undefined]) {
      expect(validateSlug(bad, opts).ok).toBe(false);
    }
  });

  it('accepts ordinary names', () => {
    for (const good of ['cooking', 'my-city', 'retro-games-2', 'book-club']) {
      const result = validateSlug(good, opts);
      expect(result.ok).toBe(true);
      expect(result.slug).toBe(good);
    }
  });
});

describe('username validation', () => {
  it('allows underscores, which slugs do not', () => {
    expect(validateUsername('cool_user').ok).toBe(true);
  });

  it('applies the same homoglyph defence', () => {
    expect(validateUsername('аdmin', { reserved: ['admin'] }).ok).toBe(false);
    expect(validateUsername('4dmin', { reserved: ['admin'] }).error).toMatch(/reserved/);
  });
});

describe('contrast — maths', () => {
  it('computes the known extremes', () => {
    // Black on white is the WCAG maximum of 21:1; a colour against itself is 1.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#dc2626', '#0a0507')).toBeCloseTo(contrastRatio('#0a0507', '#dc2626'), 6);
  });

  it('parses every hex form', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#DC2626')).toEqual({ r: 220, g: 38, b: 38 });
    expect(parseHex('rgb(1,2,3)')).toBeNull();
    expect(parseHex(null)).toBeNull();
  });
});

describe('contrast — accent validation', () => {
  it('checks against every surface the accent is drawn on', () => {
    const result = validateAccent('#dc2626');
    expect(result.ok).toBe(true);
    expect(Object.keys(result.ratios)).toEqual(
      expect.arrayContaining([...Object.keys(SURFACES), 'whiteText'])
    );
  });

  it('accepts the site default accent', () => {
    // If the shipped theme colour failed its own check, the check is wrong.
    expect(validateAccent('#dc2626').ok).toBe(true);
  });

  it('rejects a colour that disappears into the background', () => {
    // A space owner must not be able to create an unreadable page — under the
    // EAA that is the platform's liability, not theirs.
    const result = validateAccent('#0a0507');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too dark/);
    // The message must name the surface and the actual ratio, so the owner can
    // act on it rather than guessing.
    expect(result.error).toMatch(/contrast is/);
  });

  it.each(['#1a1a2e', '#111111', '#2d0a0a'])('rejects the too-dark accent %s', (color) => {
    expect(validateAccent(color).ok).toBe(false);
  });

  it('flags a light accent as needing dark label text rather than rejecting it', () => {
    // Yellow works fine as an outline or text colour; it just cannot carry
    // white label text.
    const result = validateAccent('#fbbf24');
    expect(result.ok).toBe(true);
    expect(result.prefersDarkText).toBe(true);
    expect(result.warning).toBeTruthy();
  });

  it('rejects a malformed colour', () => {
    for (const bad of ['red', 'rgb(1,2,3)', '#12345', '', null]) {
      expect(validateAccent(bad).ok).toBe(false);
    }
  });

  it('respects a stricter threshold', () => {
    const loose = validateAccent('#dc2626', { minRatio: 3 });
    const strict = validateAccent('#dc2626', { minRatio: 7 });
    expect(loose.ok).toBe(true);
    expect(strict.ok).toBe(false);
  });

  it('suggests a lighter alternative that actually passes', () => {
    const suggestion = lightenToRatio('#1a1a2e', AA_UI_COMPONENT);
    expect(contrastRatio(suggestion, SURFACES.background)).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
  });
});
