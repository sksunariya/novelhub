const { generateOtp, hashOtp, compareOtp, otpExpiry } = require('../src/utils/otp');

describe('otp util', () => {
  it('generates a 6-digit numeric code', () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('hashes a code and verifies it, rejecting a different code', async () => {
    const code = generateOtp();
    const wrong = code === '111111' ? '222222' : '111111';
    const hash = await hashOtp(code);
    expect(hash).not.toBe(code);
    expect(await compareOtp(code, hash)).toBe(true);
    expect(await compareOtp(wrong, hash)).toBe(false);
  });

  it('returns a future expiry based on OTP_TTL_MINUTES', () => {
    process.env.OTP_TTL_MINUTES = '10';
    const expiry = otpExpiry();
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });
});
