# Email OTP Signup + Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email OTP verification to email/password signup and an OTP-based forgot-password flow to NovelHub.

**Architecture:** A new nodemailer-backed mailer utility and an OTP helper support two short-lived Mongoose collections (`PendingSignup`, `PasswordResetCode`) with TTL auto-purge. Signup becomes gated by a `requireEmailVerification` Site Settings toggle (default off): when off it behaves exactly as today; when on it holds the account in `PendingSignup` until a 6-digit code is verified. Forgot-password issues a reset code and is enumeration-safe. The React frontend gains a two-phase signup and a forgot-password page.

**Tech Stack:** Node.js, Express, Mongoose, bcryptjs, jsonwebtoken, nodemailer (new); React (Vite), axios, framer-motion, lucide-react; Jest + Supertest + mongodb-memory-server.

## Global Constraints

- Backend controllers use `asyncHandler` from `src/middlewares/errorHandler.js`; thrown Mongo duplicate-key errors (`code 11000`) become `409`, `ValidationError` becomes `400` automatically.
- Passwords are hashed with `bcryptjs` (cost 10). OTP codes are 6-digit numeric strings, hashed at rest with bcryptjs; plaintext codes appear only in outbound email.
- OTP validity and record TTL = `OTP_TTL_MINUTES` env (default `10`). Resend cooldown = 60s. Max verify attempts = 5.
- `requireEmailVerification` Site Settings flag defaults to **false** so existing dev setups and the current Jest suite keep working with zero email config.
- Email normalization: always compare/store `email.toLowerCase()`.
- Backend tests run with `npm test` (from `backend/`). Frontend has no test runner; its gate is `npm run build` (from `frontend/`) plus manual verification.
- Follow existing code style: 2-space indent, single quotes, CommonJS on the backend, ES modules + Tailwind classes on the frontend. Reuse existing Tailwind class patterns (`inputClass`, `PageTransition`, crimson/silver theme).

---

## File Structure

**Backend — create:**
- `backend/src/utils/otp.js` — OTP generate/hash/compare/expiry helpers.
- `backend/src/utils/mailer.js` — nodemailer transport + `isMailerConfigured` + `sendOtpEmail`.
- `backend/src/models/PendingSignup.js` — pending-signup collection (TTL).
- `backend/src/models/PasswordResetCode.js` — reset-code collection (TTL).
- `backend/tests/otp.test.js`, `backend/tests/mailer.test.js`, `backend/tests/otpModels.test.js`, `backend/tests/userModel.test.js`, `backend/tests/signupOtp.test.js`, `backend/tests/passwordReset.test.js`, `backend/tests/settingsVerification.test.js`.

**Backend — modify:**
- `backend/src/models/User.js` — guard pre-save hook with `$locals.passwordAlreadyHashed`.
- `backend/src/models/SiteSettings.js` — add `requireEmailVerification`.
- `backend/src/controllers/settingsController.js` — expose flag in public settings.
- `backend/src/controllers/adminController.js` — persist flag in `updateSettings`.
- `backend/src/controllers/authController.js` — modify `signup`; add `verifySignup`, `resendSignupOtp`, `forgotPassword`, `resetPassword`.
- `backend/src/routes/authRoutes.js` — register the 4 new routes.
- `backend/package.json` — add `nodemailer`.
- `backend/.env.example`, `README.md` — document new env + feature.

**Frontend — create:**
- `frontend/src/pages/ForgotPassword.jsx`.

**Frontend — modify:**
- `frontend/src/context/AuthContext.jsx` — `signup` returns data; add `verifySignup`, `resendSignupOtp`.
- `frontend/src/pages/Signup.jsx` — two-phase (form → OTP).
- `frontend/src/pages/Login.jsx` — "Forgot password?" link.
- `frontend/src/App.jsx` — `/forgot-password` route.

---

## Task 1: OTP helper utility

**Files:**
- Create: `backend/src/utils/otp.js`
- Test: `backend/tests/otp.test.js`

**Interfaces:**
- Consumes: `bcryptjs`, `crypto` (node builtin).
- Produces:
  - `generateOtp() → string` (6-digit numeric)
  - `hashOtp(code: string) → Promise<string>`
  - `compareOtp(code: string, hash: string) → Promise<boolean>`
  - `otpExpiry() → Date` (now + `OTP_TTL_MINUTES`, default 10)

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/otp.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/otp.test.js`
Expected: FAIL — cannot find module `../src/utils/otp`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/utils/otp.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const hashOtp = (code) => bcrypt.hash(code, 10);

const compareOtp = (code, hash) => bcrypt.compare(code, hash);

const otpTtlMinutes = () => Number(process.env.OTP_TTL_MINUTES) || 10;

const otpExpiry = () => new Date(Date.now() + otpTtlMinutes() * 60 * 1000);

module.exports = { generateOtp, hashOtp, compareOtp, otpExpiry, otpTtlMinutes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/otp.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/otp.js backend/tests/otp.test.js
git commit -m "feat(auth): add OTP generate/hash/compare helper"
```

---

## Task 2: Mailer utility + nodemailer dependency + env

**Files:**
- Create: `backend/src/utils/mailer.js`
- Test: `backend/tests/mailer.test.js`
- Modify: `backend/package.json`, `backend/.env.example`

**Interfaces:**
- Consumes: `nodemailer`, env `SMTP_*`, `MAIL_FROM`, `OTP_TTL_MINUTES`.
- Produces:
  - `isMailerConfigured() → boolean` (true when `SMTP_HOST` set)
  - `sendOtpEmail({ to: string, code: string, purpose: 'signup' | 'password_reset' }) → Promise<void>`

- [ ] **Step 1: Install nodemailer**

Run: `cd backend && npm install nodemailer`
Expected: `nodemailer` appears in `backend/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```js
// backend/tests/mailer.test.js
describe('mailer util', () => {
  const original = process.env.SMTP_HOST;
  afterEach(() => {
    if (original === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = original;
  });

  it('reports not configured without SMTP_HOST', () => {
    delete process.env.SMTP_HOST;
    const { isMailerConfigured } = require('../src/utils/mailer');
    expect(isMailerConfigured()).toBe(false);
  });

  it('reports configured with SMTP_HOST', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const { isMailerConfigured } = require('../src/utils/mailer');
    expect(isMailerConfigured()).toBe(true);
  });

  it('logs the code instead of sending when unconfigured', async () => {
    delete process.env.SMTP_HOST;
    const { sendOtpEmail } = require('../src/utils/mailer');
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    await expect(sendOtpEmail({ to: 'a@b.com', code: '123456', purpose: 'signup' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest tests/mailer.test.js`
Expected: FAIL — cannot find module `../src/utils/mailer`.

- [ ] **Step 4: Write minimal implementation**

```js
// backend/src/utils/mailer.js
const nodemailer = require('nodemailer');

let transport;

const isMailerConfigured = () => Boolean(process.env.SMTP_HOST);

const getTransport = () => {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transport;
};

const SUBJECTS = {
  signup: 'Verify your email',
  password_reset: 'Reset your password',
};

const bodyText = (code, purpose) => {
  const action = purpose === 'password_reset' ? 'reset your password' : 'verify your email';
  const minutes = Number(process.env.OTP_TTL_MINUTES) || 10;
  return `Your code to ${action} is ${code}. It expires in ${minutes} minutes.`;
};

const sendOtpEmail = async ({ to, code, purpose }) => {
  if (!isMailerConfigured()) {
    console.info(`[mailer] (${purpose}) code for ${to}: ${code}`);
    return;
  }
  const text = bodyText(code, purpose);
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || 'Apex NovelHub <no-reply@novelhub.com>',
    to,
    subject: SUBJECTS[purpose] || 'Your code',
    text,
    html: `<p>${text}</p>`,
  });
};

module.exports = { isMailerConfigured, sendOtpEmail };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/mailer.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Append new env vars to `.env.example`**

Add these lines to the end of `backend/.env.example`:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Apex NovelHub <no-reply@novelhub.com>"
OTP_TTL_MINUTES=10
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/mailer.js backend/tests/mailer.test.js backend/package.json backend/package-lock.json backend/.env.example
git commit -m "feat(auth): add nodemailer mailer with console fallback"
```

---

## Task 3: OTP persistence models

**Files:**
- Create: `backend/src/models/PendingSignup.js`, `backend/src/models/PasswordResetCode.js`
- Test: `backend/tests/otpModels.test.js`

**Interfaces:**
- Produces:
  - `PendingSignup` model — fields `{ email, username, passwordHash, codeHash, expiresAt, attempts, lastSentAt }`, unique `email`, TTL on `expiresAt`.
  - `PasswordResetCode` model — fields `{ user, email, codeHash, expiresAt, attempts, lastSentAt }`, unique `user`, TTL on `expiresAt`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/otpModels.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/otpModels.test.js`
Expected: FAIL — cannot find module `../src/models/PendingSignup`.

- [ ] **Step 3: Write the models**

```js
// backend/src/models/PendingSignup.js
const mongoose = require('mongoose');

const pendingSignupSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true },
    passwordHash: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingSignup', pendingSignupSchema);
```

```js
// backend/src/models/PasswordResetCode.js
const mongoose = require('mongoose');

const passwordResetCodeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

passwordResetCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordResetCode', passwordResetCodeSchema);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/otpModels.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/PendingSignup.js backend/src/models/PasswordResetCode.js backend/tests/otpModels.test.js
git commit -m "feat(auth): add PendingSignup and PasswordResetCode models"
```

---

## Task 4: User model — guard pre-save against double-hash

**Files:**
- Modify: `backend/src/models/User.js:26-30`
- Test: `backend/tests/userModel.test.js`

**Interfaces:**
- Produces: setting `user.$locals.passwordAlreadyHashed = true` before `save()` stores the assigned `password` string verbatim (no re-hash). Default behavior (flag absent) still hashes plaintext.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/userModel.test.js
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

describe('User password hashing', () => {
  it('hashes a plaintext password on save by default', async () => {
    const user = await User.create({ username: 'plainuser', email: 'plain@test.com', password: 'secret123' });
    const stored = await User.findById(user._id).select('+password');
    expect(stored.password).not.toBe('secret123');
    expect(await stored.comparePassword('secret123')).toBe(true);
  });

  it('stores an already-hashed password verbatim when flagged', async () => {
    const preHash = await bcrypt.hash('secret123', 10);
    const user = new User({ username: 'preuser', email: 'pre@test.com' });
    user.password = preHash;
    user.$locals.passwordAlreadyHashed = true;
    await user.save();
    const stored = await User.findById(user._id).select('+password');
    expect(stored.password).toBe(preHash);
    expect(await stored.comparePassword('secret123')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/userModel.test.js`
Expected: FAIL — second test fails; `stored.password` is a re-hash of the bcrypt hash, so `comparePassword('secret123')` is `false`.

- [ ] **Step 3: Modify the pre-save hook**

In `backend/src/models/User.js`, replace the hook at lines 26-30:

```js
userSchema.pre('save', async function () {
  if (this.isModified('password') && !this.$locals.passwordAlreadyHashed) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/userModel.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/User.js backend/tests/userModel.test.js
git commit -m "feat(auth): let User store a pre-hashed password without re-hashing"
```

---

## Task 5: Site Settings `requireEmailVerification` toggle

**Files:**
- Modify: `backend/src/models/SiteSettings.js:32-33`, `backend/src/controllers/settingsController.js:17-18`, `backend/src/controllers/adminController.js:435-437`
- Test: `backend/tests/settingsVerification.test.js`

**Interfaces:**
- Produces: `SiteSettings.requireEmailVerification: boolean` (default `false`); returned by both `GET /api/admin/settings` and `GET /api/settings`; writable via `PUT /api/admin/settings` field `requireEmailVerification`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/settingsVerification.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/settingsVerification.test.js`
Expected: FAIL — `requireEmailVerification` is `undefined`.

- [ ] **Step 3: Add the field to the schema**

In `backend/src/models/SiteSettings.js`, add after the `allowSignups` line (line 32):

```js
    requireEmailVerification: { type: Boolean, default: false },
```

- [ ] **Step 4: Expose it in public settings**

In `backend/src/controllers/settingsController.js`, add inside the returned `settings` object (after `allowSignups: settings.allowSignups,`):

```js
      requireEmailVerification: settings.requireEmailVerification,
```

- [ ] **Step 5: Persist it in admin updateSettings**

In `backend/src/controllers/adminController.js`, add after the `maintenanceMode` block (after line 437):

```js
  if (body.requireEmailVerification !== undefined) {
    settings.requireEmailVerification = body.requireEmailVerification === 'true' || body.requireEmailVerification === true;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx jest tests/settingsVerification.test.js`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/SiteSettings.js backend/src/controllers/settingsController.js backend/src/controllers/adminController.js backend/tests/settingsVerification.test.js
git commit -m "feat(settings): add requireEmailVerification toggle"
```

---

## Task 6: Signup endpoint — gate on verification toggle

**Files:**
- Modify: `backend/src/controllers/authController.js` (imports + `signup` + `module.exports`)
- Test: `backend/tests/signupOtp.test.js` (partial — signup-phase cases)

**Interfaces:**
- Consumes: `PendingSignup`, `PasswordResetCode`, `otp` helpers, `mailer` helpers.
- Produces: `POST /api/auth/signup` behavior:
  - verification off → `201 { token, user }` (unchanged).
  - verification on + mailer configured → `202 { pendingVerification: true, email }`, creates a `PendingSignup`, no `User`.
  - verification on + mailer not configured → `503 { message }`.

- [ ] **Step 1: Add imports to `authController.js`**

At the top of `backend/src/controllers/authController.js`, after the existing requires (line 5), add:

```js
const bcrypt = require('bcryptjs');
const PendingSignup = require('../models/PendingSignup');
const PasswordResetCode = require('../models/PasswordResetCode');
const { generateOtp, hashOtp, compareOtp, otpExpiry } = require('../utils/otp');
const { isMailerConfigured, sendOtpEmail } = require('../utils/mailer');

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
```

- [ ] **Step 2: Write the failing test**

```js
// backend/tests/signupOtp.test.js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest tests/signupOtp.test.js`
Expected: FAIL — the "pending" and "503" cases fail because `signup` still creates the user / returns a token.

- [ ] **Step 4: Replace the `signup` handler**

Replace the existing `signup` function in `backend/src/controllers/authController.js` with:

```js
const signup = asyncHandler(async (req, res) => {
  const settings = await SiteSettings.getSettings();
  if (!settings.allowSignups) {
    return res.status(403).json({ message: 'Signups are currently disabled' });
  }
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'username, email and password are required' });
  }

  if (!settings.requireEmailVerification) {
    const user = await User.create({ username, email, password });
    return res.status(201).json({ token: generateToken(user._id), user: serializeUser(user) });
  }

  if (!isMailerConfigured()) {
    return res.status(503).json({ message: 'Email verification is enabled but email delivery is not configured.' });
  }
  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ message: 'username must be between 3 and 30 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username }] });
  if (existing) {
    return res.status(409).json({ message: 'email or username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await PendingSignup.findOneAndUpdate(
    { email: normalizedEmail },
    { email: normalizedEmail, username, passwordHash, codeHash, expiresAt: otpExpiry(), attempts: 0, lastSentAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await sendOtpEmail({ to: normalizedEmail, code, purpose: 'signup' });
  return res.status(202).json({ pendingVerification: true, email: normalizedEmail });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/signupOtp.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Confirm no regression in existing auth tests**

Run: `cd backend && npx jest tests/auth.test.js`
Expected: PASS (all existing signup/login tests still green — verification defaults off).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/authController.js backend/tests/signupOtp.test.js
git commit -m "feat(auth): gate signup behind email verification toggle"
```

---

## Task 7: Signup verify + resend endpoints

**Files:**
- Modify: `backend/src/controllers/authController.js` (add `verifySignup`, `resendSignupOtp` + exports), `backend/src/routes/authRoutes.js`
- Test: `backend/tests/signupOtp.test.js` (append verify/resend cases)

**Interfaces:**
- Consumes: `PendingSignup`, `otp` helpers, `mailer`, `User` with `$locals.passwordAlreadyHashed`.
- Produces:
  - `POST /api/auth/signup/verify` `{ email, code }` → `201 { token, user }` on success; `400` on bad/expired/exhausted code; `409` if a conflicting user appeared.
  - `POST /api/auth/signup/resend` `{ email }` → `200 { message }`; `429` within cooldown.

- [ ] **Step 1: Append the failing tests**

Append to `backend/tests/signupOtp.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/signupOtp.test.js`
Expected: FAIL — verify/resend routes return 404 (not registered).

- [ ] **Step 3: Add the handlers**

In `backend/src/controllers/authController.js`, add after the `signup` function:

```js
const verifySignup = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ message: 'email and code are required' });
  }
  const normalizedEmail = email.toLowerCase();
  const pending = await PendingSignup.findOne({ email: normalizedEmail });
  if (!pending || pending.expiresAt < new Date()) {
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(400).json({ message: 'Too many attempts. Please request a new code.' });
  }
  const match = await compareOtp(String(code), pending.codeHash);
  if (!match) {
    pending.attempts += 1;
    await pending.save();
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  const conflict = await User.findOne({ $or: [{ email: normalizedEmail }, { username: pending.username }] });
  if (conflict) {
    await PendingSignup.deleteOne({ _id: pending._id });
    return res.status(409).json({ message: 'email or username already exists' });
  }
  const user = new User({ username: pending.username, email: pending.email });
  user.password = pending.passwordHash;
  user.$locals.passwordAlreadyHashed = true;
  await user.save();
  await PendingSignup.deleteOne({ _id: pending._id });
  return res.status(201).json({ token: generateToken(user._id), user: serializeUser(user) });
});

const resendSignupOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'email is required' });
  }
  const normalizedEmail = email.toLowerCase();
  const generic = { message: 'If a pending signup exists, a new code has been sent.' };
  const pending = await PendingSignup.findOne({ email: normalizedEmail });
  if (!pending) {
    return res.status(200).json(generic);
  }
  if (Date.now() - new Date(pending.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ message: 'Please wait before requesting another code.' });
  }
  const code = generateOtp();
  pending.codeHash = await hashOtp(code);
  pending.expiresAt = otpExpiry();
  pending.attempts = 0;
  pending.lastSentAt = new Date();
  await pending.save();
  await sendOtpEmail({ to: normalizedEmail, code, purpose: 'signup' });
  return res.status(200).json(generic);
});
```

Then update the `module.exports` line at the bottom of the file to add the new names:

```js
module.exports = { signup, login, googleAuth, me, updateProfile, serializeUser, verifySignup, resendSignupOtp };
```

- [ ] **Step 4: Register the routes**

In `backend/src/routes/authRoutes.js`, update the import destructure and add routes:

```js
const { signup, login, googleAuth, me, updateProfile, verifySignup, resendSignupOtp } = require('../controllers/authController');
```

Add after `router.post('/signup', signup);`:

```js
router.post('/signup/verify', verifySignup);
router.post('/signup/resend', resendSignupOtp);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/signupOtp.test.js`
Expected: PASS (all 8 cases in the file).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/authController.js backend/src/routes/authRoutes.js backend/tests/signupOtp.test.js
git commit -m "feat(auth): add signup OTP verify and resend endpoints"
```

---

## Task 8: Forgot-password + reset-password endpoints

**Files:**
- Modify: `backend/src/controllers/authController.js` (add `forgotPassword`, `resetPassword` + exports), `backend/src/routes/authRoutes.js`
- Test: `backend/tests/passwordReset.test.js`

**Interfaces:**
- Consumes: `PasswordResetCode`, `otp` helpers, `mailer`, `User`.
- Produces:
  - `POST /api/auth/forgot-password` `{ email }` → always `200 { message }` (enumeration-safe); issues a `PasswordResetCode` + email when the account exists and mailer is configured.
  - `POST /api/auth/reset-password` `{ email, code, newPassword }` → `200 { message }` on success; `400` on bad/expired code or short password.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/passwordReset.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/passwordReset.test.js`
Expected: FAIL — forgot/reset routes return 404.

- [ ] **Step 3: Add the handlers**

In `backend/src/controllers/authController.js`, add after `resendSignupOtp`:

```js
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const generic = { message: 'If an account exists, a reset code has been sent.' };
  if (!email) {
    return res.status(400).json({ message: 'email is required' });
  }
  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user || user.banned) {
    return res.status(200).json(generic);
  }
  if (!isMailerConfigured()) {
    console.warn('[auth] forgot-password requested but mailer is not configured');
    return res.status(200).json(generic);
  }
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await PasswordResetCode.findOneAndUpdate(
    { user: user._id },
    { user: user._id, email: normalizedEmail, codeHash, expiresAt: otpExpiry(), attempts: 0, lastSentAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await sendOtpEmail({ to: normalizedEmail, code, purpose: 'password_reset' });
  return res.status(200).json(generic);
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: 'email, code and newPassword are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  const normalizedEmail = email.toLowerCase();
  const record = await PasswordResetCode.findOne({ email: normalizedEmail });
  if (!record || record.expiresAt < new Date()) {
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(400).json({ message: 'Too many attempts. Please request a new code.' });
  }
  const match = await compareOtp(String(code), record.codeHash);
  if (!match) {
    record.attempts += 1;
    await record.save();
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  const user = await User.findById(record.user).select('+password');
  if (!user) {
    await PasswordResetCode.deleteOne({ _id: record._id });
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  user.password = newPassword;
  await user.save();
  await PasswordResetCode.deleteOne({ _id: record._id });
  return res.status(200).json({ message: 'Password updated' });
});
```

Then update `module.exports` to include both:

```js
module.exports = {
  signup, login, googleAuth, me, updateProfile, serializeUser,
  verifySignup, resendSignupOtp, forgotPassword, resetPassword,
};
```

- [ ] **Step 4: Register the routes**

In `backend/src/routes/authRoutes.js`, add the two names to the destructured import and add:

```js
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/passwordReset.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the FULL backend suite (regression gate)**

Run: `cd backend && npm test`
Expected: PASS — all suites green, including the original `auth.test.js` and `googleAuth.test.js`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/authController.js backend/src/routes/authRoutes.js backend/tests/passwordReset.test.js
git commit -m "feat(auth): add forgot-password and reset-password endpoints"
```

---

## Task 9: Frontend — AuthContext OTP methods

**Files:**
- Modify: `frontend/src/context/AuthContext.jsx`

**Interfaces:**
- Produces (added to the auth context value):
  - `signup(username, email, password) → Promise<data>` — returns the raw response `data`; sets token/user only if `data.token` is present.
  - `verifySignup(email, code) → Promise<user>` — sets token/user.
  - `resendSignupOtp(email) → Promise<AxiosResponse>`.

- [ ] **Step 1: Update `signup` to return data and not assume a token**

In `frontend/src/context/AuthContext.jsx`, replace the `signup` callback:

```jsx
  const signup = useCallback(async (username, email, password) => {
    const { data } = await client.post('/auth/signup', { username, email, password });
    if (data.token) {
      setToken(data.token);
      setUser(data.user);
    }
    return data;
  }, []);
```

- [ ] **Step 2: Add `verifySignup` and `resendSignupOtp`**

Add after the `signup` callback:

```jsx
  const verifySignup = useCallback(async (email, code) => {
    const { data } = await client.post('/auth/signup/verify', { email, code });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const resendSignupOtp = useCallback((email) => client.post('/auth/signup/resend', { email }), []);
```

- [ ] **Step 3: Expose them in the provider value**

Update the provider `value` object to include the new methods:

```jsx
    <AuthContext.Provider value={{ user, loading, login, signup, verifySignup, resendSignupOtp, googleLogin, logout, updateUser, isAdmin: user?.role === 'admin' }}>
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AuthContext.jsx
git commit -m "feat(auth-ui): add signup verify/resend to AuthContext"
```

---

## Task 10: Frontend — two-phase Signup page

**Files:**
- Modify: `frontend/src/pages/Signup.jsx`

**Interfaces:**
- Consumes: `useAuth().signup`, `useAuth().verifySignup`, `useAuth().resendSignupOtp`.

- [ ] **Step 1: Replace `Signup.jsx` with the two-phase version**

Replace the entire contents of `frontend/src/pages/Signup.jsx` with:

```jsx
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PageTransition from '../components/PageTransition';
import GoogleButton from '../components/GoogleButton';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const Signup = () => {
  const { signup, verifySignup, resendSignupOtp } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('form');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const data = await signup(form.username, form.email, form.password);
      if (data.pendingVerification) {
        setPhase('otp');
        setCooldown(60);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifySignup(form.email, code.trim());
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError('');
    try {
      await resendSignupOtp(form.email);
      setCooldown(60);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not resend code');
    }
  };

  if (settings && settings.allowSignups === false) {
    return (
      <PageTransition>
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-night-surface p-8 text-center">
          <h1 className="font-display text-xl font-bold text-silver">Signups are closed</h1>
          <p className="mt-2 text-sm text-silver-muted">New registrations are currently disabled by the administrators.</p>
          <Link to="/login" className="mt-4 inline-block text-sm text-crimson-soft hover:underline">Log in instead</Link>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto mt-10 max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-line bg-night-surface p-8 shadow-card"
        >
          {phase === 'form' ? (
            <>
              <h1 className="text-center font-display text-2xl font-bold text-silver">Join the Hub</h1>
              <p className="mt-1 text-center text-sm text-silver-muted">Create an account to build your library</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-silver">Username</label>
                  <input
                    id="username"
                    type="text"
                    required
                    minLength={3}
                    maxLength={30}
                    autoComplete="username"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    className={inputClass}
                    placeholder="darkreader"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-silver">Email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-silver">Password</label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className={inputClass}
                      placeholder="At least 6 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                {error && (
                  <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </form>
              <GoogleButton onError={setError} />
              <p className="mt-5 text-center text-sm text-silver-muted">
                Already a member?{' '}
                <Link to="/login" className="font-medium text-crimson-soft hover:underline">Log in</Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-center font-display text-2xl font-bold text-silver">Verify your email</h1>
              <p className="mt-1 text-center text-sm text-silver-muted">
                We sent a 6-digit code to <span className="text-silver">{form.email}</span>
              </p>
              <form onSubmit={verify} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-silver">Verification code</label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className={`${inputClass} text-center tracking-[0.5em]`}
                    placeholder="000000"
                  />
                </div>
                {error && (
                  <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </button>
              </form>
              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setPhase('form'); setError(''); setCode(''); }}
                  className="text-silver-muted hover:text-silver"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={cooldown > 0}
                  className="text-crimson-soft hover:underline disabled:cursor-not-allowed disabled:text-silver-muted disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
};

export default Signup;
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Signup.jsx
git commit -m "feat(auth-ui): two-phase signup with OTP verification"
```

---

## Task 11: Frontend — ForgotPassword page + Login link + route

**Files:**
- Create: `frontend/src/pages/ForgotPassword.jsx`
- Modify: `frontend/src/pages/Login.jsx`, `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `client.post('/auth/forgot-password', { email })`, `client.post('/auth/reset-password', { email, code, newPassword })`.

- [ ] **Step 1: Create `ForgotPassword.jsx`**

```jsx
// frontend/src/pages/ForgotPassword.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/auth/forgot-password', { email });
      setNotice('If an account exists for that email, a reset code has been sent.');
      setPhase('reset');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await client.post('/auth/reset-password', { email, code: code.trim(), newPassword });
      setNotice('Password updated. You can now log in.');
      setPhase('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto mt-10 max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-line bg-night-surface p-8 shadow-card"
        >
          <h1 className="text-center font-display text-2xl font-bold text-silver">Reset password</h1>

          {phase === 'request' && (
            <>
              <p className="mt-1 text-center text-sm text-silver-muted">Enter your email and we'll send a reset code</p>
              <form onSubmit={requestCode} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium text-silver">Email</label>
                  <input
                    id="fp-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </div>
                {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Sending...' : 'Send reset code'}
                </button>
              </form>
            </>
          )}

          {phase === 'reset' && (
            <>
              {notice && <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-center text-sm text-silver-muted">{notice}</p>}
              <form onSubmit={reset} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="fp-code" className="mb-1.5 block text-sm font-medium text-silver">Reset code</label>
                  <input
                    id="fp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className={`${inputClass} text-center tracking-[0.5em]`}
                    placeholder="000000"
                  />
                </div>
                <div>
                  <label htmlFor="fp-password" className="mb-1.5 block text-sm font-medium text-silver">New password</label>
                  <div className="relative">
                    <input
                      id="fp-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={inputClass}
                      placeholder="At least 6 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </>
          )}

          {phase === 'done' && (
            <div className="mt-4 text-center">
              <p className="rounded-lg bg-green-500/15 px-3 py-2 text-sm text-green-400">{notice}</p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="mt-5 w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft"
              >
                Go to login
              </button>
            </div>
          )}

          {phase !== 'done' && (
            <p className="mt-5 text-center text-sm text-silver-muted">
              Remembered it?{' '}
              <Link to="/login" className="font-medium text-crimson-soft hover:underline">Log in</Link>
            </p>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
};

export default ForgotPassword;
```

- [ ] **Step 2: Add the "Forgot password?" link to `Login.jsx`**

In `frontend/src/pages/Login.jsx`, add a link immediately after the password field's wrapper `</div>` (i.e., right before the `{error && (` block):

```jsx
            <div className="text-right -mt-1">
              <Link to="/forgot-password" className="text-xs text-crimson-soft hover:underline">Forgot password?</Link>
            </div>
```

`Link` is already imported in `Login.jsx`.

- [ ] **Step 3: Register the route in `App.jsx`**

In `frontend/src/App.jsx`, add the import near the other page imports:

```jsx
import ForgotPassword from './pages/ForgotPassword';
```

Add the route inside the `<Route element={<Layout />}>` group, next to `/login`:

```jsx
          <Route path="/forgot-password" element={<ForgotPassword />} />
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ForgotPassword.jsx frontend/src/pages/Login.jsx frontend/src/App.jsx
git commit -m "feat(auth-ui): add forgot-password page and login link"
```

---

## Task 12: Docs + admin toggle UI + full manual verification

**Files:**
- Modify: `frontend/src/admin/SettingsAdmin.jsx` (add toggle to form state + submit + checkbox), `README.md`

**Interfaces:**
- Consumes: `requireEmailVerification` from `GET /admin/settings`; sends it via `PUT /admin/settings`.

- [ ] **Step 1: Send the field in the SettingsAdmin submit**

In `frontend/src/admin/SettingsAdmin.jsx`, in the `save` handler, add after `body.append('maintenanceMode', form.maintenanceMode);` (line 57):

```jsx
      body.append('requireEmailVerification', form.requireEmailVerification);
```

- [ ] **Step 2: Add the checkbox to the toggles group**

In `frontend/src/admin/SettingsAdmin.jsx`, inside the `flex flex-wrap gap-6` toggles block (after the Maintenance mode label, ~line 214), add:

```jsx
              <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input type="checkbox" checked={form.requireEmailVerification || false} onChange={(e) => setForm((f) => ({ ...f, requireEmailVerification: e.target.checked }))} className="accent-[var(--color-primary)]" />
                Require email verification on signup
              </label>
```

- [ ] **Step 3: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Update the README**

In `README.md`, add an "Email / OTP" subsection under "Setup" (after the Google Sign-In section) documenting the new env vars and behavior:

```markdown
### Email (OTP verification + password reset)

Configure SMTP in `backend/.env` to enable email:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass
MAIL_FROM="Apex NovelHub <no-reply@novelhub.com>"
OTP_TTL_MINUTES=10
```

- **Forgot password** works whenever SMTP is configured: users request a 6-digit
  code from the login page's "Forgot password?" link, then set a new password.
- **Signup email verification** is controlled by the admin **Require email
  verification on signup** toggle (Admin → Settings). When on, new email/password
  signups must confirm a 6-digit code before the account is created. Google
  sign-ins skip this. When SMTP is not configured, codes are logged to the
  server console instead of sent (useful for local development).
```

- [ ] **Step 5: Full manual verification (dev servers)**

Start backend and frontend:

```bash
cd backend && npm run dev   # terminal 1 (:5000)
cd frontend && npm run dev  # terminal 2 (:5173)
```

Verify (no SMTP configured — codes print to the backend console):
1. As admin, go to Admin → Settings, enable **Require email verification on signup**, save.
2. Sign up with a new email/password → UI advances to the "Verify your email" step.
3. Read the 6-digit code from the backend console log → enter it → you're logged in and landed on Home.
4. Log out. On Login, click **Forgot password?** → enter that email → read the code from the console → set a new password → confirmation → log in with the new password.
5. Toggle verification back **off**; confirm signup logs in immediately (old behavior).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/admin/SettingsAdmin.jsx README.md
git commit -m "feat(auth): admin toggle UI + docs for email verification"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task(s) |
| --- | --- |
| Shared OTP mechanics (6-digit, hashed, TTL, attempts, cooldown) | Task 1 (helper), enforced in Tasks 6–8 |
| Mailer utility + env + nodemailer | Task 2 |
| Data models (PendingSignup, PasswordResetCode) | Task 3 |
| User pre-save guard | Task 4 |
| Backend `POST /signup` (toggle-gated) | Task 6 |
| `POST /signup/verify`, `/signup/resend` | Task 7 |
| `POST /forgot-password`, `/reset-password` | Task 8 |
| Site Settings toggle (model + admin + public) | Task 5; admin UI in Task 12 |
| Frontend AuthContext | Task 9 |
| Frontend two-phase Signup | Task 10 |
| Frontend Login link + ForgotPassword page + route | Task 11 |
| Testing (signup off/on, verify, attempts, expiry, resend, 503, forgot/reset, google-only) | Tasks 6–8 tests |
| Docs / README | Task 12 |

No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step contains full code.

**3. Type consistency:** Helper names (`generateOtp`, `hashOtp`, `compareOtp`, `otpExpiry`) match across Tasks 1/6/7/8. Mailer names (`isMailerConfigured`, `sendOtpEmail`) match across Tasks 2/6/7/8. Controller exports (`verifySignup`, `resendSignupOtp`, `forgotPassword`, `resetPassword`) match route registrations in Tasks 7/8. Frontend context methods (`signup`, `verifySignup`, `resendSignupOtp`) match usage in Task 10. Constants `RESEND_COOLDOWN_MS`, `MAX_OTP_ATTEMPTS` defined in Task 6 and reused in Tasks 7/8.

Consistent.
