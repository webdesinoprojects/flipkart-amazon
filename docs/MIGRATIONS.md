# Database migrations

Alembic is the only production schema authority. The API and worker never call `create_all` at startup. In Compose, the one-shot `migrate` service completes `alembic upgrade head` before either process starts.

## New database

```sh
docker compose run --rm migrate
```

`docker compose up --build` performs the same migration gate automatically.

## Existing database created by an older release

Older releases created the Phase 9 tables directly. Back up the database, verify that the baseline tables exist, then adopt them without recreating anything:

```sh
docker compose run --rm api alembic -c alembic.ini stamp 0001_core_baseline
docker compose run --rm api alembic -c alembic.ini upgrade head
```

Do not stamp a blank database. Use `upgrade head` from revision zero instead.

## Deployment procedure

1. Create and verify a PostgreSQL backup.
2. Build the new API image.
3. Run `alembic -c alembic.ini current` and `alembic -c alembic.ini heads`.
4. Run `alembic -c alembic.ini upgrade head` once.
5. Start API and worker instances only after migration success.
6. Check `/health/ready`; `migrations` must be `up_to_date` and `auth` must be `ready`.

Revision `0002_auth_foundation` is intentionally irreversible because downgrading would destroy accounts, sessions, tokens, and the security audit trail. Rollback means restoring the verified database backup and deploying the previous application image. Never work around this guard by manually dropping tables.
