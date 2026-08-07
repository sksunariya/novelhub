jest.mock('google-auth-library', () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn(() => ({ verifyIdToken })),
    __verifyIdToken: verifyIdToken,
  };
});

const { __verifyIdToken } = require('google-auth-library');
const { api, createUser } = require('./helpers');
const User = require('../src/models/User');
const SiteSettings = require('../src/models/SiteSettings');

const GOOGLE_PAYLOAD = {
  sub: 'google-sub-123',
  email: 'googler@test.com',
  email_verified: true,
  name: 'Google Reader',
  picture: 'https://lh3.example.com/photo.jpg',
};

const mockGooglePayload = (payload) => {
  __verifyIdToken.mockResolvedValue({ getPayload: () => payload });
};

describe('POST /api/auth/google', () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  });

  beforeEach(() => {
    __verifyIdToken.mockReset();
  });

  it('creates a new user from a google credential', async () => {
    mockGooglePayload(GOOGLE_PAYLOAD);
    const res = await api().post('/api/auth/google').send({ credential: 'valid-token' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(GOOGLE_PAYLOAD.email);
    expect(res.body.user.fullName).toBe(GOOGLE_PAYLOAD.name);
    const user = await User.findOne({ email: GOOGLE_PAYLOAD.email });
    expect(user.googleId).toBe(GOOGLE_PAYLOAD.sub);
    expect(user.avatarUrl).toBe(GOOGLE_PAYLOAD.picture);
    expect(user.fullName).toBe(GOOGLE_PAYLOAD.name);
  });

  it('links google to an existing account with the same email', async () => {
    const { user } = await createUser({ email: GOOGLE_PAYLOAD.email, password: 'password123' });
    mockGooglePayload(GOOGLE_PAYLOAD);
    const res = await api().post('/api/auth/google').send({ credential: 'valid-token' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(user.username);
    expect(res.body.user.fullName).toBe(GOOGLE_PAYLOAD.name);
    const updated = await User.findById(user._id);
    expect(updated.googleId).toBe(GOOGLE_PAYLOAD.sub);
    expect(updated.fullName).toBe(GOOGLE_PAYLOAD.name);
  });

  it('logs in a returning google user without duplicating accounts', async () => {
    mockGooglePayload(GOOGLE_PAYLOAD);
    await api().post('/api/auth/google').send({ credential: 'valid-token' });
    await api().post('/api/auth/google').send({ credential: 'valid-token' });
    expect(await User.countDocuments({ email: GOOGLE_PAYLOAD.email })).toBe(1);
  });

  it('rejects an invalid credential', async () => {
    __verifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await api().post('/api/auth/google').send({ credential: 'bad-token' });
    expect(res.status).toBe(401);
  });

  it('rejects unverified email', async () => {
    mockGooglePayload({ ...GOOGLE_PAYLOAD, email_verified: false });
    const res = await api().post('/api/auth/google').send({ credential: 'valid-token' });
    expect(res.status).toBe(401);
  });

  it('rejects new google users when signups are disabled', async () => {
    const settings = await SiteSettings.getSettings();
    settings.allowSignups = false;
    await settings.save();
    mockGooglePayload(GOOGLE_PAYLOAD);
    const res = await api().post('/api/auth/google').send({ credential: 'valid-token' });
    expect(res.status).toBe(403);
  });

  it('rejects banned google users', async () => {
    mockGooglePayload(GOOGLE_PAYLOAD);
    await api().post('/api/auth/google').send({ credential: 'valid-token' });
    await User.updateOne({ email: GOOGLE_PAYLOAD.email }, { banned: true });
    const res = await api().post('/api/auth/google').send({ credential: 'valid-token' });
    expect(res.status).toBe(403);
  });

  it('rejects password login for a google-only account', async () => {
    mockGooglePayload(GOOGLE_PAYLOAD);
    await api().post('/api/auth/google').send({ credential: 'valid-token' });
    const res = await api().post('/api/auth/login').send({ email: GOOGLE_PAYLOAD.email, password: 'anything123' });
    expect(res.status).toBe(401);
  });

  it('lets a google-only account set a password without current password', async () => {
    mockGooglePayload(GOOGLE_PAYLOAD);
    const { body } = await api().post('/api/auth/google').send({ credential: 'valid-token' });
    const res = await api()
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${body.token}`)
      .send({ newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    const login = await api().post('/api/auth/login').send({ email: GOOGLE_PAYLOAD.email, password: 'newpass123' });
    expect(login.status).toBe(200);
  });
});
