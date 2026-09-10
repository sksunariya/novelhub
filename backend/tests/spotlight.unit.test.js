const spotlightTypes = require('../src/config/spotlightTypes');
const spotlight = require('../src/services/spotlightService');
const SpotlightRail = require('../src/models/SpotlightRail');
const registry = require('../src/config/settingsRegistry');
const cacheService = require('../src/services/cacheService');
const { ADMIN_MODULES } = require('../src/config/constants');

const oid = (hex) => require('mongoose').Types.ObjectId.createFromHexString(hex.padStart(24, '0'));

// ---------------------------------------------------------------- registry

describe('spotlight type registry', () => {
  it('every type declares the full contract', () => {
    for (const type of spotlightTypes.all()) {
      expect(typeof type.search).toBe('function');
      expect(typeof type.loadMany).toBe('function');
      expect(typeof type.isPublishable).toBe('function');
      expect(typeof type.card).toBe('function');
      expect(type.label).toBeTruthy();
    }
  });

  it('describe() sends no functions over the wire', () => {
    for (const type of spotlightTypes.all()) {
      const described = spotlightTypes.describe(type);
      expect(Object.values(described).every((v) => typeof v !== 'function')).toBe(true);
      expect(described).toHaveProperty('key');
      expect(described).toHaveProperty('icon');
    }
  });
});

// The guard that matters: what an admin pinned is not necessarily what may be
// shown today. Each case here is a state a thing can enter AFTER being pinned.
describe('isPublishable — re-checked at read time', () => {
  const novel = spotlightTypes.get('novel');
  const space = spotlightTypes.get('space');
  const post = spotlightTypes.get('post');

  it('refuses an unpublished novel', () => {
    expect(novel.isPublishable({ published: true })).toBe(true);
    expect(novel.isPublishable({ published: false })).toBe(false);
    expect(novel.isPublishable({ published: true, deletedAt: new Date() })).toBe(false);
  });

  it('refuses a space that is not active and public', () => {
    const live = { status: 'active', visibility: 'public' };
    expect(space.isPublishable(live)).toBe(true);
    expect(space.isPublishable({ ...live, status: 'quarantined' })).toBe(false);
    expect(space.isPublishable({ ...live, status: 'banned' })).toBe(false);
    expect(space.isPublishable({ ...live, status: 'archived' })).toBe(false);
    expect(space.isPublishable({ ...live, visibility: 'private' })).toBe(false);
    expect(space.isPublishable({ ...live, excludeFromAll: true })).toBe(false);
    expect(space.isPublishable({ ...live, deletedAt: new Date() })).toBe(false);
  });

  it('refuses a post that is removed, OR whose space has been taken down', () => {
    const healthySpace = { status: 'active', visibility: 'public' };
    expect(post.isPublishable({ status: 'published', space: healthySpace })).toBe(true);
    expect(post.isPublishable({ status: 'removed', space: healthySpace })).toBe(false);
    expect(post.isPublishable({ status: 'hidden', space: healthySpace })).toBe(false);
    // The case a write-time-only check misses entirely: the post is fine, the
    // space it lives in is not.
    expect(post.isPublishable({
      status: 'published', space: { status: 'quarantined', visibility: 'public' },
    })).toBe(false);
    expect(post.isPublishable({
      status: 'published', space: { status: 'active', visibility: 'private' },
    })).toBe(false);
    expect(post.isPublishable({ status: 'published', space: null })).toBe(false);
  });

  it('refuses a chapter whose novel is unpublished', () => {
    const chapter = spotlightTypes.get('chapter');
    expect(chapter.isPublishable({ novel: { published: true } })).toBe(true);
    expect(chapter.isPublishable({ novel: { published: false } })).toBe(false);
    expect(chapter.isPublishable({ novel: null })).toBe(false);
  });
});

describe('card serialization is a whitelist', () => {
  it('a post card carries no moderator-private field', () => {
    const card = spotlightTypes.get('post').card({
      _id: oid('1'), title: 'T', type: 'text', body: '<p>hello <b>there</b></p>',
      space: { _id: oid('2'), slug: 's', name: 'S' },
      author: { _id: oid('3'), username: 'u' },
      removal: { note: 'MODERATOR PRIVATE NOTE', reason: 'spam', by: oid('4') },
      reportCount: 12, hotScore: 99, bestScore: 5,
    }, {});
    const json = JSON.stringify(card);
    expect(json).not.toContain('MODERATOR PRIVATE');
    expect(json).not.toContain('reportCount');
    expect(json).not.toContain('hotScore');
    // The blurb is stripped of markup, not raw HTML re-sent under a new name.
    expect(card.entity.blurb).toBe('hello there');
  });

  it('a poll is handed on raw for the resolver to shape, never pre-serialized', () => {
    // hideResultsUntilEnd has to strip tallies from the RESPONSE. Serializing
    // here — before anyone knows who is looking — is how they leak.
    const withPoll = spotlightTypes.get('post').card({
      _id: oid('1'), title: 'T', type: 'poll',
      space: { _id: oid('2'), slug: 's', name: 'S' },
      poll: { options: [{ _id: oid('9'), text: 'a', votes: 3 }], hideResultsUntilEnd: true },
    }, {});
    expect(withPoll.entity.rawPoll).toBeDefined();
    expect(withPoll.entity.poll).toBeUndefined();
  });

  it('a custom card is built entirely from the admin item', () => {
    const card = spotlightTypes.get('custom').card(null, {
      label: 'Summer event', note: 'Ends Sunday', thumb: '/i.png', url: '/events',
    });
    expect(card.title).toBe('Summer event');
    expect(card.href).toBe('/events');
    expect(card.entity).toBeNull();
  });

  it('links point at the real routes', () => {
    expect(spotlightTypes.get('space').card({ _id: oid('1'), slug: 'cooking' }, {}).href)
      .toBe('/c/cooking');
    expect(spotlightTypes.get('novel').card({ _id: oid('1'), slug: 'ashfall' }, {}).href)
      .toBe('/novel/ashfall');
    expect(spotlightTypes.get('post').card({
      _id: oid('7'), title: 'T', space: { _id: oid('2'), slug: 'cooking' }, titleSlug: 'the-post',
    }, {}).href).toBe('/c/cooking/p/000000000000000000000007/the-post');
  });
});

// ---------------------------------------------------------------- audience

describe('audience targeting', () => {
  const anon = { authed: false, isMember: false };
  const lurker = { authed: true, isMember: false };
  const member = { authed: true, isMember: true };
  const forAudience = (audience) => ({ audience });

  it.each([
    ['all', true, true, true],
    ['anon', true, false, false],
    ['authed', false, true, true],
    ['members', false, false, true],
    ['non_members', false, true, false],
  ])('%s', (audience, expectAnon, expectLurker, expectMember) => {
    expect(spotlight.audienceMatches(forAudience(audience), anon)).toBe(expectAnon);
    expect(spotlight.audienceMatches(forAudience(audience), lurker)).toBe(expectLurker);
    expect(spotlight.audienceMatches(forAudience(audience), member)).toBe(expectMember);
  });

  it('an unknown audience shows to everyone rather than to nobody', () => {
    // A rail that silently vanishes is harder to diagnose than one that is too
    // visible, and this is only reachable through a stale document.
    expect(spotlight.audienceMatches({ audience: 'martians' }, anon)).toBe(true);
  });

  it('membership is not looked up unless some rail needs it', async () => {
    const ctx = await spotlight.viewerContext({ _id: oid('1') }, { needsMembership: false });
    expect(ctx).toEqual({ authed: true, isMember: false });
    expect(await spotlight.viewerContext(null)).toEqual({ authed: false, isMember: false });
  });
});

// ------------------------------------------------------------ manual rails

describe('resolveManual', () => {
  const novelType = spotlightTypes.get('novel');
  const spaceType = spotlightTypes.get('space');
  let loadCalls;

  const stub = (docsByType) => {
    loadCalls = [];
    jest.spyOn(spotlightTypes, 'get').mockImplementation((key) => {
      const real = key === 'novel' ? novelType : key === 'space' ? spaceType
        : key === 'custom' ? { ...spotlightTypes.all().find((t) => t.key === 'custom') } : null;
      if (!real) return null;
      if (real.standalone) return real;
      return {
        ...real,
        loadMany: async (ids) => {
          loadCalls.push({ type: key, ids: ids.map(String) });
          return (docsByType[key] || []).filter((doc) => ids.map(String).includes(String(doc._id)));
        },
      };
    });
  };

  afterEach(() => jest.restoreAllMocks());

  const NOVELS = [
    { _id: oid('a1'), title: 'First', slug: 'first', published: true },
    { _id: oid('a2'), title: 'Second', slug: 'second', published: true },
    { _id: oid('a3'), title: 'Pulled', slug: 'pulled', published: false },
  ];
  const SPACES = [
    { _id: oid('b1'), name: 'Kitchen', slug: 'kitchen', status: 'active', visibility: 'public' },
    { _id: oid('b2'), name: 'Banned', slug: 'banned', status: 'quarantined', visibility: 'public' },
  ];

  it('loads one batch per type, not one per item — the N+1 guard', async () => {
    stub({ novel: NOVELS, space: SPACES });
    await spotlight.resolveManual({
      maxItems: 12,
      items: [
        { type: 'novel', refId: NOVELS[0]._id, order: 0 },
        { type: 'space', refId: SPACES[0]._id, order: 1 },
        { type: 'novel', refId: NOVELS[1]._id, order: 2 },
      ],
    });
    // Three items, two types, two queries. The day this scales with the item
    // count an N+1 has been introduced into the busiest page on the site.
    expect(loadCalls).toHaveLength(2);
    expect(loadCalls.find((c) => c.type === 'novel').ids).toHaveLength(2);
  });

  it("keeps the admin's order, not the database's", async () => {
    stub({ novel: NOVELS });
    const cards = await spotlight.resolveManual({
      maxItems: 12,
      items: [
        { type: 'novel', refId: NOVELS[1]._id, order: 0 },
        { type: 'novel', refId: NOVELS[0]._id, order: 1 },
      ],
    });
    expect(cards.map((c) => c.title)).toEqual(['Second', 'First']);
  });

  it('drops a pin whose target is gone, without failing the rail', async () => {
    stub({ novel: NOVELS });
    const cards = await spotlight.resolveManual({
      maxItems: 12,
      items: [
        { type: 'novel', refId: NOVELS[0]._id, order: 0 },
        { type: 'novel', refId: oid('dead'), order: 1 },
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('First');
  });

  it('drops a pin whose target is no longer publishable', async () => {
    stub({ novel: NOVELS, space: SPACES });
    const cards = await spotlight.resolveManual({
      maxItems: 12,
      items: [
        { type: 'novel', refId: NOVELS[2]._id, order: 0 }, // unpublished since pinning
        { type: 'space', refId: SPACES[1]._id, order: 1 }, // quarantined since pinning
        { type: 'novel', refId: NOVELS[0]._id, order: 2 },
      ],
    });
    expect(cards.map((c) => c.title)).toEqual(['First']);
  });

  it('honours maxItems before doing any work', async () => {
    stub({ novel: NOVELS });
    await spotlight.resolveManual({
      maxItems: 1,
      items: [
        { type: 'novel', refId: NOVELS[0]._id, order: 0 },
        { type: 'novel', refId: NOVELS[1]._id, order: 1 },
      ],
    });
    expect(loadCalls[0].ids).toHaveLength(1);
  });

  it('renders a standalone custom card with no query at all', async () => {
    stub({});
    const cards = await spotlight.resolveManual({
      maxItems: 12,
      items: [{ type: 'custom', label: 'Notice', url: '/x', note: 'read me', order: 0 }],
    });
    expect(loadCalls).toHaveLength(0);
    expect(cards[0].title).toBe('Notice');
    expect(cards[0].note).toBe('read me');
  });
});

describe('toCard', () => {
  it("lets the curator's overlay ride on top of the entity's own text", () => {
    const card = spotlight.toCard(spotlightTypes.get('novel'),
      { _id: oid('1'), title: 'Ashfall', slug: 'ashfall', author: 'K' },
      { note: 'Finale drops Friday', badge: 'ENDING SOON' });
    expect(card.title).toBe('Ashfall');       // the entity still owns its name
    expect(card.note).toBe('Finale drops Friday');
    expect(card.badge).toBe('ENDING SOON');
  });
});

// ------------------------------------------------------------- the model

describe('SpotlightRail', () => {
  it('is live only inside its schedule window', () => {
    const rail = new SpotlightRail({ key: 'k', title: 'T', isActive: true });
    const now = new Date('2026-06-15T12:00:00Z');
    expect(rail.isScheduledNow(now)).toBe(true);

    rail.startAt = new Date('2026-07-01T00:00:00Z');
    expect(rail.isScheduledNow(now)).toBe(false);

    rail.startAt = new Date('2026-06-01T00:00:00Z');
    rail.endAt = new Date('2026-06-10T00:00:00Z');
    expect(rail.isScheduledNow(now)).toBe(false);

    rail.endAt = new Date('2026-06-30T00:00:00Z');
    expect(rail.isScheduledNow(now)).toBe(true);

    rail.isActive = false;
    expect(rail.isScheduledNow(now)).toBe(false);
  });

  it('strips items whose type has left the registry', () => {
    const rail = new SpotlightRail({
      key: 'k', title: 'T',
      items: [
        { type: 'novel', refId: oid('1') },
        { type: 'wormhole', refId: oid('2') },
      ],
    });
    // The pre-save hook runs through validate/save; invoke it directly since
    // this suite never touches a database.
    rail.$__.validationError = undefined;
    const hook = SpotlightRail.schema.s.hooks._pres.get('save').find((h) => h.fn.name === 'dropUnknownTypes');
    hook.fn.call(rail, () => {});
    expect(rail.items.map((i) => i.type)).toEqual(['novel']);
  });
});

// ------------------------------------------------------------ integration

describe('wiring', () => {
  it('registers the spotlight admin module so the route guard has something to check', () => {
    const module = ADMIN_MODULES.find((m) => m.id === 'spotlight');
    expect(module).toBeDefined();
    expect(module.group).toBe('content');
    expect(module.alwaysOn).toBeFalsy();
    expect(module.superOnly).toBeFalsy();
  });

  it('declares its settings, and every default passes its own validation', () => {
    const keys = registry.all().filter((def) => def.section === 'platform.homepage');
    expect(keys.length).toBeGreaterThan(0);
    const failures = keys
      .map((def) => ({ key: def.key, result: registry.coerceAndValidate(def.key, def.default) }))
      .filter((entry) => !entry.result.ok);
    expect(failures).toEqual([]);
  });
});

// ------------------------------------------------------- full composition
//
// The pieces above are correct in isolation; this exercises resolve() itself —
// schedule window, audience filter, the rail cap, and the rule that an empty
// rail is dropped while a pulse rail is kept.

describe('resolve()', () => {
  const novelType = spotlightTypes.get('novel');
  const NOVELS = [{ _id: oid('a1'), title: 'First', slug: 'first', published: true }];

  // Mirrors the real snapshot, which throws on a key the registry does not
  // define. A stub that answered `undefined` instead is what let
  // `platform.homepage.maxRails` through this suite: the section is
  // `platform.homepage`, but the key is `homepage.maxRails`, and the code and
  // the stub agreed on a name that does not exist. Tests passed; production
  // 500'd, and the one read that did not 500 — the rail cap — degraded to
  // `.slice(0, undefined)`, which returns every rail.
  const STUBBED = {
    'homepage.cacheSeconds': 0, // uncached, so each test starts clean
    'homepage.maxRails': 12,
    'homepage.pulseEnabled': false,
    'spaces.enabled': false,
  };
  const settings = (overrides = {}) => {
    const values = { ...STUBBED, ...overrides };
    return {
      get: (key) => {
        if (!registry.has(key)) throw new Error(`Unknown setting: ${key}`);
        if (!(key in values)) throw new Error(`Test stub has no value for ${key}`);
        return values[key];
      },
    };
  };

  const railsInDb = (rails) => {
    jest.spyOn(SpotlightRail, 'find').mockReturnValue({
      sort: () => ({ lean: () => ({ read: async () => rails }) }),
    });
  };

  const stubTypes = () => {
    jest.spyOn(spotlightTypes, 'get').mockImplementation((key) => (key === 'novel'
      ? { ...novelType, loadMany: async (ids) => NOVELS.filter((n) => ids.map(String).includes(String(n._id))) }
      : spotlightTypes.all().find((t) => t.key === key) || null));
  };

  const RAIL = (patch) => ({
    _id: oid('f1'), key: 'k', title: 'T', icon: 'Sparkles', accent: 'crimson',
    layout: 'carousel', source: 'manual', audience: 'all', maxItems: 12,
    isActive: true, updatedAt: new Date('2026-01-01'),
    items: [{ type: 'novel', refId: NOVELS[0]._id, order: 0 }],
    ...patch,
  });

  afterEach(() => jest.restoreAllMocks());

  it('composes a rail into the payload', async () => {
    railsInDb([RAIL({})]);
    stubTypes();
    const { rails } = await spotlight.resolve({ viewer: null, settings: settings() });
    expect(rails).toHaveLength(1);
    expect(rails[0].title).toBe('T');
    expect(rails[0].cards.map((c) => c.title)).toEqual(['First']);
  });

  it('hides a rail whose window has not opened, and one that has closed', async () => {
    railsInDb([
      RAIL({ _id: oid('f1'), key: 'future', startAt: new Date(Date.now() + 86400_000) }),
      RAIL({ _id: oid('f2'), key: 'past', endAt: new Date(Date.now() - 86400_000) }),
      RAIL({ _id: oid('f3'), key: 'now' }),
    ]);
    stubTypes();
    const { rails } = await spotlight.resolve({ viewer: null, settings: settings() });
    expect(rails.map((r) => r.key)).toEqual(['now']);
  });

  it('hides a signed-in rail from an anonymous visitor', async () => {
    railsInDb([RAIL({ key: 'members-only', audience: 'authed' })]);
    stubTypes();
    const { rails } = await spotlight.resolve({ viewer: null, settings: settings() });
    expect(rails).toHaveLength(0);
  });

  it('drops a rail that resolved to nothing, but keeps the pulse rail', async () => {
    railsInDb([
      RAIL({ _id: oid('f1'), key: 'empty', items: [] }),
      RAIL({ _id: oid('f2'), key: 'strip', layout: 'pulse', items: [] }),
    ]);
    stubTypes();
    const { rails } = await spotlight.resolve({ viewer: null, settings: settings() });
    // An empty carousel renders as a heading above nothing, which reads as
    // broken. A pulse rail carries no cards by design.
    expect(rails.map((r) => r.key)).toEqual(['strip']);
  });

  it('caps how many rails one request can ask for', async () => {
    railsInDb(Array.from({ length: 20 }, (_, i) => RAIL({ _id: oid(`e${i}`), key: `r${i}` })));
    stubTypes();
    const { rails } = await spotlight.resolve({
      viewer: null, settings: settings({ 'homepage.maxRails': 3 }),
    });
    expect(rails).toHaveLength(3);
  });

  it('survives one rail throwing, and still renders the others', async () => {
    railsInDb([RAIL({ _id: oid('f1'), key: 'broken' }), RAIL({ _id: oid('f2'), key: 'fine' })]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let first = true;
    jest.spyOn(spotlightTypes, 'get').mockImplementation((key) => {
      if (key !== 'novel') return spotlightTypes.all().find((t) => t.key === key) || null;
      return {
        ...novelType,
        loadMany: async (ids) => {
          if (first) { first = false; throw new Error('database on fire'); }
          return NOVELS.filter((n) => ids.map(String).includes(String(n._id)));
        },
      };
    });
    const { rails } = await spotlight.resolve({ viewer: null, settings: settings() });
    // loadMany failures are swallowed per type, so the broken rail comes back
    // empty and is then dropped as empty — one bad rail, not a 500.
    expect(rails.map((r) => r.key)).toEqual(['fine']);
  });

  // Everything above runs with `cacheSeconds: 0`, so the cached path — the one
  // production actually takes, at a default of 60 — was never exercised. This
  // is the test for the worst bug this file can have: cacheService stores the
  // object rather than a copy, and attachViewerState() writes each visitor's
  // own vote and poll answer onto the cards it is handed. Sharing that object
  // serves one person's ballot to the next.
  describe('the cached path', () => {
    beforeEach(() => cacheService.clear());
    afterEach(() => cacheService.clear());

    const cached = () => ({ viewer: null, settings: settings({ 'homepage.cacheSeconds': 60 }) });

    it('gives each request its own cards rather than the cached object', async () => {
      stubTypes();
      railsInDb([RAIL()]);

      const first = await spotlight.resolve(cached());
      const second = await spotlight.resolve(cached());

      // The root invariant. While this holds, no mutation by any caller can
      // reach another request, whatever that caller writes.
      expect(second.rails[0].cards[0]).not.toBe(first.rails[0].cards[0]);
      expect(second.rails[0].cards[0].entity).not.toBe(first.rails[0].cards[0].entity);
    });

    it('does not carry one viewer\'s vote or poll answer into the next request', async () => {
      stubTypes();
      railsInDb([RAIL()]);

      const first = await spotlight.resolve(cached());
      // Exactly what attachViewerState() does on a post card.
      first.rails[0].cards[0].entity.viewerVote = 1;
      first.rails[0].cards[0].entity.poll = { viewerResponse: ['option-b'] };
      delete first.rails[0].cards[0].entity.rawPoll;

      const second = await spotlight.resolve(cached());
      const entity = second.rails[0].cards[0].entity;

      expect(entity.viewerVote).toBeUndefined();
      expect(entity.poll).toBeUndefined();
    });

    it('still serves the cache rather than re-querying', async () => {
      let loads = 0;
      jest.spyOn(spotlightTypes, 'get').mockImplementation((key) => (key === 'novel'
        ? {
            ...novelType,
            loadMany: async (ids) => {
              loads += 1;
              return NOVELS.filter((n) => ids.map(String).includes(String(n._id)));
            },
          }
        : spotlightTypes.all().find((t) => t.key === key) || null));
      railsInDb([RAIL()]);

      await spotlight.resolve(cached());
      await spotlight.resolve(cached());

      // Copying on the way out must not turn the cache into a pass-through.
      expect(loads).toBe(1);
    });

    it('keeps ObjectIds and Dates intact through the copy', async () => {
      stubTypes();
      railsInDb([RAIL()]);

      const { rails } = await spotlight.resolve(cached());
      const entity = rails[0].cards[0].entity;

      // A JSON round trip would stringify the id; structuredClone would turn
      // it into a plain { buffer } object. Neither survives contact with the
      // API contract or with pollService's date arithmetic.
      expect(String(entity._id)).toBe(String(NOVELS[0]._id));
      expect(require('mongoose').Types.ObjectId.isValid(entity._id)).toBe(true);
    });
  });
});

describe('attachViewerState', () => {
  it('strips a hidden poll for an anonymous visitor rather than sending it hidden', async () => {
    const rails = [{
      cards: [{
        type: 'post',
        entity: {
          id: String(oid('1')),
          rawPoll: {
            options: [{ _id: oid('9'), text: 'a', votes: 41 }],
            hideResultsUntilEnd: true, endsAt: null, totalVoters: 41,
          },
        },
      }],
    }];
    await spotlight.attachViewerState(rails, null);
    const poll = rails[0].cards[0].entity.poll;
    // The tally must be absent from the payload, not merely unrendered — a
    // number sent with a "don't show this" flag is visible in the network tab.
    expect(poll.options[0].votes).toBeUndefined();
    expect(poll.totalVoters).toBeUndefined();
    expect(poll.resultsHidden).toBe(true);
    expect(rails[0].cards[0].entity.rawPoll).toBeUndefined();
  });

  it('sends the tallies once the poll is open about them', async () => {
    const rails = [{
      cards: [{
        type: 'post',
        entity: {
          id: String(oid('1')),
          rawPoll: {
            options: [{ _id: oid('9'), text: 'a', votes: 41 }],
            hideResultsUntilEnd: false, endsAt: null, totalVoters: 41,
          },
        },
      }],
    }];
    await spotlight.attachViewerState(rails, null);
    expect(rails[0].cards[0].entity.poll.options[0].votes).toBe(41);
  });
});

// ------------------------------------------------------- community gating
//
// The community ships switched off and every community ROUTE 404s while it is.
// This service reads the models directly, so without these checks an unlaunched
// community would appear on the one page everybody sees.

describe('community gating', () => {
  const settings = (map) => ({ get: (key) => map[key] });
  const ON = { 'spaces.enabled': true, 'spaces.publicBrowsing': true };
  const viewer = { _id: oid('1') };

  it('is invisible while the community is switched off', () => {
    expect(spotlight.communityVisible(viewer, settings({ ...ON, 'spaces.enabled': false }))).toBe(false);
    expect(spotlight.communityVisible(null, settings({ ...ON, 'spaces.enabled': false }))).toBe(false);
  });

  it('is invisible to a logged-out visitor when public browsing is off', () => {
    const noBrowsing = settings({ ...ON, 'spaces.publicBrowsing': false });
    expect(spotlight.communityVisible(null, noBrowsing)).toBe(false);
    expect(spotlight.communityVisible(viewer, noBrowsing)).toBe(true);
  });

  it('knows which rails depend on the community', () => {
    const auto = (kind) => ({ source: 'auto', query: { kind } });
    expect(spotlight.needsCommunity(auto('posts'))).toBe(true);
    expect(spotlight.needsCommunity(auto('spaces'))).toBe(true);
    expect(spotlight.needsCommunity(auto('linked_posts'))).toBe(true);
    expect(spotlight.needsCommunity(auto('novels'))).toBe(false);
    expect(spotlight.needsCommunity({ source: 'auto', query: {} })).toBe(false);

    expect(spotlight.needsCommunity({ source: 'manual', items: [{ type: 'novel' }] })).toBe(false);
    expect(spotlight.needsCommunity({
      source: 'manual', items: [{ type: 'novel' }, { type: 'post' }],
    })).toBe(true);
  });

  it('drops community items from a mixed hand-picked rail rather than the whole rail', async () => {
    const novelType = spotlightTypes.get('novel');
    const NOVELS = [{ _id: oid('a1'), title: 'First', slug: 'first', published: true }];
    jest.spyOn(spotlightTypes, 'get').mockImplementation((key) => (key === 'novel'
      ? { ...novelType, loadMany: async () => NOVELS }
      : spotlightTypes.all().find((t) => t.key === key) || null));

    const rail = {
      maxItems: 12,
      items: [
        { type: 'novel', refId: NOVELS[0]._id, order: 0 },
        { type: 'post', refId: oid('c1'), order: 1 },
        { type: 'space', refId: oid('d1'), order: 2 },
      ],
    };
    const gated = await spotlight.resolveManual(rail, { community: false });
    expect(gated.map((c) => c.type)).toEqual(['novel']);
    jest.restoreAllMocks();
  });
});
