# Apex NovelHub

A novel reading platform with a full admin portal. Dark gothic theme derived from the site logo.

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

### Tests

```bash
cd backend
npm test               # Jest + Supertest + mongodb-memory-server
```
