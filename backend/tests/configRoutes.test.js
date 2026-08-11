const { api, createAdmin, createUser } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const AdminAuditLog = require('../src/models/AdminAuditLog');

let adminToken;

beforeEach(async () => {
  settingsService.clearCache();
  ({ token: adminToken } = await createAdmin());
});

const auth = (req) => req.set('Authorization', `Bearer ${adminToken}`);

describe('admin config routes', () => {
  it('requires an admin', async () => {
    const { token } = await createUser();
    await api().get('/api/admin/config').set('Authorization', `Bearer ${token}`).expect(403);
    await api().get('/api/admin/config').expect(401);
  });

  it('returns registry metadata without values', async () => {
    const res = await auth(api().get('/api/admin/config/registry')).expect(200);
    expect(res.body.sections).toContain('monetization.general');
    const def = res.body.settings.find((row) => row.key === 'credits.perUsd');
    expect(def).toMatchObject({ type: 'integer', min: 1, requiresConfirmation: true, impact: 'revalueBalances' });
    expect(def.value).toBeUndefined();
  });

  it('reads a single section', async () => {
    const res = await auth(api().get('/api/admin/config?section=monetization.general')).expect(200);
    expect(res.body.section).toBe('monetization.general');
    expect(res.body.settings.every((row) => row.section === 'monetization.general')).toBe(true);
    expect(res.body.settings.find((row) => row.key === 'credits.perUsd').value).toBe(100);
  });

  it('404s an unknown section', async () => {
    await auth(api().get('/api/admin/config?section=monetization.nope')).expect(404);
  });

  it('does not treat the static config paths as sections', async () => {
    await auth(api().get('/api/admin/config/registry')).expect(200);
    await auth(api().get('/api/admin/config/search?q=credit')).expect(200);
    await auth(api().get('/api/admin/config/audit')).expect(200);
  });

  it('patches settings and reports what changed', async () => {
    const res = await auth(api().patch('/api/admin/config'))
      .send({ settings: { 'credits.perUsd': 250, 'monetization.enabled': true } })
      .expect(200);
    expect(res.body.changed).toBe(2);
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(250);
  });

  it('returns per-field errors on an invalid patch', async () => {
    const res = await auth(api().patch('/api/admin/config'))
      .send({ settings: { 'credits.perUsd': 0, 'pricing.gateStacking': 'nope' } })
      .expect(400);
    expect(res.body.errors['credits.perUsd']).toMatch(/at least 1/);
    expect(res.body.errors['pricing.gateStacking']).toMatch(/must be one of/);
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(100);
  });

  it('rejects writing a secret over the API', async () => {
    const res = await auth(api().patch('/api/admin/config'))
      .send({ settings: { 'paypal.clientSecret': 'nope' } })
      .expect(400);
    expect(res.body.errors['paypal.clientSecret']).toMatch(/environment/);
  });

  it('rejects an empty patch', async () => {
    await auth(api().patch('/api/admin/config')).send({ settings: {} }).expect(400);
  });

  it('resets keys to defaults', async () => {
    await auth(api().patch('/api/admin/config')).send({ settings: { 'credits.perUsd': 250 } }).expect(200);
    await auth(api().post('/api/admin/config/reset')).send({ keys: ['credits.perUsd'] }).expect(200);
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(100);
  });

  it('rejects a reset with no keys', async () => {
    await auth(api().post('/api/admin/config/reset')).send({ keys: [] }).expect(400);
  });

  it('searches settings by label and key', async () => {
    const res = await auth(api().get('/api/admin/config/search?q=trending')).expect(200);
    expect(res.body.results.some((row) => row.key === 'ranking.trendingWindowDays')).toBe(true);
    const empty = await auth(api().get('/api/admin/config/search?q=')).expect(200);
    expect(empty.body.results).toEqual([]);
  });

  it('never returns a secret value from search', async () => {
    const res = await auth(api().get('/api/admin/config/search?q=secret')).expect(200);
    const row = res.body.results.find((entry) => entry.key === 'paypal.clientSecret');
    if (row) expect(row.value).toBeUndefined();
  });

  it('exposes the audit trail with the actor populated', async () => {
    await auth(api().patch('/api/admin/config')).send({ settings: { 'credits.perUsd': 250 } }).expect(200);
    const res = await auth(api().get('/api/admin/config/audit')).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.entries[0].changes[0]).toMatchObject({ key: 'credits.perUsd', before: 100, after: 250 });
    expect(res.body.entries[0].actor.username).toBeDefined();
  });

  it('filters the audit trail by key', async () => {
    await auth(api().patch('/api/admin/config')).send({ settings: { 'credits.perUsd': 250 } }).expect(200);
    await auth(api().patch('/api/admin/config'))
      .send({ settings: { 'pricing.defaultChapterCredits': 15 } })
      .expect(200);
    const res = await auth(api().get('/api/admin/config/audit?key=credits.perUsd')).expect(200);
    expect(res.body.total).toBe(1);
  });

  it('keeps audit entries immutable', async () => {
    await auth(api().patch('/api/admin/config')).send({ settings: { 'credits.perUsd': 250 } }).expect(200);
    const entry = await AdminAuditLog.findOne();
    await expect(AdminAuditLog.updateOne({ _id: entry._id }, { note: 'tampered' })).rejects.toThrow(/immutable/);
  });
});

describe('public settings', () => {
  it('includes public config and excludes secrets', async () => {
    const res = await api().get('/api/settings').expect(200);
    expect(res.body.config['credits.perUsd']).toBe(100);
    expect(res.body.config['paypal.clientSecret']).toBeUndefined();
    expect(res.body.config['grants.approvalThresholdCredits']).toBeUndefined();
    // existing shape is untouched
    expect(res.body.settings.siteName).toBeDefined();
  });

  it('reflects an admin change', async () => {
    await auth(api().patch('/api/admin/config')).send({ settings: { 'credits.perUsd': 250 } }).expect(200);
    settingsService.clearCache();
    const res = await api().get('/api/settings').expect(200);
    expect(res.body.config['credits.perUsd']).toBe(250);
  });
});
