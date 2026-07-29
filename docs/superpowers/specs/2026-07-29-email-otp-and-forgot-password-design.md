# Email OTP Signup Verification + Forgot Password — Design

**Date:** 2026-07-29
**Status:** Approved (pending spec review)

## Goal

Add two authentication features to NovelHub:

1. **Email OTP verification on first-time signup** — when a user signs up with
   email/password (not Google), require them to confirm ownership of the email
   via a one-time code before the account is created.
2. **Forgot password** — let a user who forgot their password reset it via an
   emailed one-time code.

Google sign-in is unaffected: Google already verifies email ownership, so those
accounts skip OTP entirely.

## Key decisions (settled during brainstorming)

| Decision | Choice |
| --- | --- |
| Email delivery | **Nodemailer + SMTP** (env-configured). Console-log fallback in dev/test. |
| Signup account creation | **Pending until verified** — no `User` row until the OTP is confirmed. |
| Password reset mechanism | **OTP code** (same UX as signup), entered in-app. |
| Enforcement | **Admin toggle** `requireEmailVerification` in Site Settings, default **off**. |

The default-off toggle is deliberate: it keeps existing local/dev deployments
and the current Jest suite working with zero email configuration. OTP is only
enforced once an admin turns the toggle on *and* SMTP is configured.

## Shared OTP mechanics

Both flows use one consistent scheme:

- **6-digit numeric** code, generated with `crypto.randomInt(0, 1_000_000)`
  and zero-padded to 6 digits. Never `Math.random`.
- **Hashed at rest** with bcrypt (`codeHash`). The plaintext code exists only in
  the outbound email. Never logged in production.
- **Validity: 10 minutes** (env `OTP_TTL_MINUTES`, default `10`). Stored as
  `expiresAt`, which also drives the TTL index (record auto-purges).
- **Max 5 verify attempts** per code. On the 6th wrong attempt the code is
  treated as invalid and the user must request a new one.
- **60-second resend cooldown**, enforced via `lastSentAt`.

## Component 1 — Mailer utility

**File:** `backend/src/utils/mailer.js`

Responsibilities:

- Lazily construct a single nodemailer SMTP transport from env vars (built on
  first use so importing the module never throws when SMTP is unset).
- `isMailerConfigured()` → `true` when `SMTP_HOST` is present.
- `sendOtpEmail({ to, code, purpose })` where `purpose` is `'signup'` or
  `'password_reset'`. Builds subject + HTML + text body branded with the site
  name, and sends via the transport.
- **Dev/test fallback:** when `isMailerConfigured()` is false, `sendOtpEmail`
  logs the code to the console (`console.info`) and resolves without sending.
  This keeps the app runnable and testable with no config.

Dependency: add `nodemailer` to `backend/package.json`.

New env vars (added to `backend/.env.example` and documented in `README.md`):

```
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Apex NovelHub <no-reply@novelhub.com>"
OTP_TTL_MINUTES=10
```

## Component 2 — Data models

Two short-lived collections, each with one clear purpose and a TTL index so
abandoned records self-clean.

**`backend/src/models/PendingSignup.js`**

| Field | Type | Notes |
| --- | --- | --- |
| `email` | String, unique, lowercase | The pending account's email. |
| `username` | String | Chosen username (validated at signup time). |
| `passwordHash` | String | bcrypt hash of the chosen password. |
| `codeHash` | String | bcrypt hash of the current OTP. |
| `expiresAt` | Date | OTP validity + TTL. Index: `expireAfterSeconds: 0`. |
| `attempts` | Number, default 0 | Verify attempts against the current code. |
| `lastSentAt` | Date | Drives resend cooldown. |

No real `User` exists until verification succeeds. Re-initiating signup for the
same email upserts (overwrites) the pending record with a fresh code.

**`backend/src/models/PasswordResetCode.js`**

| Field | Type | Notes |
| --- | --- | --- |
| `user` | ObjectId ref `User` | The account being reset. |
| `email` | String, lowercase | Denormalized for lookup. |
| `codeHash` | String | bcrypt hash of the current OTP. |
| `expiresAt` | Date | Validity + TTL. Index: `expireAfterSeconds: 0`. |
| `attempts` | Number, default 0 | Verify attempts. |
| `lastSentAt` | Date | Resend cooldown. |

One active record per user (upsert by `user`).

**`User` model change (minimal):** the existing `pre('save')` hook always
re-hashes `password` when modified. Because `PendingSignup` already holds a
bcrypt hash, insert-on-verify would double-hash. Guard the hook:

```js
userSchema.pre('save', async function () {
  if (this.isModified('password') && !this.$locals.passwordAlreadyHashed) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});
```

Verification then creates the user with:

```js
const user = new User({ username, email });
user.password = pending.passwordHash;
user.$locals.passwordAlreadyHashed = true;
await user.save();
```

This avoids ever storing a plaintext password at rest. No other User fields
change — because unverified signups never become Users, login needs no
`emailVerified` check.

## Component 3 — Backend endpoints

All under `/api/auth` (`backend/src/routes/authRoutes.js` +
`backend/src/controllers/authController.js`).

### `POST /signup` (modified)

1. Existing checks unchanged: `allowSignups` gate, required-field validation,
   duplicate email/username → `409`.
2. Read `settings.requireEmailVerification`:
   - **Off** → create the `User` and return `{ token, user }` (**current
     behavior, unchanged**).
   - **On** + mailer configured → hash the password, upsert a `PendingSignup`,
     generate + email the code, return `202 { pendingVerification: true, email }`.
     No token.
   - **On** + mailer **not** configured → `503 { message: 'Email verification is
     enabled but email delivery is not configured.' }`.

### `POST /signup/verify` — `{ email, code }`

- Look up `PendingSignup` by email; missing/expired → `400`.
- `attempts >= 5` → `400` (ask to resend).
- Compare `code` to `codeHash`; wrong → increment `attempts`, `400`.
- Correct → re-check email/username still unique (race safety), create the
  `User` (via the `passwordAlreadyHashed` path), delete the pending record,
  return `{ token, user }` (logs them in).

### `POST /signup/resend` — `{ email }`

- Find pending record; if within the 60s cooldown → `429`.
- Otherwise regenerate the code, update `codeHash`/`expiresAt`/`lastSentAt`,
  reset `attempts`, resend. Return generic `200`.

### `POST /forgot-password` — `{ email }`

- **Always** returns `200 { message: 'If an account exists, a reset code has
  been sent.' }` regardless of whether the email exists (prevents enumeration).
- When the account exists and mailer is configured: upsert a
  `PasswordResetCode`, email the code. Google-only accounts (no password) are
  allowed — resetting sets a password, granting them email login too.
- When mailer is not configured: return the same generic `200`, log a
  server-side warning, send nothing.

### `POST /reset-password` — `{ email, code, newPassword }`

- Validate `newPassword` length (>= 6).
- Find `PasswordResetCode` by email; missing/expired → `400`; attempts
  exceeded → `400`.
- Compare code; wrong → increment `attempts`, `400`.
- Correct → set `user.password = newPassword` (normal hashing path), save,
  delete the reset record, return `200 { message: 'Password updated' }`.
- No auto-login; the frontend redirects to the login screen.

## Component 4 — Site Settings toggle

- `backend/src/models/SiteSettings.js`: add
  `requireEmailVerification: { type: Boolean, default: false }`.
- `backend/src/controllers/adminController.js` `updateSettings`: handle it with
  the same coercion as `allowSignups`
  (`body.x === 'true' || body.x === true`).
- Expose it in `getAdminSettings` (already returns the full doc) and add it to
  `getPublicSettings` so the client can optionally surface a note. The
  authoritative signal for the UI remains the `/signup` response shape.
- `frontend/src/admin/SettingsAdmin.jsx`: add a checkbox
  ("Require email verification on signup") mirroring the `allowSignups` toggle,
  and include it in the form state + submit `FormData`.

## Component 5 — Frontend

### `frontend/src/context/AuthContext.jsx`

- `signup()` returns the raw response data (so the page can branch on
  `pendingVerification` vs. a returned `token`).
- Add `verifySignup(email, code)` — calls `/auth/signup/verify`, sets
  token + user on success.
- Forgot/reset are called directly via the API client from the page (no
  auth-state change), or thin wrappers — implementer's choice, kept out of
  global auth state.

### `frontend/src/pages/Signup.jsx`

Two-phase, single page:

- **Phase 1** — current username/email/password form. On submit, call
  `signup()`. If the response carries a `token`, behave exactly as today
  (toggle off). If it returns `pendingVerification`, advance to phase 2.
- **Phase 2** — 6-digit code entry, a **Resend code** button with a 60s
  countdown, and a "back / change email" link. On successful `verifySignup`,
  set auth state and navigate home. Errors (wrong/expired code) shown inline
  using the existing error-styling pattern.

### `frontend/src/pages/Login.jsx`

Add a "Forgot password?" link beneath the password field, linking to
`/forgot-password`.

### `frontend/src/pages/ForgotPassword.jsx` (new)

Two-phase, single page:

- **Phase 1** — enter email → call `/auth/forgot-password` → always advance to
  phase 2 with a neutral "if an account exists, a code was sent" message.
- **Phase 2** — enter code + new password → call `/auth/reset-password` → on
  success show confirmation and a link to `/login`.

Styled consistently with the existing `Login`/`Signup` pages (same input
classes, `PageTransition`, motion wrapper).

### `frontend/src/App.jsx`

Add `<Route path="/forgot-password" element={<ForgotPassword />} />` inside the
`Layout` route group.

## Component 6 — Testing

New Jest + Supertest specs, mocking `backend/src/utils/mailer` (capturing the
plaintext `code` from the mock's call args — mirroring how
`google-auth-library` is mocked in `googleAuth.test.js`).

**`tests/signupOtp.test.js`**

- Verification **off** → `/signup` still returns a token (regression guard).
- Verification **on** + mailer configured → `/signup` returns `202`
  `pendingVerification`; **no `User` created yet**; code emailed.
- `/signup/verify` with the correct code → creates the user + returns a token;
  a second verify fails (record consumed).
- Wrong code → `400`, `attempts` increments; after 5 wrong → locked out.
- Expired code → `400`.
- Resend within cooldown → `429`; after cooldown → new code sent.
- Verification **on** but mailer **not** configured → `503`.

**`tests/passwordReset.test.js`**

- `/forgot-password` with unknown email → generic `200`, nothing sent.
- `/forgot-password` with known email → generic `200`, code sent.
- `/reset-password` with correct code → password changed; user can log in with
  the new password; old password rejected.
- Wrong/expired code → `400`.
- Google-only account → reset sets a password; user can then log in with email.

Existing `tests/auth.test.js` and `tests/googleAuth.test.js` remain unchanged
and passing because the toggle defaults off.

## Security notes

- OTPs are hashed at rest; passwords are never stored in plaintext (pending
  records hold a bcrypt hash).
- Forgot-password responses are enumeration-safe (always generic).
- Abuse control is the per-record 60s cooldown + 5-attempt cap. A global
  IP-level rate limiter (`express-rate-limit`) is intentionally **out of scope**
  for this iteration; it can be layered on later without touching this design.
- The pre-existing signup duplicate-email `409` (an existing minor enumeration
  vector) is preserved as-is to avoid changing established behavior/tests.

## Out of scope

- IP/global rate limiting.
- Changing Google auth or the existing duplicate-email `409` behavior.
- Email templating beyond a simple branded subject/body.
- Re-verifying email on address change from the Profile page.
