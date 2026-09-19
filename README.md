# NovelHub

A novel reading platform with a full admin portal. The `a2znovel` branch ships the "Aurora Violet" theme: a near-black violet UI with a violet-to-magenta brand gradient and Plus Jakarta Sans.

## Stack

Backend: Node.js, Express, MongoDB (Mongoose), JWT auth, Multer uploads, Mammoth (.docx parsing), AdmZip (bulk import).
Frontend: React (Vite), Tailwind CSS, framer-motion, lucide-react.

## Features

Users: signup/login (email + Google sign-in), browse/search with genre/status filters, rankings (trending/popular/rating/new), novel pages with reviews and star ratings, immersive reader (font, size, line height, dark/black/sepia/light themes), auto-saved reading progress, personal library, reading history, chapter comments with likes, in-app notifications for new chapters and announcements.

Admins: dashboard stats, novel CRUD with cover upload, chapter management via rich text editor / .txt/.docx upload / bulk .zip import, auto chapter numbering, user management (roles, ban, delete), comment/review moderation, full site settings (site name, tagline, logo + favicon via upload or URL, theme colors, homepage section visibility, announcement banner, footer, social links, signup toggle, maintenance mode), broadcast notifications.

## Setup

### Backend

```bash
cd backend
npm install
cp .env.example .env   # edit values
npm run seed           # creates admin user + default settings
npm run dev            # starts on :5000
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # starts on :5173, proxies /api and /uploads to :5000
```

Default admin credentials come from `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

### Google Sign-In

1. Create an OAuth 2.0 Client ID (type: Web application) in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add `http://localhost:5173` to Authorized JavaScript origins.
3. Set the same client ID in both env files:
   - `backend/.env` → `GOOGLE_CLIENT_ID=...`
   - `frontend/.env` → `VITE_GOOGLE_CLIENT_ID=...`

The Google button appears on Login/Signup only when `VITE_GOOGLE_CLIENT_ID` is set. Accounts with a matching email are linked automatically; Google-only accounts can add a password later from the Profile page.

### Email (OTP verification + password reset)

Configure SMTP in `backend/.env` to enable email:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass
MAIL_FROM="NovelHub <no-reply@novelhub.com>"
OTP_TTL_MINUTES=10
```

- **Links in notification emails** ("View Details") are built from
  `CLIENT_URL`, so on the server set it to the public address, e.g.
  `CLIENT_URL=https://your-domain.com`. Left at `http://localhost:5173`, every
  email links to the reader's own machine. The sitemap and robots.txt use the
  same value, and the API logs a warning at startup when it is missing or
  invalid, or points at localhost while SMTP is configured.
- **Forgot password** works whenever SMTP is configured: users request a 6-digit
  code from the login page's "Forgot password?" link, then set a new password.
- **Signup email verification** is controlled by the admin **Require email
  verification on signup** toggle (Admin → Settings). When on, new email/password
  signups must confirm a 6-digit code before the account is created. Google
  sign-ins skip this. When SMTP is not configured, codes are logged to the
  server console instead of sent (useful for local development).

### Theme colours

The five brand colours (primary, accent, background, surface, text) live in the
database and can be changed in Admin → Settings → Theme colors; the frontend
derives the remaining shades from them. A database created before the Aurora
Violet theme still holds the old red values, so switch it once after deploying:

```bash
cd backend
npm run theme:aurora -- --dry-run   # show what would change
npm run theme:aurora                # apply (idempotent, recorded in the audit log)
```

The shipped palette is defined in `frontend/src/index.css` and
`frontend/src/theme/palette.js`; keep those and `backend/scripts/applyAuroraTheme.js` in sync.

### Tests

```bash
cd backend
npm test               # Jest + Supertest + mongodb-memory-server
```
