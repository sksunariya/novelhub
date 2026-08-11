const settingsService = require('../src/services/settingsService');
const registry = require('../src/config/settingsRegistry');
const AppSettings = require('../src/models/AppSettings');
const AdminAuditLog = require('../src/models/AdminAuditLog');
const { createAdmin } = require('./helpers');

beforeEach(() => {
  settingsService.clearCache();
});

describe('settings service', () => {
  it('returns registry defaults before anything is stored', async () => {
    expect(await settingsService.get('credits.perUsd')).toBe(100);
    expect(await settingsService.get('monetization.enabled')).toBe(false);
  });

  it('throws on an unknown key rather than returning undefined', async () => {
    const snapshot = await settingsService.snapshot();
    expect(() => snapshot.get('nope.missing')).toThrow(/Unknown setting/);
  });

  it('persists only values that differ from the default', async () => {
    await settingsService.update({ 'credits.perUsd': 250, 'credits.labelPlural': 'Credits' });
    const doc = await AppSettings.getDoc();
    expect(doc.getValue('credits.perUsd')).toBe(250);
    // unchanged from default, so it is not stored
    expect(doc.hasValue('credits.labelPlural')).toBe(false);
  });

  it('removes the override when a value is set back to its default', async () => {
    await settingsService.update({ 'credits.perUsd': 250 });
    settingsService.clearCache();
    await settingsService.update({ 'credits.perUsd': 100 });
    const doc = await AppSettings.getDoc();
    expect(doc.hasValue('credits.perUsd')).toBe(false);
    expect(await settingsService.get('credits.perUsd')).toBe(100);
  });

  it('coerces string input from form posts', async () => {
    await settingsService.update({ 'monetization.enabled': 'true', 'credits.perUsd': '500' });
    settingsService.clearCache();
    expect(await settingsService.get('monetization.enabled')).toBe(true);
    expect(await settingsService.get('credits.perUsd')).toBe(500);
  });

  it('rejects the whole patch when any key is invalid', async () => {
    await expect(
      settingsService.update({ 'credits.perUsd': 500, 'pricing.gateStacking': 'bogus' })
    ).rejects.toMatchObject({ status: 400, errors: { 'pricing.gateStacking': expect.any(String) } });

    // the valid key in the same patch must not have been applied
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(100);
  });

  it('rejects unknown keys', async () => {
    await expect(settingsService.update({ 'made.up.key': 1 })).rejects.toMatchObject({
      status: 400,
      errors: { 'made.up.key': 'unknown setting' },
    });
  });

  it('refuses to write a secret through the API', async () => {
    await expect(settingsService.update({ 'paypal.clientSecret': 'leaked' })).rejects.toMatchObject({
      status: 400,
      errors: { 'paypal.clientSecret': expect.stringContaining('PAYPAL_CLIENT_SECRET') },
    });
  });

  it('bumps the version and invalidates other instances', async () => {
    const before = (await AppSettings.getDoc()).version;
    await settingsService.update({ 'credits.perUsd': 250 });
    const after = (await AppSettings.getDoc()).version;
    expect(after).toBe(before + 1);
  });

  it('does not bump the version when nothing actually changed', async () => {
    await settingsService.update({ 'credits.perUsd': 250 });
    const version = (await AppSettings.getDoc()).version;
    const result = await settingsService.update({ 'credits.perUsd': 250 });
    expect(result.changed).toBe(0);
    expect((await AppSettings.getDoc()).version).toBe(version);
  });

  it('picks up a change made by another instance after revalidating', async () => {
    expect(await settingsService.get('credits.perUsd')).toBe(100);
    // Simulate a second instance writing directly, bypassing this cache.
    const doc = await AppSettings.getDoc();
    doc.setValue('credits.perUsd', 777);
    doc.version += 1;
    await doc.save();

    // Still cached within the revalidate window.
    expect(await settingsService.get('credits.perUsd')).toBe(100);

    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(777);
  });

  it('writes an audit entry with before and after values', async () => {
    const { user: admin } = await createAdmin();
    await settingsService.update({ 'credits.perUsd': 250 }, { actor: admin, ip: '10.0.0.1' });
    const entry = await AdminAuditLog.findOne({ action: 'settings.update' });
    expect(entry.changes).toHaveLength(1);
    expect(entry.changes[0]).toMatchObject({ key: 'credits.perUsd', before: 100, after: 250 });
    expect(entry.actorLabel).toBe(admin.username);
    expect(entry.ip).toBe('10.0.0.1');
  });

  it('resets keys back to their defaults', async () => {
    await settingsService.update({ 'credits.perUsd': 250, 'pricing.defaultChapterCredits': 42 });
    settingsService.clearCache();
    await settingsService.reset(['credits.perUsd']);
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(100);
    expect(await settingsService.get('pricing.defaultChapterCredits')).toBe(42);
  });

  describe('projections', () => {
    it('exposes only public keys to unauthenticated clients', async () => {
      const pub = await settingsService.getPublic();
      const keys = Object.keys(pub);
      expect(keys).toContain('credits.perUsd');
      expect(keys).not.toContain('paypal.clientSecret');
      expect(keys).not.toContain('grants.approvalThresholdCredits');
      expect(keys.sort()).toEqual(registry.publicKeys().sort());
    });

    it('masks secret values but reports whether they are configured', async () => {
      const rows = await settingsService.getForAdmin('monetization.paypal');
      const secret = rows.find((row) => row.key === 'paypal.clientSecret');
      expect(secret.value).toBeUndefined();
      expect(secret.configured).toBe(false);
    });

    it('flags which values still sit at their default', async () => {
      await settingsService.update({ 'credits.perUsd': 250 });
      settingsService.clearCache();
      const rows = await settingsService.getForAdmin('monetization.general');
      expect(rows.find((row) => row.key === 'credits.perUsd').isDefault).toBe(false);
      expect(rows.find((row) => row.key === 'credits.labelPlural').isDefault).toBe(true);
    });
  });

  describe('environment overrides', () => {
    afterEach(() => {
      delete process.env.PAYPAL_CLIENT_SECRET;
      settingsService.clearCache();
    });

    it('takes a secret from the environment over the stored value', async () => {
      process.env.PAYPAL_CLIENT_SECRET = 'from-env';
      settingsService.clearCache();
      const rows = await settingsService.getForAdmin('monetization.paypal');
      expect(rows.find((row) => row.key === 'paypal.clientSecret').configured).toBe(true);
      // and it is still never returned
      expect(rows.find((row) => row.key === 'paypal.clientSecret').value).toBeUndefined();
    });
  });
});

// A document written before `values` became an array casts into a single
// keyless subdocument. Reading it looks fine; every save after that dies with
// "Path `key` is required." — so the settings page loads and saving is
// permanently broken, pointing at nothing the admin did.
describe('legacy settings documents', () => {
  const writeRaw = (values) =>
    AppSettings.collection.insertOne({ singleton: true, values, version: 1, createdAt: new Date(), updatedAt: new Date() });

  it('recovers settings stored in the old object shape', async () => {
    await AppSettings.deleteMany({});
    await writeRaw({ 'credits.perUsd': 250, 'store.enabled': true });
    settingsService.clearCache();

    // The repair happens on read, so nothing needs running by hand.
    const doc = await AppSettings.getDoc();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.getValue('credits.perUsd')).toBe(250);
    expect(doc.getValue('store.enabled')).toBe(true);

    // And the values survive into the service, rather than being dropped.
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(250);
  });

  it('lets a save succeed again after the repair', async () => {
    await AppSettings.deleteMany({});
    await writeRaw({ 'credits.perUsd': 250 });
    settingsService.clearCache();

    // This is the exact failure: PATCH /api/admin/config returning
    // 400 "Path `key` is required."
    await expect(settingsService.update({ 'store.enabled': true })).resolves.toBeTruthy();
    settingsService.clearCache();
    expect(await settingsService.get('store.enabled')).toBe(true);
    expect(await settingsService.get('credits.perUsd')).toBe(250);
  });

  it('drops keyless rows rather than letting one block every save', async () => {
    await AppSettings.deleteMany({});
    await writeRaw([{ value: 9 }, { key: 'credits.perUsd', value: 150 }]);
    settingsService.clearCache();

    const doc = await AppSettings.getDoc();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.getValue('credits.perUsd')).toBe(150);
  });

  it('leaves a healthy document alone', async () => {
    await AppSettings.deleteMany({});
    await writeRaw([{ key: 'credits.perUsd', value: 150 }]);
    settingsService.clearCache();

    const doc = await AppSettings.getDoc();
    expect(doc.values).toHaveLength(1);
    expect(doc.getValue('credits.perUsd')).toBe(150);
  });
});
