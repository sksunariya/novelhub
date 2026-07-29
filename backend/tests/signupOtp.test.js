jest.mock('../src/utils/mailer', () => {
  const sent = [];
  return {
    __sent: sent,
    isMailerConfigured: jest.fn(() => true),
    sendOtpEmail: jest.fn(async (msg) => { sent.push(msg); }),
  };
});

const mailer = require('../src/utils/mailer');
const { api } = require('./helpers');
const User = require('../src/models/User');
const PendingSignup = require('../src/models/PendingSignup');
const SiteSettings = require('../src/models/SiteSettings');

const payload = { username: 'otpuser', email: 'otp@test.com', password: 'password123' };
const codeFor = (email) => [...mailer.__sent].reverse().find((m) => m.to === email.toLowerCase())?.code;
const enableVerification = async () => {
  const s = await SiteSettings.getSettings();
  s.requireEmailVerification = true;
  await s.save();
};

beforeEach(() => {
  mailer.__sent.length = 0;
  mailer.sendOtpEmail.mockClear();
  mailer.isMailerConfigured.mockReturnValue(true);
});

describe('Signup OTP — signup phase', () => {
  it('returns a token directly when verification is off', async () => {
    const res = await api().post('/api/auth/signup').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(mailer.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('holds the account as pending when verification is on', async () => {
    await enableVerification();
    const res = await api().post('/api/auth/signup').send(payload);
    expect(res.status).toBe(202);
    expect(res.body.pendingVerification).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(await User.countDocuments({ email: payload.email })).toBe(0);
    expect(await PendingSignup.countDocuments({ email: payload.email })).toBe(1);
    expect(codeFor(payload.email)).toMatch(/^\d{6}$/);
  });

  it('returns 503 when verification is on but mailer is unconfigured', async () => {
    await enableVerification();
    mailer.isMailerConfigured.mockReturnValue(false);
    const res = await api().post('/api/auth/signup').send(payload);
    expect(res.status).toBe(503);
    expect(await PendingSignup.countDocuments({ email: payload.email })).toBe(0);
  });
});

describe('Signup OTP — verify & resend', () => {
  const start = async () => {
    await enableVerification();
    await api().post('/api/auth/signup').send(payload);
  };

  it('creates the user when the correct code is submitted', async () => {
    await start();
    const res = await api().post('/api/auth/signup/verify').send({ email: payload.email, code: codeFor(payload.email) });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(await User.countDocuments({ email: payload.email })).toBe(1);
    expect(await PendingSignup.countDocuments({ email: payload.email })).toBe(0);
    const login = await api().post('/api/auth/login').send({ email: payload.email, password: payload.password });
    expect(login.status).toBe(200);
  });

  it('rejects a wrong code and increments attempts', async () => {
    await start();
    const wrong = codeFor(payload.email) === '000000' ? '111111' : '000000';
    const res = await api().post('/api/auth/signup/verify').send({ email: payload.email, code: wrong });
    expect(res.status).toBe(400);
    const pending = await PendingSignup.findOne({ email: payload.email });
    expect(pending.attempts).toBe(1);
  });

  it('locks out after 5 failed attempts', async () => {
    await start();
    const real = codeFor(payload.email);
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/auth/signup/verify').send({ email: payload.email, code: wrong });
    }
    const res = await api().post('/api/auth/signup/verify').send({ email: payload.email, code: real });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ email: payload.email })).toBe(0);
  });

  it('rejects an expired code', async () => {
    await start();
    await PendingSignup.updateOne({ email: payload.email }, { expiresAt: new Date(Date.now() - 1000) });
    const res = await api().post('/api/auth/signup/verify').send({ email: payload.email, code: codeFor(payload.email) });
    expect(res.status).toBe(400);
  });

  it('enforces the resend cooldown then issues a new working code', async () => {
    await start();
    const tooSoon = await api().post('/api/auth/signup/resend').send({ email: payload.email });
    expect(tooSoon.status).toBe(429);
    await PendingSignup.updateOne({ email: payload.email }, { lastSentAt: new Date(Date.now() - 61 * 1000) });
    const resent = await api().post('/api/auth/signup/resend').send({ email: payload.email });
    expect(resent.status).toBe(200);
    const verify = await api().post('/api/auth/signup/verify').send({ email: payload.email, code: codeFor(payload.email) });
    expect(verify.status).toBe(201);
  });
});
