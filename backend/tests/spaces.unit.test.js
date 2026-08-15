const registry = require('../src/config/settingsRegistry');
const linkTypes = require('../src/config/linkTypes');
const { dynamicUpload, validateFiles } = require('../src/middlewares/dynamicUpload');
const constants = require('../src/config/constants');

const spaceDefs = () => registry.all().filter((def) => def.key.startsWith('spaces.'));

describe('spaces settings registry', () => {
  it('declares the full community surface', () => {
    expect(spaceDefs().length).toBeGreaterThan(100);
  });

  it('every default survives its own coercion and validation', () => {
    // The registry already asserts this at require time, but only for the
    // declared default. This re-runs it through the request path, which is
    // what an admin form actually hits.
    const failures = spaceDefs()
      .map((def) => ({ key: def.key, result: registry.coerceAndValidate(def.key, def.default) }))
      .filter((entry) => !entry.result.ok)
      .map((entry) => `${entry.key}: ${entry.result.error}`);

    expect(failures).toEqual([]);
  });

  it('does not collide with the legacy chapter-comment namespace', () => {
    // platform.js owns nine flat `community.*` keys for chapter comments and
    // reviews. They govern a different subsystem and must survive untouched.
    const legacy = registry.all().filter((def) => /^community\./.test(def.key));
    expect(legacy.map((def) => def.key)).toEqual(
      expect.arrayContaining([
        'community.bannedWords',
        'community.bannedWordAction',
        'community.reportsToAutoHide',
      ])
    );
    expect(legacy.every((def) => def.section === 'platform.community')).toBe(true);
  });

  it('exposes spaceOverridable through describe()', () => {
    const overridable = registry.all().filter((def) => def.spaceOverridable);
    expect(overridable.length).toBeGreaterThan(0);
    // Every overridable key must belong to the community, or a space owner
    // could change site-wide behaviour from their own settings page.
    expect(overridable.every((def) => def.key.startsWith('spaces.'))).toBe(true);
    expect(registry.describe(overridable[0]).spaceOverridable).toBe(true);
    expect(registry.describe(registry.get('spaces.enabled')).spaceOverridable).toBe(false);
  });

  it('ships with the community switched off', () => {
    // Phases can land in production before launch only if this stays false.
    expect(registry.get('spaces.enabled').default).toBe(false);
  });

  it('never exposes a secret through the public projection', () => {
    const publicSpaceKeys = registry.publicKeys().filter((key) => key.startsWith('spaces.'));
    expect(publicSpaceKeys.length).toBeGreaterThan(0);
    expect(publicSpaceKeys.some((key) => registry.get(key).secret)).toBe(false);
  });

  it('groups SECTIONS by module so short names cannot collide', () => {
    // platform.RANKING and spaces.RANKING, monetization.ANALYTICS and
    // spaces.ANALYTICS. A flat spread silently dropped one of each pair.
    expect(Object.keys(registry.SECTIONS).sort()).toEqual(['monetization', 'platform', 'spaces']);
    expect(registry.SECTIONS.platform.RANKING).toBe('platform.ranking');
    expect(registry.SECTIONS.spaces.RANKING).toBe('spaces.ranking');
    expect(registry.SECTIONS.monetization.ANALYTICS).toBe('monetization.analytics');
    expect(registry.SECTIONS.spaces.ANALYTICS).toBe('spaces.analytics');
  });

  it('caps every media limit so none can be set to unlimited', () => {
    const byteCaps = [
      'spaces.media.maxImageBytes',
      'spaces.media.maxGifBytes',
      'spaces.media.maxTotalPostBytes',
      'spaces.media.iconMaxBytes',
      'spaces.media.bannerMaxBytes',
      'spaces.media.avatarMaxBytes',
    ];
    for (const key of byteCaps) {
      const def = registry.get(key);
      expect(def).toBeTruthy();
      expect(def.min).toBeGreaterThan(0);
      expect(def.max).toBeGreaterThan(def.min);
    }
  });

  it('does not offer SVG as an allowed upload type', () => {
    // SVG can carry script and is an XSS vector when served from our origin.
    const def = registry.get('spaces.media.allowedMimeTypes');
    expect(def.options.map((option) => option.value)).not.toContain('image/svg+xml');
    expect(def.default).not.toContain('image/svg+xml');
  });
});

describe('link types', () => {
  it('registers the platform entities that exist today', () => {
    expect(linkTypes.keys()).toEqual(['novel', 'chapter']);
  });

  it('matches the enabled-types setting options', () => {
    const option = registry.get('spaces.links.enabledTypes').options.map((entry) => entry.value);
    expect(option.sort()).toEqual(linkTypes.keys().sort());
  });

  it('describes types without leaking functions across the wire', () => {
    const described = linkTypes.all().map(linkTypes.describe);
    for (const entry of described) {
      expect(Object.keys(entry).sort()).toEqual(['icon', 'key', 'label']);
      expect(typeof entry.key).toBe('string');
    }
  });

  it('returns nothing when linking is disabled site-wide', async () => {
    // spaces.links.enabledTypes = [] must remove linking entirely, not fall
    // back to every registered type.
    const refs = [{ type: 'novel', id: '507f1f77bcf86cd799439011' }];
    expect(await linkTypes.resolveMany(refs, { enabledTypes: [], max: 3 })).toEqual([]);
  });

  it('drops references to types the admin has not enabled', async () => {
    const refs = [{ type: 'chapter', id: '507f1f77bcf86cd799439011' }];
    expect(await linkTypes.resolveMany(refs, { enabledTypes: ['novel'], max: 3 })).toEqual([]);
  });

  it('handles malformed input without throwing', async () => {
    expect(await linkTypes.resolveMany(null, { enabledTypes: ['novel'] })).toEqual([]);
    expect(await linkTypes.resolveMany([], { enabledTypes: ['novel'] })).toEqual([]);
    expect(await linkTypes.resolve('nope', '507f1f77bcf86cd799439011')).toBeNull();
    expect(await linkTypes.resolve('novel', 'not-an-object-id')).toBeNull();
  });
});

describe('dynamic upload middleware', () => {
  it('builds an express middleware', () => {
    const middleware = dynamicUpload({ field: 'images', multiple: true });
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
    expect(typeof validateFiles).toBe('function');
  });

  it('passes through when there are no files to check', async () => {
    const next = jest.fn();
    await validateFiles({ files: [], mediaLimits: {} }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a file over the per-type cap with a message naming the limit', async () => {
    const next = jest.fn();
    await validateFiles(
      {
        files: [{ originalname: 'big.png', size: 9 * 1024 * 1024, mimetype: 'image/png' }],
        mediaLimits: { maxImageBytes: 5 * 1024 * 1024, maxGifBytes: 10 * 1024 * 1024 },
      },
      {},
      next
    );
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(413);
    expect(error.message).toContain('5.0 MB');
  });

  it('applies the larger GIF allowance to GIFs', async () => {
    const next = jest.fn();
    await validateFiles(
      {
        files: [{ originalname: 'anim.gif', size: 8 * 1024 * 1024, mimetype: 'image/gif' }],
        mediaLimits: { maxImageBytes: 5 * 1024 * 1024, maxGifBytes: 10 * 1024 * 1024 },
      },
      {},
      next
    );
    // Over the still-image cap, under the GIF cap: allowed.
    expect(next.mock.calls[0][0]).toBeFalsy();
  });

  it('enforces the total-bytes cap across a gallery', async () => {
    const next = jest.fn();
    await validateFiles(
      {
        files: Array.from({ length: 6 }, (_, i) => ({
          originalname: `p${i}.png`,
          size: 4 * 1024 * 1024,
          mimetype: 'image/png',
        })),
        mediaLimits: {
          maxImageBytes: 5 * 1024 * 1024,
          maxGifBytes: 10 * 1024 * 1024,
          maxTotalPostBytes: 20 * 1024 * 1024,
        },
      },
      {},
      next
    );
    const error = next.mock.calls[0][0];
    expect(error.status).toBe(413);
    expect(error.message).toContain('per post');
  });
});

describe('community constants', () => {
  it('lets post views reuse the existing deduplicated view tracking', () => {
    expect(constants.VIEW_TARGET_TYPES.POST).toBe('post');
  });

  it('separates the moderation removal state from author deletion', () => {
    // `removed` is a mod action and stays queryable; deletedAt is the author's
    // own delete. Collapsing them loses the distinction moderation depends on.
    expect(constants.POST_STATUS.REMOVED).toBe('removed');
    expect(constants.POST_STATUS.HIDDEN).toBe('hidden');
    expect(constants.POST_STATUS.PENDING).toBe('pending');
  });

  it('gives moderators granular permissions rather than one role flag', () => {
    expect(Object.keys(constants.MOD_PERMISSIONS).length).toBeGreaterThanOrEqual(6);
  });

  it('offers a step between active and banned for a space', () => {
    expect(constants.SPACE_STATUS.QUARANTINED).toBe('quarantined');
  });

  it('supports per-user overrides of the creation gate', () => {
    expect(Object.values(constants.SPACE_CREATION_POLICY).sort()).toEqual(
      ['always', 'default', 'never']
    );
    expect(Object.values(constants.SPACE_CREATION_MODES)).toContain('admin_only');
  });

  it('matches the creation mode setting options exactly', () => {
    const declared = registry.get('spaces.creation.mode').options.map((entry) => entry.value).sort();
    expect(declared).toEqual(Object.values(constants.SPACE_CREATION_MODES).sort());
  });
});
