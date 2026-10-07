# Architecture

## System boundary

The browser is the primary processing and privacy boundary. It ingests a mixed batch, inspects every PDF page, selects a versioned marketplace adapter, creates native PDF crops, validates temporary 203 DPI renders, handles manual review, and assembles the final PDF. Canvas/WebP data is limited to preview, CV, decoding, and review; production pages embed original PDF content.

The server is a proportionate fallback, persistence, and identity boundary. FastAPI, PostgreSQL, Celery, Valkey, private temporary storage, and Caddy form one modular monolith plus an asynchronous worker—not a fleet of microservices. PostgreSQL-backed opaque sessions make FastAPI the sole authentication authority; Next.js only renders identity returned by the API.

```text
Browser: files → PDF.js → adapters → pdf-lib native crop → 203 DPI validation
                    → review when uncertain → combined 100×150 mm PDF → print

Fallback: Caddy → FastAPI → PostgreSQL metadata
                         → private storage → Valkey → Celery worker
                         → local/cloud vision provider only after uncertainty
                         → independent deterministic validation → approve/review
```

## Repository

```text
apps/web/src/components             Workspace, progress, preview, review, output
apps/web/src/features/batch         Browser pipeline and state projection
apps/api/app                        API, jobs, database, storage, vision providers
apps/api/app/modules/auth           Accounts, sessions, recovery, CSRF, rate limits
apps/web/src/features/auth          Account forms, protected shell, session controls
packages/core/src/marketplace       Modular marketplace adapters and registry
packages/core/src                   Geometry, native PDF, decoding, confidence, events
packages/config                     Limits and physical print constants
packages/ui                         Shared monochrome UI primitives
e2e                                 Playwright phase regressions
infra/Caddyfile                     Single local HTTP origin
```

## Core contracts

- `MarketplaceAdapter` detects documents, classifies each page, finds zero or more printable regions in PDF points, normalizes regions, and validates results.
- `ProcessingEvent` is append-only and shared by browser processing and server SSE. Stages are INGEST, PARSE, CLASSIFY, EXTRACT, NORMALIZE, VALIDATE, REVIEW, ASSEMBLE, and COMPLETE.
- `VisionFallbackProvider` accepts only a minimum rendered image and returns a normalized crop proposal, rotation, provider identity, and evidence. The coordinator never calls it for deterministic success and never accepts it without a fresh mandatory validation pass.
- `StorageProvider` selects private `LocalTempStorage` by default and optional ImageKit when fully configured.

## Ordering and failure isolation

Output order is upload order → source page order → region order. Input-document count is unrelated to output-label count. Failed/skipped/review labels retain attributable records, while ready labels still assemble and print. Duplicate evidence warns and never silently deletes.

## Security controls

Untrusted uploads have count, byte-size, MIME/magic-byte, page, time, concurrency, and filename limits. Server objects use random private keys and TTL cleanup. Worker/API images run non-root with read-only root filesystems. Raw customer text and barcode payloads are excluded from logs and metadata.

Public registration creates only `user` accounts. The `admin` role can be assigned only by the operator CLI. Argon2id protects passwords; only HMAC digests of opaque session and one-time tokens reach PostgreSQL. Session-bound CSRF and trusted-origin checks protect authenticated mutations. Server-fallback batches are owned by the authenticated user and return 404 across account boundaries.

## Key libraries

| Library                              | Role                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| Next.js 16 / React 19 / TypeScript 6 | Browser application and strict shared contracts          |
| PDF.js                               | Page inspection and temporary rendering                  |
| pdf-lib                              | Native source-page embedding, clipping, sizing, assembly |
| ZXing                                | Local barcode/QR detection and decoding                  |
| Zustand                              | In-memory batch/event state                              |
| FastAPI / SQLAlchemy                 | Server fallback and metadata                             |
| Celery / Valkey                      | Bounded asynchronous processing and cleanup              |
| OpenCV headless                      | Optional local content-bound fallback                    |
| Playwright / Vitest / Pytest         | Browser, TypeScript, and backend verification            |

Browsers cannot silently select or control the PeriPeri S1; Print All deliberately opens the normal browser/OS PDF print path.
