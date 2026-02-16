# SGM Backend API

Backend API for the SGM platform (tramites + servicios).  
It centralizes registration workflows, PDF document handling, payments, shipments, and reporting.

## What This API Does

- Authenticates users with JWT (`/auth/login`, `/auth/me`).
- Manages **matricula tramites** lifecycle (`/tramites`):
  - creation with required invoice PDF
  - state changes, cancel/finalize/reopen
  - checklist and file uploads
  - payment records and shipment links
- Manages **non-matricula servicios** (`/servicios`):
  - service templates
  - service state progression
  - service payments
- Serves downloadable files (`/files/:id/download`) and generated PDF account statements.
- Provides operational reports (`/reports/summary`, `/reports/tramites`, `/reports/export.csv`).
- Exposes catalogs (`/catalogs/*`) used by the desktop app.

## Tech Stack

- NestJS 11
- Prisma 7 + PostgreSQL
- class-validator / class-transformer
- JWT (`jsonwebtoken`) + bcrypt
- Multer (disk temp uploads), pdf-lib, pdfkit

## Security and Hardening

- Global request validation with whitelist + forbidden unknown fields.
- JWT guard on protected routes.
- Global API throttling and stricter login throttling.
- CORS allowlist via `CORS_ORIGINS`.
- Swagger docs gated by `SWAGGER_ENABLED` / environment.
- PDF uploads constrained by MIME, max size, and max page count.
- CSV export sanitization against formula injection.
- File download errors do not leak internal storage paths.

## Environment Variables

Copy `.env.example` to `.env` and set real values:

```bash
cp .env.example .env
```

Main variables:

- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `STORAGE_ROOT`
- `MAX_PDF_PAGES`
- `MAX_UPLOAD_MB`
- `LOGIN_RATE_TTL_MS`
- `LOGIN_RATE_LIMIT`
- `API_RATE_TTL_MS`
- `API_RATE_LIMIT`
- `CORS_ORIGINS`
- `SWAGGER_ENABLED`
- `REPORTS_SUMMARY_MAX_ROWS`

## Install

```bash
npm install
```

## Run

```bash
# development
npm run start:dev

# production
npm run build
npm run start:prod
```

## Database

```bash
# generate client / run migrations as needed
npx prisma generate
npx prisma migrate deploy

# seed base data
npx prisma db seed
```

## Key Scripts

- `npm run start:dev`
- `npm run build`
- `npm run start:prod`
- `npm run test`
- `npm run test:e2e`

## API Modules

- `auth`
- `tramites`
- `files`
- `shipments`
- `payments`
- `servicios`
- `reports`
- `catalogs`

## Notes

- This backend is designed to be consumed by the Electron desktop app.
- Keep `.env` out of source control and rotate secrets for production.
