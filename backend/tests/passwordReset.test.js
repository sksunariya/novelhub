jest.mock('../src/utils/mailer', () => {
  const sent = [];
  return {
    __sent: sent,
    isMailerConfigured: jest.fn(() => true),
    sendOtpEmail: jest.fn(async (msg) => { sent.push(msg); }),
  };
});

const mailer = require('../src/utils/mailer');
const { api, createUser } = require('./helpers');
const User = require('../src/models/User');
const PasswordResetCode = require('../src/models/PasswordResetCode');

const codeFor = (email) => [...mailer.__sent].reverse().find((m) => m.to === email.toLowerCase())?.code;

beforeEach(() => {
  mailer.__sent.length = 0;
  mailer.sendOtpEmail.mockClear();
  mailer.isMailerConfigured.mockReturnValue(true);
});

describe('Forgot / reset password', () => {
  it('returns generic 200 and sends nothing for an unknown email', async () => {
    const res = await api().post('/api/auth/forgot-password').send({ email: 'nobody@test.com' });
    expect(res.status).toBe(200);
    expect(mailer.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('sends a code for a known email', async () => {
    const { user } = await createUser({ email: 'reset@test.com', password: 'password123' });
    const res = await api().post('/api/auth/forgot-password').send({ email: user.email });
    expect(res.status).toBe(200);
    expect(codeFor(user.email)).toMatch(/^\d{6}$/);
  });

  it('resets the password with a valid code', async () => {
    const { user } = await createUser({ email: 'reset2@test.com', password: 'password123' });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const res = await api()
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: codeFor(user.email), newPassword: 'brandnew123' });
    expect(res.status).toBe(200);
    const oldLogin = await api().post('/api/auth/login').send({ email: user.email, password: 'password123' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api().post('/api/auth/login').send({ email: user.email, password: 'brandnew123' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong code', async () => {
    const { user } = await createUser({ email: 'reset3@test.com', password: 'password123' });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const res = await api()
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: '000000', newPassword: 'brandnew123' });
    expect(res.status).toBe(400);
  });

  it('rejects an expired code', async () => {
    const { user } = await createUser({ email: 'reset4@test.com', password: 'password123' });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    await PasswordResetCode.updateOne({ email: user.email }, { expiresAt: new Date(Date.now() - 1000) });
    const res = await api()
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: codeFor(user.email), newPassword: 'brandnew123' });
    expect(res.status).toBe(400);
  });

  it('lets a google-only account set a password via reset', async () => {
    const user = await User.create({ username: 'googleonly', email: 'g-only@test.com', googleId: 'sub-1' });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const res = await api()
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: codeFor(user.email), newPassword: 'brandnew123' });
    expect(res.status).toBe(200);
    const login = await api().post('/api/auth/login').send({ email: user.email, password: 'brandnew123' });
    expect(login.status).toBe(200);
  });
});
