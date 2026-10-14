# Deployment

## Local Docker path

The supported zero-paid-service path is:

```bash
docker compose up --build
```

Caddy serves the application at `http://localhost:8080` and routes `/api/*`, `/health/*`, and API documentation to FastAPI. The remaining paths go to Next.js. PostgreSQL stores metadata, Valkey carries Celery jobs, and a private named volume stores expiring fallback files.

Services are `web`, `api`, `worker`, `postgres`, `valkey`, `mailpit`, `caddy`, and the one-shot `migrate` and `storage-init` jobs. The migration job must succeed before API and worker start. Mailpit captures local account mail at `http://localhost:8080/mailpit/`. API and worker run as non-root UID/GID 1001 with read-only root filesystems, bounded concurrency/timeouts, and no shell interpolation of uploaded filenames. The initializer only assigns the private volume to that identity.

## Environment

### Required

None for local Docker development.

### Optional local overrides

- `DATABASE_URL`, `VALKEY_URL`, `STORAGE_PROVIDER`, `LOCAL_STORAGE_ROOT`
- `MAX_FILE_BYTES`, `MAX_BATCH_DOCUMENTS`, `MAX_PDF_PAGES`
- `PROCESSING_TIMEOUT_SECONDS`, `TEMP_FILE_TTL_SECONDS`, `WORKER_CONCURRENCY`
- `LOCAL_VISION_ENABLED`
- `APP_PUBLIC_ORIGINS`, `AUTH_SECRET`, `AUTH_COOKIE_SECURE`
- session, password, token, and rate-limit controls prefixed with `AUTH_` or `RATE_LIMIT_`
- `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`
- `EARLY_ACCESS_DAILY_CREDITS` (defaults to `100`)

### Optional hosted providers

- Neon: replace `DATABASE_URL` with a private PostgreSQL/Neon connection string.
- ImageKit: set `STORAGE_PROVIDER=imagekit` plus `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_PUBLIC_KEY`, and `IMAGEKIT_URL_ENDPOINT`.
- Gemini: set `AI_ENABLED=true` and `GEMINI_API_KEY`; optionally set `GEMINI_MODEL`.
- OpenAI: set `AI_ENABLED=true` and `OPENAI_API_KEY`; optionally set `OPENAI_MODEL`.
- Vision controls: `VISION_MAX_IMAGE_BYTES`, `VISION_AUTO_APPROVE_CONFIDENCE`.

Blank or incomplete optional credentials disable that provider and never prevent application boot. Copy `.env.example` to `.env` only when overrides are needed. Do not commit `.env`.

## Production notes

Use HTTPS, private credentials, a strong database password, managed secret injection, and the documented Alembic migration gate before scaling API replicas. Set `ENVIRONMENT=production`, a random `AUTH_SECRET` of at least 32 characters, `AUTH_COOKIE_SECURE=true`, and HTTPS-only `APP_PUBLIC_ORIGINS`; unsafe production auth settings fail boot validation. Preserve temporary-object TTL cleanup and private URLs. See `docs/AUTHENTICATION.md` and `docs/MIGRATIONS.md`. Kubernetes, a standalone API gateway, and unnecessary microservices are intentionally excluded; this is a modular monolith with one asynchronous worker tier.
