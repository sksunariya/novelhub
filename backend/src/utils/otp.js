const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const hashOtp = (code) => bcrypt.hash(code, 10);

const compareOtp = (code, hash) => bcrypt.compare(code, hash);

const otpTtlMinutes = () => Number(process.env.OTP_TTL_MINUTES) || 10;

const otpExpiry = () => new Date(Date.now() + otpTtlMinutes() * 60 * 1000);

module.exports = { generateOtp, hashOtp, compareOtp, otpExpiry, otpTtlMinutes };
