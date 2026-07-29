const mongoose = require('mongoose');
const PendingSignup = require('../src/models/PendingSignup');
const PasswordResetCode = require('../src/models/PasswordResetCode');

describe('OTP persistence models', () => {
  it('creates a PendingSignup with defaults', async () => {
    const doc = await PendingSignup.create({
      email: 'p@test.com',
      username: 'pender',
      passwordHash: 'hash',
      codeHash: 'codehash',
      expiresAt: new Date(Date.now() + 10000),
    });
    expect(doc.attempts).toBe(0);
    expect(doc.lastSentAt).toBeInstanceOf(Date);
  });

  it('enforces one PasswordResetCode per user', async () => {
    await PasswordResetCode.init();
    const userId = new mongoose.Types.ObjectId();
    await PasswordResetCode.create({ user: userId, email: 'r@test.com', codeHash: 'c1', expiresAt: new Date(Date.now() + 10000) });
    await expect(
      PasswordResetCode.create({ user: userId, email: 'r@test.com', codeHash: 'c2', expiresAt: new Date(Date.now() + 10000) })
    ).rejects.toThrow();
  });
});
