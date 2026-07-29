const { api, createAdmin } = require('./helpers');

describe('requireEmailVerification setting', () => {
  it('defaults to false and is toggled by admin', async () => {
    const { token } = await createAdmin();
    const before = await api().get('/api/admin/settings').set('Authorization', `Bearer ${token}`);
    expect(before.body.settings.requireEmailVerification).toBe(false);
    const updated = await api()
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .field('requireEmailVerification', 'true');
    expect(updated.status).toBe(200);
    expect(updated.body.settings.requireEmailVerification).toBe(true);
  });

  it('is exposed in public settings', async () => {
    const res = await api().get('/api/settings');
    expect(res.body.settings.requireEmailVerification).toBe(false);
  });
});
