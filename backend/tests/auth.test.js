const { api, createUser, createAdmin } = require('./helpers');
const SiteSettings = require('../src/models/SiteSettings');

describe('Auth', () => {
  const signupPayload = { username: 'reader1', email: 'reader1@test.com', password: 'password123', fullName: 'Reader One' };

  describe('POST /api/auth/signup', () => {
    it('creates a user and returns a token', async () => {
      const res = await api().post('/api/auth/signup').send(signupPayload);
      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('reader1');
      expect(res.body.user.role).toBe('user');
    });

    it('rejects duplicate email', async () => {
      await api().post('/api/auth/signup').send(signupPayload);
      const res = await api().post('/api/auth/signup').send({ ...signupPayload, username: 'other' });
      expect(res.status).toBe(409);
    });

    it('rejects missing fields', async () => {
      const res = await api().post('/api/auth/signup').send({ email: 'a@test.com' });
      expect(res.status).toBe(400);
    });

    it('rejects signup when disabled in settings', async () => {
      const settings = await SiteSettings.getSettings();
      settings.allowSignups = false;
      await settings.save();
      const res = await api().post('/api/auth/signup').send(signupPayload);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials', async () => {
      await api().post('/api/auth/signup').send(signupPayload);
      const res = await api().post('/api/auth/login').send({ email: signupPayload.email, password: signupPayload.password });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('rejects wrong password', async () => {
      await api().post('/api/auth/signup').send(signupPayload);
      const res = await api().post('/api/auth/login').send({ email: signupPayload.email, password: 'wrongpass' });
      expect(res.status).toBe(401);
    });

    it('rejects banned user', async () => {
      const { user } = await createUser({ banned: true, password: 'password123' });
      const res = await api().post('/api/auth/login').send({ email: user.email, password: 'password123' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user with valid token', async () => {
      const { user, token } = await createUser();
      const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(user.username);
    });

    it('rejects missing token', async () => {
      const res = await api().get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects invalid token', async () => {
      const res = await api().get('/api/auth/me').set('Authorization', 'Bearer invalid');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/auth/profile', () => {
    it('updates username, fullName, and password', async () => {
      const { token } = await createUser({ password: 'password123' });
      const res = await api()
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'newname', fullName: 'New Full Name', currentPassword: 'password123', newPassword: 'newpass456' });
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('newname');
      expect(res.body.user.fullName).toBe('New Full Name');
      const login = await api().post('/api/auth/login').send({ email: res.body.user.email, password: 'newpass456' });
      expect(login.status).toBe(200);
      expect(login.body.user.fullName).toBe('New Full Name');
    });

    it('rejects password change with wrong current password', async () => {
      const { token } = await createUser({ password: 'password123' });
      const res = await api()
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'wrong', newPassword: 'newpass456' });
      expect(res.status).toBe(401);
    });
  });

  describe('admin access control', () => {
    it('blocks non-admin from admin routes', async () => {
      const { token } = await createUser();
      const res = await api().get('/api/admin/stats').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('allows admin on admin routes', async () => {
      const { token } = await createAdmin();
      const res = await api().get('/api/admin/stats').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });
});
