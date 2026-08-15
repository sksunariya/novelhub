// The admin module access matrix.
//
// This decides what an admin can see AND what an admin can do — module
// visibility withdraws the capability behind it, not just the menu entry — so a
// gap here is a permission hole, not a cosmetic bug. The matrix is therefore
// tested exhaustively rather than representatively, in the spirit of
// spacePermissions.unit.test.js.
//
// Pure: the only database read is the global-defaults singleton, stubbed below
// with a controllable map so the whole suite stays in the fast unit config.

// Stands in for the singleton document. Mirrors the real model's surface —
// a `modules` Map, `save()`, and `toModuleMap()` filtered to known ids — so the
// write path is exercised rather than stubbed past.
jest.mock('../src/models/AdminModuleAccess', () => {
  const { ADMIN_MODULE_IDS } = require('../src/config/constants');
  let globals = new Map();
  const doc = {
    modules: globals,
    updatedBy: null,
    save: async () => doc,
    toModuleMap: () =>
      ADMIN_MODULE_IDS.reduce(
        (acc, id) => (globals.has(id) ? { ...acc, [id]: Boolean(globals.get(id)) } : acc),
        {}
      ),
  };
  return {
    __set: (next) => {
      globals.clear();
      Object.entries(next).forEach(([key, value]) => globals.set(key, value));
    },
    __reset: () => globals.clear(),
    getDoc: async () => doc,
  };
});

const AdminModuleAccess = require('../src/models/AdminModuleAccess');
const moduleAccess = require('../src/services/moduleAccessService');
const auth = require('../src/middlewares/auth');
const { ROLES, ADMIN_MODULES, ELEVATED_PERMISSIONS, CONFIG_PREFIX_MODULES } = require('../src/config/constants');

const mapOf = (obj) => new Map(Object.entries(obj));

const admin = (overrides) => ({
  _id: 'admin-1',
  role: ROLES.ADMIN,
  adminModules: overrides ? mapOf(overrides) : undefined,
});
const superAdmin = { _id: 'super-1', role: ROLES.SUPERADMIN };
const reader = { _id: 'user-1', role: ROLES.USER };

/** Run a guard and report what it did: 'next' or the status code it sent. */
const runGuard = (middleware, user) =>
  new Promise((resolve) => {
    const req = { user };
    let handled = false;
    const res = {
      status: (code) => ({
        json: () => {
          handled = true;
          resolve(code);
        },
      }),
    };
    Promise.resolve(middleware(req, res, () => !handled && resolve('next')));
  });

/** As the request pipeline does it: resolve the matrix onto the user once. */
const withCapabilities = async (user) => {
  await moduleAccess.attachCapabilities(user);
  return user;
};

beforeEach(() => {
  AdminModuleAccess.__reset();
  moduleAccess.invalidate();
});

describe('resolution', () => {
  it('shows every non-restricted module when nothing has been decided', async () => {
    const resolved = await moduleAccess.resolveForUser(admin());
    expect(resolved.modules.analytics).toBe(true);
    expect(resolved.modules.novels).toBe(true);
    expect(resolved.sources.analytics).toBe('default');
  });

  it('applies a global hide, and reports where the decision came from', async () => {
    AdminModuleAccess.__set({ analytics: false });
    const resolved = await moduleAccess.resolveForUser(admin());
    expect(resolved.modules.analytics).toBe(false);
    expect(resolved.sources.analytics).toBe('global');
    expect(resolved.modules.novels).toBe(true);
  });

  it('lets a per-admin override win over the global default, in both directions', async () => {
    AdminModuleAccess.__set({ analytics: false });
    const resolved = await moduleAccess.resolveForUser(admin({ analytics: true, novels: false }));
    expect(resolved.modules.analytics).toBe(true);
    expect(resolved.sources.analytics).toBe('user');
    expect(resolved.modules.novels).toBe(false);
    expect(resolved.sources.novels).toBe('user');
  });

  it('gives a superadmin everything, whatever has been decided', async () => {
    AdminModuleAccess.__set(Object.fromEntries(ADMIN_MODULES.map((m) => [m.id, false])));
    const resolved = await moduleAccess.resolveForUser(superAdmin);
    expect(Object.values(resolved.modules).every(Boolean)).toBe(true);
    expect(resolved.modules.access_control).toBe(true);
    expect(resolved.isSuperAdmin).toBe(true);
  });

  it('keeps alwaysOn on and superOnly off, however hard either is toggled', async () => {
    AdminModuleAccess.__set({ dashboard: false, access_control: true });
    const resolved = await moduleAccess.resolveForUser(admin({ dashboard: false, access_control: true }));
    expect(resolved.modules.dashboard).toBe(true);
    expect(resolved.modules.access_control).toBe(false);
    expect(resolved.sources.dashboard).toBe('always_on');
    expect(resolved.sources.access_control).toBe('superadmin_only');
  });

  it('refuses to store a toggle for alwaysOn or superOnly modules', async () => {
    const globals = await moduleAccess.setGlobalDefaults(
      { dashboard: false, access_control: true, analytics: false },
      superAdmin
    );
    expect(globals).toEqual({ analytics: false });
  });
});

describe('canAccess', () => {
  it.each([
    ['a hidden module', 'analytics', false],
    ['an open module', 'novels', true],
    ['the superadmin-only module', 'access_control', false],
    ['an unknown module', 'no-such-module', false],
  ])('denies or allows an admin %s', async (_label, moduleId, expected) => {
    AdminModuleAccess.__set({ analytics: false });
    expect(await moduleAccess.canAccess(admin(), moduleId)).toBe(expected);
  });

  it('never fails open on an unknown module id', async () => {
    expect(await moduleAccess.canAccess(admin(), 'typo_module')).toBe(false);
  });

  it('allows a superadmin everything and a reader nothing', async () => {
    AdminModuleAccess.__set({ analytics: false });
    expect(await moduleAccess.canAccess(superAdmin, 'analytics')).toBe(true);
    expect(await moduleAccess.canAccess(superAdmin, 'access_control')).toBe(true);
    expect(await moduleAccess.canAccess(reader, 'novels')).toBe(false);
    expect(await moduleAccess.canAccess(null, 'novels')).toBe(false);
  });
});

describe('capabilities outside the portal', () => {
  it('withdraws the capability when the module is hidden', async () => {
    AdminModuleAccess.__set({ moderation: false });
    const user = await withCapabilities(admin());
    expect(moduleAccess.hasCapability(user, 'moderation')).toBe(false);
    expect(moduleAccess.hasCapability(user, 'spaces')).toBe(true);
  });

  it('keeps every capability for a superadmin', async () => {
    AdminModuleAccess.__set({ moderation: false, spaces: false });
    const user = await withCapabilities({ ...superAdmin });
    expect(moduleAccess.hasCapability(user, 'moderation')).toBe(true);
    expect(moduleAccess.hasCapability(user, 'spaces')).toBe(true);
  });

  it('grants nothing to a reader or to nobody', () => {
    expect(moduleAccess.hasCapability(reader, 'moderation')).toBe(false);
    expect(moduleAccess.hasCapability(null, 'moderation')).toBe(false);
  });

  it('falls back to full admin authority when never resolved', () => {
    // Jobs and scripts act without a request. Failing closed there would
    // silently disable background work rather than protect anything.
    expect(moduleAccess.hasCapability(admin(), 'moderation')).toBe(true);
  });

  it('does not expose the resolved matrix on the serialised user', async () => {
    const user = await withCapabilities(admin());
    expect(Object.keys(user)).not.toContain('moduleCapabilities');
    expect(JSON.stringify(user)).not.toContain('moduleCapabilities');
  });
});

describe('route guards', () => {
  beforeEach(() => AdminModuleAccess.__set({ analytics: false }));

  it('404s a hidden module rather than 403ing it', async () => {
    // 403 would confirm the section exists to be asked about.
    expect(await runGuard(auth.requireModule('analytics'), admin())).toBe(404);
  });

  it('passes a visible module, and passes a superadmin regardless', async () => {
    expect(await runGuard(auth.requireModule('novels'), admin())).toBe('next');
    expect(await runGuard(auth.requireModule('analytics'), superAdmin)).toBe('next');
  });

  it('opens requireAnyModule on holding just one of the set', async () => {
    AdminModuleAccess.__set({ monetization_config: false, platform_config: false });
    const ids = Object.values(CONFIG_PREFIX_MODULES);
    expect(await runGuard(auth.requireAnyModule(ids), admin())).toBe('next');
  });

  it('closes requireAnyModule when every module in the set is hidden', async () => {
    AdminModuleAccess.__set(
      Object.fromEntries(Object.values(CONFIG_PREFIX_MODULES).map((id) => [id, false]))
    );
    expect(await runGuard(auth.requireAnyModule(Object.values(CONFIG_PREFIX_MODULES)), admin())).toBe(404);
  });

  it('lets adminOnly through for both staff roles and nobody else', async () => {
    expect(await runGuard(auth.adminOnly, admin())).toBe('next');
    expect(await runGuard(auth.adminOnly, superAdmin)).toBe('next');
    expect(await runGuard(auth.adminOnly, reader)).toBe(403);
    expect(await runGuard(auth.adminOnly, null)).toBe(403);
  });

  it('restricts superAdminOnly to the owner tier', async () => {
    expect(await runGuard(auth.superAdminOnly, superAdmin)).toBe('next');
    expect(await runGuard(auth.superAdminOnly, admin())).toBe(403);
    expect(await runGuard(auth.superAdminOnly, reader)).toBe(403);
  });
});

describe('elevated permissions', () => {
  const guard = auth.requireElevated(ELEVATED_PERMISSIONS.CHILD_SAFETY);

  it('still requires an explicit grant from an ordinary admin', async () => {
    expect(await runGuard(guard, admin())).toBe(403);
  });

  it('honours an explicit grant', async () => {
    const granted = { ...admin(), elevatedPermissions: [ELEVATED_PERMISSIONS.CHILD_SAFETY] };
    expect(await runGuard(guard, granted)).toBe('next');
  });

  it('treats the superadmin as holding every permission implicitly', async () => {
    expect(await runGuard(guard, superAdmin)).toBe('next');
    expect(auth.hasElevated(superAdmin, ELEVATED_PERMISSIONS.LEGAL)).toBe(true);
    expect(auth.hasElevated(admin(), ELEVATED_PERMISSIONS.LEGAL)).toBe(false);
  });
});

describe('registry integrity', () => {
  it('has unique module ids', () => {
    const ids = ADMIN_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every module a label, group and description', () => {
    for (const module of ADMIN_MODULES) {
      expect(module.label).toBeTruthy();
      expect(module.group).toBeTruthy();
      expect(module.description).toBeTruthy();
    }
  });

  it('never marks a module both alwaysOn and superOnly', () => {
    // Contradictory: one forces it on for admins, the other forces it off.
    expect(ADMIN_MODULES.filter((m) => m.alwaysOn && m.superOnly)).toEqual([]);
  });

  it('maps every config prefix to a real module', () => {
    const ids = ADMIN_MODULES.map((m) => m.id);
    for (const moduleId of Object.values(CONFIG_PREFIX_MODULES)) {
      expect(ids).toContain(moduleId);
    }
  });

  it('covers every settings-registry section with exactly one module', () => {
    // A section belonging to no module would be governed by the platform
    // fallback, which is a decision that should be deliberate rather than the
    // result of someone adding a section file and forgetting this map.
    const registry = require('../src/config/settingsRegistry');
    const prefixes = new Set(registry.sections().map((section) => section.split('.')[0]));
    for (const prefix of prefixes) {
      expect(Object.keys(CONFIG_PREFIX_MODULES)).toContain(prefix);
    }
  });
});

describe('config section scoping', () => {
  // Regression: /admin/config serves 39 sections across three domains. Every
  // path that returns settings must be trimmed, not just the read endpoint —
  // settingsService.update() answers with the full registry, so the response to
  // a write was leaking sections the reader had no module for.
  const registry = require('../src/config/settingsRegistry');

  const prefixOf = (section) => section.split('.')[0];
  const canTouch = (user, section) =>
    moduleAccess.hasCapability(user, CONFIG_PREFIX_MODULES[prefixOf(section)] || 'platform_config');

  const sectionsFor = async (globals) => {
    AdminModuleAccess.__set(globals);
    moduleAccess.invalidate();
    const user = await withCapabilities(admin());
    return registry.sections().filter((section) => canTouch(user, section));
  };

  it('removes only the hidden domain, leaving the other two', async () => {
    const allowed = await sectionsFor({ monetization_config: false });
    expect(allowed.some((s) => s.startsWith('monetization.'))).toBe(false);
    expect(allowed.some((s) => s.startsWith('platform.'))).toBe(true);
    expect(allowed.some((s) => s.startsWith('spaces.'))).toBe(true);
  });

  it('leaves nothing when all three are hidden', async () => {
    const allowed = await sectionsFor({
      monetization_config: false,
      platform_config: false,
      community_config: false,
    });
    expect(allowed).toEqual([]);
  });

  it('gives a superadmin every section regardless', async () => {
    AdminModuleAccess.__set({ monetization_config: false, platform_config: false });
    moduleAccess.invalidate();
    const user = await withCapabilities({ ...superAdmin });
    const allowed = registry.sections().filter((section) => canTouch(user, section));
    expect(allowed).toEqual(registry.sections());
  });
});
