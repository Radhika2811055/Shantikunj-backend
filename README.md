# Server (Express API)

Backend service for the Shantikunj workflow platform.

## Tech

- Express 5
- Mongoose
- JWT auth
- Passport Google OAuth (optional)
- Multer uploads
- Node-cron scheduled follow-up job

## Setup

### 1) Install dependencies

```powershell
npm install
```

### 2) Configure environment

Create `.env` in this folder from `.env.example`.

Required:

- `MONGO_URI`
- `JWT_SECRET`

Optional but recommended for email/notifications:

- `EMAIL_USER`
- `EMAIL_PASS`

Optional for frontend links in emails:

- `FRONTEND_URL` (default fallback in code: `http://localhost:5173`)

Optional for Google login:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`

Optional for Cloudinary-backed uploads (recommended):

- `CLOUDINARY_URL` (alternative single-string format)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_TRANSLATION_FOLDER` (default: `shantikunj/translations`)
- `CLOUDINARY_AUDIO_FOLDER` (default: `shantikunj/audio`)

Optional workflow behavior:

- `TRANSLATION_INVITE_LANGUAGES`

### 3) Run

```powershell
npm run dev
```

Server URL: `http://localhost:5000`

## Scripts

- `npm start` - start server
- `npm run dev` - run with watch mode
- `npm test` - placeholder

## API Route Groups

All routes are mounted under `/api`.

- `/api/auth` - register/login/profile/password reset/google callback
- `/api/admin` - admin approval and user management
- `/api/books` - workflow operations, assignments, uploads, approvals
- `/api/claims` - role claims and claim history
- `/api/feedback` - version feedback and summaries
- `/api/notifications` - notification inbox management
- `/api/support` - support request lifecycle
- `/api/audit` - audit logs for admin/spoc

## Uploads

- If Cloudinary env vars are configured, uploads are sent to Cloudinary and response includes metadata (`publicId`, `resourceType`, `bytes`, etc.).
- If Cloudinary is not configured, backend falls back to local disk uploads.
- Static local files are served from `/uploads`.
- Local folder locations:
  - `uploads/translations`
  - `uploads/audio`
- Book version records persist file URLs plus metadata in MongoDB fields:
  - `languageVersions.textFileMeta`
  - `languageVersions.audioFileMeta`

## Scheduler

Daily follow-up job configured in `index.js`:

- Cron: `0 9 * * *` (9:00 AM server time)

## Auth & Access Model

Middleware:

- `protect` - verifies JWT and loads user
- `authorise(...)` - role-based access control

Main roles in the system:

- admin
- spoc
- translator
- checker
- recorder
- audio_checker
- regional_team

## Notes for Production Hardening

1. Move session secret to a dedicated env var instead of reusing `JWT_SECRET`.
2. Restrict CORS origins instead of open default.
3. Add request validation for all mutation endpoints.
4. Add API integration tests and role-based authorization tests.
