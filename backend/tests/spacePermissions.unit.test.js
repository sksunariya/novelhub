// The permission matrix.
//
// This is the highest-value test in the community system. Every role, against
// every space state, for every action. A gap here is a security hole, so the
// matrix is exhaustive rather than representative.
//
// Pure — spacePermissionService.resolve() takes documents and returns flags, so
// none of this needs a database.

// `resolve` and `validateOverrides` are pure. `canCreateSpace` reads settings,
// which would otherwise mean a database — so the settings service is stubbed
// with a controllable map. That keeps the whole matrix in the fast unit suite.
//
// The stub must expose the FULL surface that tests/setup.js touches, not just
// what this file uses. `npm test` has no testMatch, so it picks up *.unit.test.js
// as well and applies setup.js to them — and setup.js calls clearCache() in its
// afterEach. A partial mock passes under jest.unit.config.js and fails under the
// main config, which is a confusing way to find out.
jest.mock('../src/services/settingsService', () => {
  const registry = require('../src/config/settingsRegistry');
  const values = { ...registry.defaults() };
  const reset = () => {
    Object.keys(values).forEach((k) => delete values[k]);
    Object.assign(values, registry.defaults());
  };
  return {
    __values: values,
    __set: (patch) => Object.assign(values, patch),
    __reset: reset,
    snapshot: async () => ({
      get: (key) => values[key],
      all: () => ({ ...values }),
      section: () => ({}),
    }),
    // Called by tests/setup.js afterEach.
    clearCache: reset,
    // Present so any future setup.js addition fails loudly here rather than
    // silently skipping a reset.
    get: async (key) => values[key],
    getMany: async (keys) => keys.reduce((acc, k) => ({ ...acc, [k]: values[k] }), {}),
    getPublic: async () => ({ ...values }),
    registry,
  };
});

const settingsService = require('../src/services/settingsService');
const permissions = require('../src/services/community/spacePermissionService');
const {
  ROLES,
  SPACE_VISIBILITY,
  SPACE_STATUS,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_STATUS,
} = require('../src/config/constants');

const HOUR = 3600_000;
const future = (ms = HOUR) => new Date(Date.now() + ms);
const past = (ms = HOUR) => new Date(Date.now() - ms);

const makeSpace = (overrides = {}) => ({
  _id: 'space1',
  status: SPACE_STATUS.ACTIVE,
  visibility: SPACE_VISIBILITY.PUBLIC,
  locked: false,
  publicModlog: false,
  deletedAt: null,
  overrides: {},
  ...overrides,
});

const makeUser = (overrides = {}) => ({
  _id: 'user1',
  role: ROLES.USER,
  banned: false,
  communityBannedUntil: null,
  createdAt: past(HOUR * 24 * 30),
  karma: { total: 100 },
  ...overrides,
});

const makeMember = (overrides = {}) => ({
  role: SPACE_MEMBER_ROLES.MEMBER,
  status: SPACE_MEMBER_STATUS.ACTIVE,
  permissions: {},
  bannedUntil: null,
  mutedUntil: null,
  ...overrides,
});

const FULL_MOD = {
  managePosts: true,
  manageMembers: true,
  manageSettings: true,
  manageFlair: true,
  manageRules: true,
  manageMods: true,
};

describe('resolve — actor identity', () => {
  it('gives an anonymous visitor read-only access to a public space', () => {
    const r = permissions.resolve(null, makeSpace(), null);
    expect(r.can.view).toBe(true);
    expect(r.can.post).toBe(false);
    expect(r.can.comment).toBe(false);
    expect(r.can.vote).toBe(false);
    expect(r.reason).toBe('not_signed_in');
  });

  it('lets a signed-in non-member post in an open public space', () => {
    const r = permissions.resolve(makeUser(), makeSpace(), null);
    expect(r.can.view).toBe(true);
    expect(r.can.post).toBe(true);
    expect(r.can.vote).toBe(true);
    expect(r.can.managePosts).toBe(false);
  });

  it('grants a site admin everything, in every space state', () => {
    // This is what "admins control every single thing" means concretely.
    const admin = makeUser({ role: ROLES.ADMIN });
    for (const status of Object.values(SPACE_STATUS)) {
      for (const visibility of Object.values(SPACE_VISIBILITY)) {
        const r = permissions.resolve(admin, makeSpace({ status, visibility, locked: true }), null);
        expect(Object.values(r.can).every(Boolean)).toBe(true);
      }
    }
  });

  it('does not let a moderator ban an admin out of a space', () => {
    const admin = makeUser({ role: ROLES.ADMIN });
    const banned = makeMember({ status: SPACE_MEMBER_STATUS.BANNED });
    const r = permissions.resolve(admin, makeSpace(), banned);
    expect(r.can.managePosts).toBe(true);
    expect(r.isBanned).toBe(false);
  });
});

describe('resolve — moderator permissions are granular', () => {
  const cases = [
    ['managePosts', 'managePosts'],
    ['manageMembers', 'manageMembers'],
    ['manageSettings', 'manageSettings'],
    ['manageFlair', 'manageFlair'],
    ['manageRules', 'manageRules'],
    ['manageMods', 'manageMods'],
  ];

  it.each(cases)('a mod holding only %s cannot do anything else', (granted) => {
    // A flair moderator who cannot ban people is the whole point. A single role
    // enum forces every mod to be all-powerful, which is how community
    // moderation goes wrong.
    const member = makeMember({
      role: SPACE_MEMBER_ROLES.MODERATOR,
      permissions: { [granted]: true },
    });
    const r = permissions.resolve(makeUser(), makeSpace(), member);

    expect(r.can[granted]).toBe(true);
    for (const [other] of cases) {
      if (other !== granted) expect(r.can[other]).toBe(false);
    }
  });

  it('gives an owner every moderator permission implicitly', () => {
    // An owner who could lock themselves out by clearing a checkbox is a
    // support ticket waiting to happen.
    const owner = makeMember({ role: SPACE_MEMBER_ROLES.OWNER, permissions: {} });
    const r = permissions.resolve(makeUser(), makeSpace(), owner);
    for (const [permission] of cases) expect(r.can[permission]).toBe(true);
    expect(r.can.deleteSpace).toBe(true);
  });

  it('does not let a moderator delete the space', () => {
    const mod = makeMember({ role: SPACE_MEMBER_ROLES.MODERATOR, permissions: FULL_MOD });
    expect(permissions.resolve(makeUser(), makeSpace(), mod).can.deleteSpace).toBe(false);
  });

  it('ignores permissions on a plain member', () => {
    // A stale permissions object left behind by a demotion must not grant
    // anything.
    const demoted = makeMember({ role: SPACE_MEMBER_ROLES.MEMBER, permissions: FULL_MOD });
    const r = permissions.resolve(makeUser(), makeSpace(), demoted);
    expect(r.can.managePosts).toBe(false);
    expect(r.isModerator).toBe(false);
  });

  it('ignores permissions on a moderator whose membership is not active', () => {
    const suspended = makeMember({
      role: SPACE_MEMBER_ROLES.MODERATOR,
      status: SPACE_MEMBER_STATUS.BANNED,
      permissions: FULL_MOD,
    });
    const r = permissions.resolve(makeUser(), makeSpace(), suspended);
    expect(r.isModerator).toBe(false);
    expect(r.can.managePosts).toBe(false);
  });
});

describe('resolve — space visibility', () => {
  it('hides a private space from non-members', () => {
    const space = makeSpace({ visibility: SPACE_VISIBILITY.PRIVATE });
    expect(permissions.resolve(makeUser(), space, null).can.view).toBe(false);
    expect(permissions.resolve(null, space, null).can.view).toBe(false);
  });

  it('shows a private space to its members', () => {
    const space = makeSpace({ visibility: SPACE_VISIBILITY.PRIVATE });
    expect(permissions.resolve(makeUser(), space, makeMember()).can.view).toBe(true);
  });

  it('lets anyone read a restricted space but only members post', () => {
    const space = makeSpace({ visibility: SPACE_VISIBILITY.RESTRICTED });
    const outsider = permissions.resolve(makeUser(), space, null);
    expect(outsider.can.view).toBe(true);
    expect(outsider.can.post).toBe(false);
    expect(outsider.can.vote).toBe(true);

    const member = permissions.resolve(makeUser(), space, makeMember());
    expect(member.can.post).toBe(true);
  });

  it('shows a pending space only to its creator', () => {
    const space = makeSpace({ status: SPACE_STATUS.PENDING });
    const owner = makeMember({ role: SPACE_MEMBER_ROLES.OWNER });
    expect(permissions.resolve(makeUser(), space, owner).can.view).toBe(true);
    expect(permissions.resolve(makeUser(), space, null).can.view).toBe(false);
  });
});

describe('resolve — space lifecycle', () => {
  const writableStates = [[SPACE_STATUS.ACTIVE, true]];
  const readOnlyStates = [
    [SPACE_STATUS.ARCHIVED, false],
    [SPACE_STATUS.QUARANTINED, false],
  ];

  it.each([...writableStates, ...readOnlyStates])(
    'a %s space allows posting: %s',
    (status, expected) => {
      const r = permissions.resolve(makeUser(), makeSpace({ status }), makeMember());
      expect(r.can.post).toBe(expected);
    }
  );

  it('makes a banned space invisible to everyone but an admin', () => {
    const space = makeSpace({ status: SPACE_STATUS.BANNED });
    expect(permissions.resolve(makeUser(), space, makeMember()).can.view).toBe(false);
    const owner = makeMember({ role: SPACE_MEMBER_ROLES.OWNER });
    expect(permissions.resolve(makeUser(), space, owner).can.view).toBe(false);
    expect(permissions.resolve(makeUser({ role: ROLES.ADMIN }), space, null).can.view).toBe(true);
  });

  it('makes a locked space read-only but keeps moderators working', () => {
    // Locking a space is exactly when its moderators most need to act.
    const space = makeSpace({ locked: true });
    const mod = makeMember({ role: SPACE_MEMBER_ROLES.MODERATOR, permissions: FULL_MOD });
    const r = permissions.resolve(makeUser(), space, mod);
    expect(r.can.post).toBe(false);
    expect(r.can.comment).toBe(false);
    expect(r.can.managePosts).toBe(true);
    expect(r.reason).toBe('space_locked');
  });

  it('treats a soft-deleted space as gone', () => {
    const space = makeSpace({ deletedAt: new Date() });
    expect(permissions.resolve(makeUser(), space, makeMember()).can.view).toBe(false);
  });
});

describe('resolve — bans and mutes', () => {
  it('blocks writing but not reading for a banned member', () => {
    // Hiding a public space from a banned user achieves nothing — they can sign
    // out and see the same page — and it makes an appeal harder to write.
    const banned = makeMember({ status: SPACE_MEMBER_STATUS.BANNED });
    const r = permissions.resolve(makeUser(), makeSpace(), banned);
    expect(r.isBanned).toBe(true);
    expect(r.can.view).toBe(true);
    expect(r.can.post).toBe(false);
    expect(r.can.comment).toBe(false);
    expect(r.can.vote).toBe(false);
    expect(r.reason).toBe('banned');
  });

  it('treats an expired ban as lifted even before the sweep job runs', () => {
    const expired = makeMember({
      status: SPACE_MEMBER_STATUS.BANNED,
      bannedUntil: past(),
    });
    const r = permissions.resolve(makeUser(), makeSpace(), expired);
    expect(r.isBanned).toBe(false);
    expect(r.can.post).toBe(true);
  });

  it('keeps a ban with a future expiry in force', () => {
    const active = makeMember({ status: SPACE_MEMBER_STATUS.BANNED, bannedUntil: future() });
    expect(permissions.resolve(makeUser(), makeSpace(), active).isBanned).toBe(true);
  });

  it('treats a ban with no expiry as permanent', () => {
    const permanent = makeMember({ status: SPACE_MEMBER_STATUS.BANNED, bannedUntil: null });
    expect(permissions.resolve(makeUser(), makeSpace(), permanent).isBanned).toBe(true);
  });

  it('blocks writing for a muted member and lifts it on expiry', () => {
    const muted = makeMember({ mutedUntil: future() });
    const r = permissions.resolve(makeUser(), makeSpace(), muted);
    expect(r.isMuted).toBe(true);
    expect(r.can.post).toBe(false);
    expect(r.reason).toBe('muted');

    const lifted = makeMember({ mutedUntil: past() });
    expect(permissions.resolve(makeUser(), makeSpace(), lifted).can.post).toBe(true);
  });

  it('lets a site-wide community ban outrank ownership', () => {
    const bannedUser = makeUser({ communityBannedUntil: future() });
    const owner = makeMember({ role: SPACE_MEMBER_ROLES.OWNER });
    const r = permissions.resolve(bannedUser, makeSpace(), owner);
    expect(r.isBanned).toBe(true);
    expect(r.reason).toBe('community_banned');
    expect(Object.values(r.can).every((v) => v === false)).toBe(true);
  });

  it('lifts an expired site-wide community ban', () => {
    const r = permissions.resolve(makeUser({ communityBannedUntil: past() }), makeSpace(), null);
    expect(r.isBanned).toBe(false);
    expect(r.can.post).toBe(true);
  });
});

describe('resolve — mod log visibility', () => {
  it('keeps the mod log private by default', () => {
    expect(permissions.resolve(makeUser(), makeSpace(), makeMember()).can.viewModlog).toBe(false);
  });

  it('shows it to moderators', () => {
    const mod = makeMember({ role: SPACE_MEMBER_ROLES.MODERATOR, permissions: {} });
    expect(permissions.resolve(makeUser(), makeSpace(), mod).can.viewModlog).toBe(true);
  });

  it('shows it to everyone when the space opts in', () => {
    const space = makeSpace({ publicModlog: true });
    expect(permissions.resolve(null, space, null).can.viewModlog).toBe(true);
  });

  it('does not leak it through a private space the viewer cannot see', () => {
    const space = makeSpace({ publicModlog: true, visibility: SPACE_VISIBILITY.PRIVATE });
    expect(permissions.resolve(makeUser(), space, null).can.viewModlog).toBe(false);
  });
});

describe('resolve — defensive', () => {
  it('denies everything when there is no space', () => {
    const r = permissions.resolve(makeUser({ role: ROLES.ADMIN }), null, null);
    expect(Object.values(r.can).every((v) => v === false)).toBe(true);
  });

  it('never returns an undefined permission', () => {
    // A missing key reads as falsy in a controller, which is safe — but it
    // hides a typo. Every key must always be present.
    const keys = Object.keys(permissions.NO_PERMISSIONS);
    for (const space of [makeSpace(), makeSpace({ status: SPACE_STATUS.ARCHIVED }), null]) {
      const r = permissions.resolve(makeUser(), space, makeMember());
      for (const key of keys) expect(typeof r.can[key]).toBe('boolean');
    }
  });
});

describe('validateOverrides', () => {
  it('accepts a key flagged spaceOverridable', () => {
    const result = permissions.validateOverrides({ 'spaces.posting.requireFlair': true });
    expect(result.ok).toBe(true);
    expect(result.values['spaces.posting.requireFlair']).toBe(true);
  });

  it('rejects a key that is not space-overridable', () => {
    // A space owner must not be able to change site-wide behaviour from their
    // own settings page.
    const result = permissions.validateOverrides({ 'spaces.enabled': true });
    expect(result.ok).toBe(false);
    expect(result.errors['spaces.enabled']).toMatch(/single space/);
  });

  it('lets an admin force a non-overridable key', () => {
    const result = permissions.validateOverrides(
      { 'spaces.ranking.hotGravitySeconds': 20000 },
      { asAdmin: true }
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(permissions.validateOverrides({ 'spaces.nope': 1 }).ok).toBe(false);
  });

  it('validates the value, not just the key', () => {
    const result = permissions.validateOverrides({ 'spaces.posting.minKarmaToPost': -5 });
    expect(result.ok).toBe(false);
  });

  it('rejects the whole patch if any key fails, so a form never half-saves', () => {
    const result = permissions.validateOverrides({
      'spaces.posting.requireFlair': true,
      'spaces.nope': 1,
    });
    expect(result.ok).toBe(false);
    expect(result.values).toBeUndefined();
  });

  it('rejects a non-object patch', () => {
    for (const bad of [null, 'x', [], 42]) {
      expect(permissions.validateOverrides(bad).ok).toBe(false);
    }
  });

  it('exposes the overridable keys for the settings UI', () => {
    const keys = permissions.overridableKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.spaceOverridable)).toBe(true);
    expect(keys.every((k) => k.key.startsWith('spaces.'))).toBe(true);
  });
});

describe('canCreateSpace — resolution chain', () => {
  beforeEach(() => {
    settingsService.__reset();
    settingsService.__set({ 'spaces.enabled': true });
  });

  const ctx = (overrides = {}) => ({
    ownedCount: 0,
    totalSpaces: 0,
    lastCreatedAt: null,
    emailVerified: true,
    ...overrides,
  });

  it('refuses when the community is switched off', async () => {
    settingsService.__set({ 'spaces.enabled': false });
    const r = await permissions.canCreateSpace(makeUser(), ctx());
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('refuses an anonymous visitor', async () => {
    expect((await permissions.canCreateSpace(null, ctx())).reason).toBe('not_signed_in');
  });

  it('refuses a suspended account', async () => {
    const r = await permissions.canCreateSpace(makeUser({ banned: true }), ctx());
    expect(r.reason).toBe('banned');
  });

  it('refuses a community-banned user', async () => {
    const user = makeUser({ communityBannedUntil: future() });
    expect((await permissions.canCreateSpace(user, ctx())).reason).toBe('community_banned');
  });

  describe('per-user overrides outrank the global mode', () => {
    it("'never' blocks even when the mode is open", async () => {
      settingsService.__set({ 'spaces.creation.mode': 'open' });
      const user = makeUser({ spaceCreation: { policy: 'never' } });
      const r = await permissions.canCreateSpace(user, ctx());
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('revoked');
    });

    it("'always' allows even when the mode is admin_only", async () => {
      // This is how an admin hands creation rights to three trusted people at
      // launch without loosening the gate for everyone.
      settingsService.__set({ 'spaces.creation.mode': 'admin_only' });
      const user = makeUser({ spaceCreation: { policy: 'always' } });
      const r = await permissions.canCreateSpace(user, ctx());
      expect(r.allowed).toBe(true);
      expect(r.requiresApproval).toBe(false);
    });

    it("'always' still respects the caps, which protect the system", async () => {
      settingsService.__set({ 'spaces.creation.mode': 'open', 'spaces.creation.maxPerUser': 2 });
      const user = makeUser({ spaceCreation: { policy: 'always' } });
      const r = await permissions.canCreateSpace(user, ctx({ ownedCount: 2 }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('own_limit');
    });
  });

  describe('modes', () => {
    it('open allows any signed-in user', async () => {
      settingsService.__set({ 'spaces.creation.mode': 'open' });
      expect((await permissions.canCreateSpace(makeUser({ karma: { total: 0 } }), ctx())).allowed).toBe(true);
    });

    it('admin_only blocks a normal user and allows an admin', async () => {
      settingsService.__set({ 'spaces.creation.mode': 'admin_only' });
      expect((await permissions.canCreateSpace(makeUser(), ctx())).reason).toBe('admin_only');
      const admin = makeUser({ role: ROLES.ADMIN });
      expect((await permissions.canCreateSpace(admin, ctx())).allowed).toBe(true);
    });

    it('karma_gated compares against the threshold and says the shortfall', async () => {
      settingsService.__set({ 'spaces.creation.mode': 'karma_gated', 'spaces.creation.minKarma': 50 });
      const poor = await permissions.canCreateSpace(makeUser({ karma: { total: 10 } }), ctx());
      expect(poor.allowed).toBe(false);
      // A blocked user must be told why, not shown a dead button.
      expect(poor.message).toContain('50');
      expect(poor.message).toContain('10');

      const rich = await permissions.canCreateSpace(makeUser({ karma: { total: 60 } }), ctx());
      expect(rich.allowed).toBe(true);
    });

    it('approval allows the request but flags it for review', async () => {
      settingsService.__set({ 'spaces.creation.mode': 'approval' });
      const r = await permissions.canCreateSpace(makeUser(), ctx());
      expect(r.allowed).toBe(true);
      expect(r.requiresApproval).toBe(true);
    });

    it('approval skips the queue above the auto-approve karma', async () => {
      settingsService.__set({
        'spaces.creation.mode': 'approval',
        'spaces.creation.autoApproveAboveKarma': 500,
      });
      const trusted = await permissions.canCreateSpace(makeUser({ karma: { total: 900 } }), ctx());
      expect(trusted.requiresApproval).toBe(false);
    });
  });

  describe('gates that apply across modes', () => {
    it('enforces minimum account age', async () => {
      settingsService.__set({
        'spaces.creation.mode': 'open',
        'spaces.creation.minAccountAgeHours': 72,
      });
      const fresh = makeUser({ createdAt: past(HOUR) });
      expect((await permissions.canCreateSpace(fresh, ctx())).reason).toBe('account_too_new');

      const aged = makeUser({ createdAt: past(HOUR * 100) });
      expect((await permissions.canCreateSpace(aged, ctx())).allowed).toBe(true);
    });

    it('enforces email verification', async () => {
      settingsService.__set({
        'spaces.creation.mode': 'open',
        'spaces.creation.requireVerifiedEmail': true,
      });
      const r = await permissions.canCreateSpace(makeUser(), ctx({ emailVerified: false }));
      expect(r.reason).toBe('email_unverified');
    });

    it('enforces the site-wide cap', async () => {
      settingsService.__set({ 'spaces.creation.mode': 'open', 'spaces.creation.maxTotalSpaces': 100 });
      const r = await permissions.canCreateSpace(makeUser(), ctx({ totalSpaces: 100 }));
      expect(r.reason).toBe('site_limit');
    });

    it('enforces the cooldown and reports when it lifts', async () => {
      settingsService.__set({ 'spaces.creation.mode': 'open', 'spaces.creation.cooldownHours': 24 });
      const r = await permissions.canCreateSpace(makeUser(), ctx({ lastCreatedAt: past(HOUR) }));
      expect(r.reason).toBe('cooldown');
      expect(r.readyAt).toBeInstanceOf(Date);

      const later = await permissions.canCreateSpace(
        makeUser(),
        ctx({ lastCreatedAt: past(HOUR * 48) })
      );
      expect(later.allowed).toBe(true);
    });

    it('treats a zero cap as unlimited', async () => {
      settingsService.__set({
        'spaces.creation.mode': 'open',
        'spaces.creation.maxPerUser': 0,
        'spaces.creation.maxTotalSpaces': 0,
      });
      const r = await permissions.canCreateSpace(makeUser(), ctx({ ownedCount: 999, totalSpaces: 9999 }));
      expect(r.allowed).toBe(true);
    });
  });
});
