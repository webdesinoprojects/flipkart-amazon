# SaaS Release, Scale, and Operations Plan

Status: proposed implementation plan; no implementation is authorized by this document alone.

Last reviewed: 2026-10-07

This plan extends the current local-first label normalizer into a production SaaS without replacing the working PDF pipeline. The marketplace master prompt remains the source of truth for label detection, native PDF normalization, validation, review, and output quality. This document is the source of truth for the new account, dashboard, quota, billing, storage, administration, resilience, deployment, and operating work.

## 1. Non-negotiable outcomes

The released product must:

- preserve browser-local marketplace PDF processing as the primary path;
- preserve PDF-native final output and the existing 100 x 150 mm portrait contract;
- never require OpenAI, Gemini, ImageKit, Neon, or another paid service to boot or perform the core workflow;
- add secure user accounts, user dashboard, roles, administration, quotas, subscriptions, payments, and private saved outputs;
- store only generated output PDFs for user history by default; original customer PDFs must not be retained by the SaaS path;
- remain a modular monolith with an asynchronous worker, PostgreSQL, Valkey, and Caddy;
- run on the Hostinger VPS through Docker Compose;
- fail safely during a surge rather than exhaust memory, disk, database connections, or worker capacity;
- pass a defined 500-concurrent-user capacity test before claiming that capacity publicly;
- use established libraries for complex, accessibility-sensitive, security-sensitive, and protocol-sensitive behavior;
- preserve the existing technical/editorial black UI direction;
- keep handwritten application files cohesive, normally below 500 lines, and never allow an unexplained 600+ line product file;
- implement every new external or asynchronous operation with timeouts, bounded retries, idempotency, observability, and a recovery path.

## 2. What “500 users” means

“Supports 500 users” is not a count of registered accounts. The release acceptance target is:

- 500 concurrently active authenticated sessions;
- a realistic mix of dashboard reads, usage checks, batch metadata writes, saved-output listing, and downloads;
- an independently tested spike in login and upload traffic;
- browser-local processing for the normal PDF workflow;
- bounded server fallback and AI work, which is not allowed to consume all capacity;
- no double charging, quota overspend, role leakage, cross-user file access, or lost confirmed payment events under concurrency;
- graceful overload responses with a visible retry/wait state instead of a crashed or wedged server.

This is a test target, not a promise that any unspecified Hostinger VPS size can satisfy it. The exact VPS CPU, RAM, disk, and network tier must be recorded with every load-test result.

## 3. Current baseline that must be preserved

The current repository already contains:

- Next.js 16.3.1, React 19.2.8, TypeScript 6.0.3, and Tailwind CSS 4.3.3;
- the working browser PDF engine using PDF.js and pdf-lib;
- modular marketplace adapters in `packages/core`;
- browser-local progress and review behavior;
- FastAPI 0.141.1 and SQLAlchemy 2.0.51;
- Celery 5.6.3 using Valkey;
- PostgreSQL 17 in local Compose;
- Caddy 2.10 as the reverse proxy;
- Docker services for web, API, worker, database, broker, and storage initialization;
- optional local vision, Gemini, OpenAI, ImageKit, and Neon configuration;
- Vitest, Pytest, Playwright, ESLint, Prettier, Ruff, typecheck, and production build commands.

Known baseline debt that must be addressed incrementally before adding large SaaS features:

- `apps/web/src/features/batch/pdf-engine.ts` is approximately 1,787 lines;
- `apps/web/src/app/globals.css` is approximately 1,032 lines;
- schema creation currently happens through `Base.metadata.create_all`, not versioned migrations;
- the API currently has one Uvicorn worker in Compose;
- Celery worker and scheduler currently run in the same process;
- Valkey is intentionally ephemeral in the local configuration;
- the existing backend tables do not yet model users, subscriptions, quota, output ownership, payment events, or audit logs.

Existing behavior gets characterization tests before refactoring. Large files are split by responsibility, not rewritten wholesale.

## 4. Product and commercial model

### 4.1 Initial plans

The initial commercial requirements are:

| Plan     |         Price | Daily successful labels |
| -------- | ------------: | ----------------------: |
| Starter  |  INR 99/month |                 100/day |
| Growth   | INR 199/month |                 400/day |
| Business | INR 299/month |                 800/day |

Plan entitlements must be database records with versioned effective dates, not scattered constants in UI and API code.

Before public sale, decide and record:

- whether tax is included;
- trial/free behavior;
- saved-output retention by plan;
- maximum saved-output bytes per account;
- refund/cancellation rules;
- whether subscriptions renew monthly or use another period;
- grace behavior for failed renewals;
- source-page abuse limits;
- whether an approved review label consumes quota at approval or assembly time.

### 4.2 Credit definition

One credit is consumed for one successfully approved shipment-label output page.

- A source PDF is not a credit.
- A source page is not automatically a credit.
- Invoice-only, blank, skipped, and failed pages do not consume a credit.
- A review-required label reserves capacity but consumes only once approved and committed.
- Reprocessing the same idempotent batch operation must not consume twice.
- Downloading an already saved output does not consume another label credit.

Credits reset at the configured business-day boundary, initially `Asia/Kolkata` midnight. Store quota period timestamps in UTC and derive the business period with an explicit timezone library on the backend.

### 4.3 Source-page safety limits

Daily output credits alone do not protect CPU and memory. Add separate, configurable source-page and batch limits. Starting values must be measured before launch; they must not be invented from the output quota. Limits include:

- files per batch;
- bytes per file and batch;
- source pages per batch and per day;
- simultaneous batches per user;
- simultaneous output uploads per user;
- saved bytes per user;
- fallback jobs per user and per system.

Reject before expensive processing when a hard limit is already known.

## 5. Roles and authorization

### 5.1 Roles

Use exactly two product roles:

- `user`: owns batches, outputs, sessions, plan, and usage;
- `admin`: support, configuration, staff, and operational access constrained by explicit permissions.

Do not use role names as the only authorization model. Define permissions such as:

- `users.read_summary`;
- `users.suspend`;
- `credits.adjust`;
- `plans.manage`;
- `payments.read`;
- `payments.reconcile`;
- `system.health.read`;
- `audit.read`.

Every protected backend action performs authorization in the API. Hiding a button is not a security check.

### 5.2 Privacy rules for staff

- Admin lists show operational metadata, not addresses or document contents.
- Saved output PDFs are not visible to staff by default.
- Any exceptional staff file access requires a reason, elevated permission, a short-lived access grant, and an audit event.
- Admin assignment is not available through public signup or a normal user-facing screen.
- The first admin is bootstrapped with a one-time CLI operation or migration-controlled seed, then the bootstrap secret is removed.
- Staff accounts require MFA before production launch.

## 6. Target architecture

### 6.1 Architectural style

Keep a modular monolith plus asynchronous workers:

```text
Browser
  |-- Next.js public/auth/dashboard/admin UI
  |-- browser-local PDF pipeline
  |-- generated PDF upload only when user chooses Save
  |
Caddy (TLS, routing, body limits, health-aware reverse proxy)
  |-- Next.js web
  |-- FastAPI /api/v1 and SSE
       |-- PostgreSQL: source of truth
       |-- Valkey: broker, short-lived coordination/cache only
       |-- Celery workers: bounded async work
       |-- private VPS generated-output storage
       |-- optional external providers behind adapters
```

No Kubernetes, standalone API gateway, service mesh, or unnecessary microservice is part of this plan.

### 6.2 Request ownership

- Next.js owns page rendering, public content, browser interactions, and UI composition.
- FastAPI owns users, authorization, quotas, plans, subscriptions, payments, saved-output metadata, download authorization, audit events, and job orchestration.
- `packages/core` owns marketplace/PDF domain logic shared in the browser.
- PostgreSQL owns authoritative business state.
- Valkey never owns authoritative credits, payments, subscriptions, or file ownership.
- Celery owns retryable asynchronous execution, not business truth.
- Caddy owns TLS and reverse proxy concerns, not application authorization.

### 6.3 Normal label flow

```text
authenticate
  -> request quota reservation
  -> browser parses/classifies/extracts/normalizes/validates
  -> user reviews uncertain pages
  -> browser assembles final PDF
  -> API commits actual successful-label count atomically
  -> optional private save of final PDF
  -> dashboard shows metadata and download link
```

If the user does not save the result, the generated file remains browser-local and only quota/batch metadata is committed.

The reservation has a TTL and a unique idempotency key. Expired, abandoned reservations release automatically through an idempotent reconciliation job.

### 6.4 Server fallback flow

Server fallback is used only when deterministic browser processing is uncertain and the user permits it.

- Upload the minimum required page/material, not the entire original document when avoidable.
- Store fallback input in an isolated temporary path with TTL.
- Queue it in a bounded low-priority queue.
- Emit the same `ProcessingEvent` contract as browser processing.
- Re-run deterministic validation after fallback.
- Delete temporary input after success, terminal failure, or TTL.
- If fallback capacity is unavailable, preserve local/manual review instead of blocking the batch.

## 7. Data model and transaction design

### 7.1 Migrations first

Add Alembic before adding SaaS tables. Remove automatic production schema creation. Local/test bootstrap may run migrations automatically, but production deployment runs a deliberate migration step.

Use expand-and-contract migrations:

1. add backward-compatible schema;
2. deploy compatible code;
3. backfill through a resumable job when needed;
4. validate counts/invariants;
5. remove old schema in a later release.

Every migration documents rollback feasibility and backup requirements.

### 7.2 Proposed tables

Authentication and access:

- `users`;
- `user_emails` if multiple/verification state is needed;
- `sessions` with hashed opaque tokens;
- `email_verification_tokens`;
- `password_reset_tokens`;
- `roles`, `permissions`, `user_roles`, and `role_permissions` or an equivalent constrained model;
- `login_attempts` or security-event records where useful.

Commercial state:

- `plans`;
- `plan_versions` or effective-dated plan entitlements;
- `subscriptions`;
- `payment_orders`;
- `payments`;
- `payment_webhook_inbox` with unique provider event identity;
- `refunds` if refunds are enabled;
- `billing_reconciliation_runs`.

Usage:

- `quota_periods`;
- `credit_reservations`;
- `credit_ledger` as append-only authoritative entries;
- `usage_daily_rollups` as disposable/rebuildable read optimization;
- `idempotency_keys` with request hash, response reference, status, and expiry.

Saved work:

- existing `batches`, extended with `user_id`, count fields, and lifecycle state;
- existing `documents`, used only for server-side temporary/fallback inputs;
- `saved_outputs` with owner, storage object, page count, byte count, checksum, status, and retention dates;
- `storage_objects` with provider-neutral metadata and deletion state;
- existing `processing_events`, extended for user-visible and server-emitted events;
- existing `layout_templates` and layout-version data.

Operations:

- `webhook_outbox` or a generic transactional `outbox_events` table;
- `failed_jobs` for exhausted task records and safe replay;
- `audit_logs` with actor, action, target, reason, request ID, and redacted metadata;
- `admin_notes` only if support workflows need them;
- `system_settings` for narrowly scoped, audited runtime settings.

### 7.3 Credit concurrency

Reservation and commit operations must be a single PostgreSQL transaction using row-level locking or an equivalent atomic update.

Required invariants:

- available = limit - committed - active reservations;
- available never becomes negative;
- one idempotency key produces at most one reservation and one final ledger effect;
- reservation commit is repeatable without duplicate debit;
- expiration and commit cannot both win;
- plan changes never rewrite old ledger history;
- admin adjustments are additive ledger entries, never silent counter edits.

Back these rules with unique constraints, foreign keys, non-null constraints, checks, and concurrency integration tests. Do not rely on an in-memory lock.

## 8. Private generated-output storage on the VPS

### 8.1 Storage contract

Use a `StorageProvider` capability with a local implementation first. Optional ImageKit remains an adapter but is not used for sensitive saved PDFs unless its private delivery behavior is explicitly enabled and tested.

Suggested production paths:

```text
/srv/label-normalizer/generated
/srv/label-normalizer/temporary
/srv/label-normalizer/postgres
/srv/label-normalizer/valkey
/srv/label-normalizer/backups
```

Generated files:

- live outside any public web root;
- use random storage keys, not customer filenames;
- are written to a temporary file, fsynced when appropriate, then atomically renamed;
- store SHA-256, bytes, page count, owner, creation time, and expiry in PostgreSQL;
- are downloaded only through an authenticated ownership-checked streaming endpoint;
- use `Content-Disposition` with a sanitized display filename;
- support range requests only if implemented safely and tested;
- are deleted through an idempotent two-phase cleanup state so database and disk can be reconciled.

### 8.2 Retention and disk safety

Plan retention and per-user byte quotas must remain configuration, not code constants. Before choosing final values:

1. measure p50, p95, and maximum bytes per generated label and batch from representative outputs;
2. model active users x daily outputs x retention;
3. keep a minimum free-disk reserve;
4. alert at warning and critical disk thresholds;
5. block new saves before the filesystem becomes unsafe;
6. keep processing and immediate download available when possible;
7. provide users clear delete and retention information.

Never silently delete a file before its promised retention date merely because the disk is full. Admission control must prevent that promise from being made.

### 8.3 Backups

Hostinger VPS snapshots/backups are useful but are not the only database/file backup plan.

- Run consistent PostgreSQL backups with restore instructions.
- Back up storage metadata and generated files as one recoverable system.
- Encrypt backups containing customer outputs.
- Maintain at least one copy outside the live VPS failure domain.
- Test restoration quarterly and before major migrations.
- Record recovery point objective and recovery time objective after the first restore drill.

If no off-machine backup location is available, public launch with long-term saved files is blocked.

## 9. Authentication and session security

### 9.1 Library decision gate

Do not invent password hashing, cookie cryptography, OAuth, CSRF, token verification, or MFA.

Before authentication implementation, create an ADR comparing currently maintained, self-hostable options against this split Next.js/FastAPI architecture. The selected approach must support:

- email/password registration;
- verified email;
- reset-password flow;
- opaque revocable sessions or an equally safe documented strategy;
- secure browser cookies;
- SQLAlchemy/PostgreSQL compatibility;
- FastAPI authorization without duplicating session truth;
- admin MFA;
- rate limiting and session revocation;
- Next.js 16.3/React 19 compatibility;
- Python 3.13 compatibility;
- an exit/migration path.

FastAPI Users is not the automatic choice because its maintainers announced maintenance mode in 2025. It may be evaluated, but a new dependency must not be chosen only because older examples use it.

If no end-to-end auth package safely fits both runtimes, implement a narrow backend-owned session module using proven libraries for each primitive: Argon2 password hashing, cryptographically random opaque session IDs, hashed database session tokens, safe email-token helpers, and framework CSRF/cookie mechanisms. This fallback still requires an external security review and must not implement custom cryptography.

### 9.2 Session requirements

- `HttpOnly`, `Secure`, explicitly chosen `SameSite`, and scoped `Path` cookie attributes;
- session rotation on login, password change, and privilege elevation;
- short idle timeout plus a documented absolute timeout;
- user-visible device/session list and revoke actions;
- all sessions revoked on account compromise/password reset when appropriate;
- CSRF protection on cookie-authenticated mutations;
- no auth token in `localStorage` or `sessionStorage`;
- generic login/reset responses to reduce account enumeration;
- rate limits by account and IP with proxy-aware trusted-client-IP configuration;
- Argon2 parameters measured on the production CPU, not copied blindly;
- constant-time verification through the chosen library;
- audit events for login, reset, email change, role change, suspension, and session revocation.

## 10. Razorpay billing plan

### 10.1 Principles

- Browser success is not proof of payment.
- The backend creates Razorpay orders/subscriptions.
- The backend verifies returned signatures using the official SDK or documented HMAC flow.
- Entitlement activation requires a captured/confirmed server-side state.
- Webhooks are verified from the raw request body before parsing/mutation.
- Webhook processing is idempotent and handles duplicates and out-of-order delivery.
- Razorpay IDs have unique constraints.
- Secrets never enter browser bundles or logs.

### 10.2 Webhook flow

```text
receive raw body
  -> enforce size/content-type limits
  -> verify signature
  -> insert inbox event with unique provider identity
  -> return success after durable receipt
  -> async worker applies state transition
  -> record outcome/audit event
  -> reconciliation job compares provider truth with local truth
```

The webhook queue is isolated from PDF/AI work. Payment confirmation must never wait behind a long vision task.

### 10.3 Failure handling

- Retry only transient provider/network errors.
- Use provider idempotency where supported and local idempotency always.
- Cap retries and total deadline.
- Apply exponential backoff with full jitter.
- Honor `Retry-After` where applicable.
- Circuit-break provider calls after a measured failure threshold.
- Keep checkout status pending when uncertain; never grant paid quota optimistically.
- Run scheduled reconciliation for pending/ambiguous orders and missed webhooks.
- Provide audited admin reconciliation, not arbitrary status editing.

Razorpay goes live only after test-mode happy paths, failures, duplicate webhooks, invalid signatures, delayed webhooks, refunds/cancellation, and reconciliation are verified.

## 11. Queue, retry, and overload design

### 11.1 Queue classes

Use explicit Celery routes and separate worker pools:

| Queue           | Work                                            | Priority/capacity rule        |
| --------------- | ----------------------------------------------- | ----------------------------- |
| `billing`       | verified webhook application and reconciliation | highest; isolated             |
| `notifications` | verification/reset/payment email                | high; isolated retry budget   |
| `storage`       | finalize/delete/reconcile saved outputs         | medium                        |
| `cleanup`       | TTL and orphan cleanup                          | low, scheduled                |
| `fallback`      | CV/local vision/cloud AI fallback               | low, strictly bounded         |
| `maintenance`   | backfills and operational jobs                  | disabled or tiny during peaks |

Normal browser-local PDF work does not enter Celery.

Run Celery Beat as a separate single scheduler service in production. Do not combine Beat with every worker replica.

### 11.2 Task contract

Every task defines:

- schema-validated payload and version;
- unique idempotency/deduplication identity;
- owner and authorization context by stable IDs, never trusted role strings from the client;
- queue, timeout, soft timeout, and maximum attempts;
- retryable exception classes;
- external-call connection/read timeout;
- safe structured logs with redacted arguments;
- terminal failure record;
- compensation/reconciliation behavior;
- metrics for queued, started, succeeded, retried, failed, and expired states.

Tasks must be idempotent before enabling late acknowledgement. Large PDF/customer data must not be embedded in broker messages; pass private storage IDs.

### 11.3 Retry policy

- Default maximum: three total attempts unless provider semantics justify another value.
- Exponential backoff plus jitter; never an exact synchronized delay.
- Maximum delay and total operation deadline are mandatory.
- Retry only connection failures, selected timeouts, 408, 429, 502, 503, 504, or documented transient provider errors.
- Do not retry validation, authentication, authorization, invariant, unsupported-operation, or deterministic business errors.
- One layer owns each retry. Prevent HTTP client + task + caller retry multiplication.
- Side-effecting writes require idempotency before any retry.
- Exhausted tasks create a `failed_jobs` record for controlled replay; no infinite loop.

### 11.4 Backpressure and load shedding

- Bound worker concurrency by measured CPU/RAM.
- Keep `worker_prefetch_multiplier=1` for long/heavy tasks unless measurement supports a change.
- Bound queue length or oldest acceptable age operationally.
- Bound per-user and global concurrent fallback jobs.
- Refuse new low-priority fallback work before billing/auth capacity is threatened.
- Return 429 for per-user/rate quota pressure and 503 for temporary system saturation, with `Retry-After` where meaningful.
- Show users `queued`, queue position band, wait estimate band, retry time, and cancellation where supported.
- Never use an unbounded in-process queue.
- Never keep a request open while waiting for long work; return a job resource and stream/poll status.

### 11.5 Valkey durability

Local development may remain ephemeral. Production queue configuration must be a deliberate decision:

- enable appropriate AOF/RDB persistence if queued work must survive restart;
- allocate explicit `maxmemory` and a queue-safe eviction policy;
- monitor memory, clients, evictions, rejected writes, persistence state, and broker latency;
- persist business intent in PostgreSQL through outbox/inbox records so a broker loss can be reconciled;
- never assume Valkey is the durable source of payment, quota, or subscription truth.

## 12. Caching plan

Cache only after measuring a repeated expensive read.

Good initial candidates:

- public plan catalog with version/tag invalidation;
- non-sensitive aggregate admin metrics with short TTL;
- layout metadata that already has an authoritative version;
- rate-limit counters and short-lived coordination in Valkey.

Do not use cache as truth for:

- current credit availability during a debit;
- payments/subscriptions;
- permissions or suspension without safe short TTL/invalidation;
- saved-output ownership;
- webhook idempotency.

Rules:

- PostgreSQL remains source of truth.
- Every key includes namespace and schema version.
- Every cache has TTL, invalidation owner, and stale-data decision.
- Protect hot misses from stampedes with request coalescing/lock only where needed.
- Add TTL jitter for large groups of equal-expiry keys.
- Measure hit rate, miss latency, source load, evictions, and stale-serving incidents.
- If Valkey is unavailable, correctness remains intact even if performance degrades.

## 13. API contract standards

### 13.1 Contract-first workflow

FastAPI OpenAPI is the authoritative transport contract. Before implementing a new endpoint:

1. define request, response, error, permission, idempotency, and rate-limit behavior;
2. define state transitions and transaction boundary;
3. define pagination/filtering and data redaction;
4. define timeouts/retries only at external boundaries;
5. add contract tests;
6. generate or validate TypeScript client types from OpenAPI;
7. implement domain service and repository;
8. implement route adapter;
9. add integration and E2E tests.

Do not duplicate API shapes manually in unrelated frontend files.

### 13.2 API conventions

- version under `/api/v1`;
- UUID/opaque public identifiers;
- UTC timestamps with timezone;
- consistent problem response containing stable code, safe message, request ID, and optional field errors;
- cursor pagination for growing user/payment/audit lists;
- `Idempotency-Key` on reservation, commit, save, checkout, and admin adjustment writes;
- request ID accepted/generated at Caddy/API and returned to the client;
- strict content type and body-size checks;
- explicit response models; never return ORM objects accidentally;
- optimistic concurrency/version fields where admin edits can conflict;
- SSE uses monotonic event IDs and supports reconnect with `Last-Event-ID`;
- deprecations are additive and announced before removal.

### 13.3 Initial API surface

Authentication:

- register, verify email, login, logout, current session/user;
- forgot/reset password;
- list/revoke sessions;
- staff MFA enrollment/challenge.

Plans and usage:

- public plans;
- current entitlement;
- current usage/availability;
- reserve, commit, release, and inspect reservation.

Batches and outputs:

- create/list/get batch metadata;
- append/stream processing events;
- save/list/get/delete output;
- authorized streaming download;
- retry/reconcile failed save.

Billing:

- create checkout/order/subscription operation;
- verify callback;
- receive webhook;
- current billing status;
- cancel as permitted;
- invoice/payment history metadata.

Admin:

- user summary/search with redaction;
- suspend/restore;
- append credit adjustment;
- plan/entitlement management;
- payment/reconciliation view;
- failed-job replay where safe;
- audit and system-health read.

## 14. Next.js 16 implementation gate

Before every frontend or Next.js server change:

1. read `apps/web/AGENTS.md`;
2. inspect the installed versions with the package manager;
3. read the relevant installed guide under `apps/web/node_modules/next/dist/docs/` as required by the repository rule;
4. check current official Next.js documentation and security advisories;
5. record which built-in was selected or why it was not suitable;
6. do not copy a Next.js 13/14/15 pattern without confirming it in 16.3.x.

Use framework capabilities deliberately:

- Server Components for non-interactive public/dashboard shells and initial data where appropriate;
- small Client Component islands for PDF processing, crop editing, drag/drop, and interactive controls;
- App Router `loading`, `error`, `not-found`, `forbidden`, and `unauthorized` conventions where supported by the installed version;
- Metadata, robots, sitemap, manifest, font/image primitives already present;
- `proxy.ts` only for optimistic redirects/headers, never as complete authorization;
- `instrumentation.ts` for telemetry bootstrap;
- Route Handlers only when they own a genuine web boundary; do not duplicate FastAPI domain logic;
- caching only for explicitly public/shared data; do not cache session-specific quota, permissions, or dashboard data accidentally;
- Server Actions only after confirming they do not create a second inconsistent write path around FastAPI.

The installed local documentation is authoritative for implementation details. Current online docs may describe a newer 16.x minor release.

## 15. UI library policy

### 15.1 Selected direction

Keep `@label-normalizer/ui` as the product-facing component boundary. Adopt one maintained headless accessibility primitive system behind it; the default candidate is Radix Primitives because it is unstyled, React 19/RSC compatible, incrementally adoptable, and fits the existing custom visual language.

Do not mix Radix, React Aria, Headless UI, and another primitive system casually. If a spike shows Radix cannot meet a requirement, record an ADR before selecting a different system.

Candidate libraries by responsibility, all subject to the dependency gate and installed-version check:

- Radix Primitives for dialog, alert dialog, dropdown, popover, select, tabs, tooltip, toast, accordion, and accessible menu behavior;
- existing `react-dropzone` for file drop/input behavior;
- React Hook Form plus one runtime schema system for complex account/billing/admin forms;
- TanStack Table for the genuinely interactive admin user/payment/audit tables;
- an established chart library only if metrics visualization is included;
- existing Zustand only for local workflow/UI state, not remote server cache;
- the Next.js data path or one chosen server-state library for client polling/mutations if the feature actually requires it.

No `window.alert`, `window.confirm`, `window.prompt`, or hand-built focus trap is used for product UX.

Required native/security boundaries remain native underneath the library abstraction:

- the OS/browser file chooser;
- semantic buttons, forms, labels, and inputs;
- the browser/OS print dialog;
- browser PDF APIs required by the existing engine.

“Use libraries” does not mean installing a package for `Array.map`, `URL`, `Intl`, `AbortController`, a static four-column table, or a basic semantic button.

### 15.2 Dependency gate

Before adding a dependency, document:

- the missing capability;
- why existing code/framework cannot solve it safely;
- maintenance and release activity;
- current security advisories;
- Next.js 16/React 19/Python 3.13 compatibility as applicable;
- accessibility evidence for UI packages;
- bundle/runtime size;
- whether it duplicates an installed package;
- tests and removal/migration path.

One library per responsibility unless an ADR explains the exception.

## 16. Frontend information architecture

Public routes:

- home with concise product promise and local-processing explanation;
- how it works;
- marketplace compatibility and limitations;
- pricing;
- privacy;
- terms;
- refund/cancellation policy;
- contact/support;
- status link;
- login/register/reset/verify.

User dashboard:

- usage today and reset time;
- current plan and billing state;
- “Process labels” primary action;
- active/recent batches;
- saved outputs with expiry and bytes;
- profile/security/sessions;
- billing/payment history;
- delete account/export request flow when defined.

Admin:

- operational overview;
- redacted user list/search;
- user detail/plan/usage/suspension;
- credit adjustment with mandatory reason;
- subscriptions/payments/reconciliation;
- queue/failure health;
- layout versions/fingerprint warnings;
- audit log;
- system configuration restricted to safe, explicit settings.

Preserve the dark, near-black, white, monospace-first, thin-border, rectangular layout. Status color remains functional. Accessibility, responsiveness, focus visibility, reduced motion, and touch targets are release requirements.

## 17. Folder and module plan

Use feature-first organization with clear domain, transport, capability, and provider boundaries.

```text
apps/
  web/
    src/
      app/
        (public)/
        (auth)/
        (dashboard)/
        (admin)/
        api/                 # only genuine Next-owned routes
      features/
        auth/
        account/
        billing/
        usage/
        outputs/
        batch/
          engine/
            ingest.ts
            parse.ts
            classify.ts
            extract.ts
            normalize.ts
            validate.ts
            assemble.ts
            controller.ts
      components/           # composed app components, not domain services
      lib/                  # narrowly named framework adapters only
      styles/
        tokens.css
        base.css
        layout.css
        features/
  api/
    app/
      modules/
        auth/
        users/
        access/
        plans/
        usage/
        billing/
        batches/
        outputs/
        audit/
        jobs/
      capabilities/
        storage/
        payments/
        email/
        vision/
      providers/
        local_storage/
        imagekit/
        razorpay/
        gemini/
        openai/
      platform/
        database/
        queue/
        cache/
        observability/
        security/
      transport/
        http/
        sse/
        tasks/
      migrations/
packages/
  core/                     # PDF/marketplace domain
  ui/                       # product UI wrappers/primitives
  config/
  contracts/                # generated/validated API client contracts
tests/
  e2e/
  integration/
  load/
  security/
infra/
  caddy/
  compose/
  scripts/
```

Names must describe responsibility. Avoid generic dumping grounds such as `helpers.ts`, `utils.ts`, `common.py`, or a single global `services.py`.

Dependency direction:

```text
UI/transport -> application/domain -> capabilities -> provider adapters
```

Domain code must not import Razorpay, ImageKit, Gemini, OpenAI, Caddy, FastAPI route objects, or React components.

Add executable import-boundary checks for TypeScript and Python once the new module tree exists.

## 18. File size and responsibility rules

- Under 200 lines: normally fine.
- 200-350 lines: inspect cohesion as the file evolves.
- 350-500 lines: actively consider extraction by responsibility.
- 500-600 lines: require a documented reason in review.
- More than 600 handwritten product lines: blocked until split or explicitly approved as a justified exception.

Generated files, migrations, static fixtures, and generated clients may be exceptions, but must be clearly marked.

No god component, god service, god schema, giant test file, or giant barrel export. Public package APIs are deliberate; internal modules are not imported by deep path across feature boundaries.

The existing oversized PDF engine and global stylesheet are refactored through characterization tests and small behavior-preserving steps during Release Phase R1.

## 19. Security and privacy controls

### 19.1 Request and file boundary

- Caddy and FastAPI both enforce appropriate body limits.
- Verify PDF MIME and magic bytes; do not trust extension.
- Sanitize display filenames and never interpolate them into commands or paths.
- Use isolated UUID paths and no public document URLs.
- Stream uploads/downloads; do not buffer complete large PDFs in API memory.
- Enforce page/file/batch/time limits before or during parsing.
- Keep worker containers non-root, read-only where possible, with `no-new-privileges` and explicit writable volumes.
- Add CPU/memory/PID limits in production Compose after measurement.
- Optional malware scanning is evaluated before accepting server-side original PDFs broadly.

### 19.2 Application security

- server-side authorization on every object access;
- CSRF protection for cookie-authenticated writes;
- strict CORS or same-origin deployment;
- content security policy rolled out in report-only mode, then enforced;
- secure headers at Caddy/Next;
- output encoding and no unsafe HTML rendering;
- SQLAlchemy parameterization and no string-built SQL from user input;
- dependency and container scanning in CI;
- secret scanning and no secrets in `.env.example`, logs, screenshots, or client bundles;
- rate limits before password hashing, large reads, database-heavy search, or file operations;
- account lockout/throttling designed to resist both brute force and easy denial of service;
- audit all admin/security/payment actions.

### 19.3 PII logging

Never log:

- customer names, addresses, phone numbers, label text, PDF bytes, full barcode payloads, passwords, session tokens, API keys, or payment secrets.

Log stable internal IDs, marketplace, counts, bytes, durations, safe error codes, request ID, task ID, and provider request ID where safe.

## 20. Observability and operations

### 20.1 Health endpoints

- `/health/live`: process is alive; no dependency fan-out.
- `/health/ready`: instance can serve required traffic; bounded checks for database and critical configuration.
- broker/worker health is reported separately and must not necessarily remove the API from service if browser-local processing and dashboard reads remain usable.
- Caddy uses readiness for upstream routing and both active and passive health checks when multiple upstreams exist.

### 20.2 Metrics

Track at minimum:

- request rate, errors, and duration by normalized route/status;
- active requests and upload/download concurrency;
- PostgreSQL pool use, wait time, transaction errors, locks, slow queries, and storage;
- quota reservation/commit/release conflicts;
- login success/failure/rate-limit events;
- webhook received/duplicate/invalid/applied/reconciled counts;
- queue length and oldest-message age by queue;
- worker concurrency, task duration, retry count, exhausted failures, and timeouts;
- Valkey memory, clients, evictions, persistence, and command latency;
- saved bytes, delete failures, orphan counts, and free disk;
- optional-provider calls, latency, rejection, circuit state, and spend controls;
- browser processing stages using privacy-safe telemetry only with disclosed consent/terms.

Avoid high-cardinality labels such as raw user ID, filename, address, request URL with IDs, or barcode.

### 20.3 Initial service objectives

These are release-test thresholds, not contractual SLAs:

- non-file API p95 below 500 ms and p99 below 1.5 s under the accepted 500-user workload;
- non-intentional 5xx below 1% during expected and spike tests;
- no quota/payment/authorization correctness failure;
- download time-to-first-byte p95 below 1 s when storage is healthy, excluding client network transfer time;
- no API/worker OOM, uncontrolled swap, database connection exhaustion, or unbounded queue growth;
- critical billing queue oldest age below 30 seconds under expected load;
- fallback queue may degrade independently without blocking core local processing.

Tune these after production-like baseline measurements and record changes in an ADR.

### 20.4 Alerts and runbooks

Alerts need actionable thresholds and a runbook for:

- site/API unavailable;
- error-rate or latency burn;
- DB unavailable/pool exhaustion/disk risk;
- queue oldest age or retry storm;
- invalid webhook spike;
- payment reconciliation backlog;
- Valkey memory/persistence failure;
- generated-storage free-space warning/critical;
- cleanup failures/orphan growth;
- backup failure and restore-test overdue;
- optional-provider cost/limit spike.

An uptime alert must originate outside the VPS failure domain.

## 21. Load and resilience testing

Use k6 for HTTP workload tests and Playwright for browser workflows. Browser PDF performance remains a separate representative-device benchmark.

### 21.1 Required scenarios

1. Smoke: one user for every critical flow.
2. Average: expected active-user mix for at least 30 minutes.
3. Load: 500 concurrent authenticated sessions with realistic think time.
4. Spike: rapid increase from baseline to 500 users.
5. Upload pressure: concurrent generated-output streams at configured maximum sizes.
6. Download pressure: concurrent authenticated streaming downloads.
7. Login surge: password hashing capacity and rate-limit behavior.
8. Quota race: concurrent reserve/commit/release on the same user.
9. Webhook storm: duplicates, reordering, invalid signatures, and provider delay.
10. Worker backlog: fallback/storage dependency slowed or unavailable.
11. Soak: several hours to reveal connection, memory, file-descriptor, and temporary-file leaks.
12. Breakpoint: controlled non-production test to identify the first actual bottleneck.

### 21.2 Workload model

The initial 500-user test mix is defined in version-controlled k6 scenarios, for example:

- 55% dashboard/usage/batch metadata reads;
- 15% batch reservation/commit lifecycle;
- 10% saved-output list/detail;
- 10% streaming download starts;
- 5% generated-output saves;
- 5% account/billing/session actions.

Percentages and request rates are updated from measured usage, not intuition. File transfer duration is reported separately from normal API latency.

### 21.3 Pass/fail evidence

Each capacity report records:

- git commit;
- Compose and application configuration;
- VPS CPU, RAM, disk, network, and region;
- seeded database size;
- output file-size distribution;
- scenario and duration;
- p50/p95/p99, throughput, error rate, and dropped iterations;
- API, DB, Valkey, worker, disk, and network graphs;
- first bottleneck;
- safe maximum and operating headroom;
- changes made and regression comparison.

Do not claim 500-user support from a laptop-only test or a test that excludes authentication, quota, storage, and database work.

## 22. Test strategy and edge cases

### 22.1 Unit tests

- plan entitlement and period calculations;
- quota state machine and ledger invariants;
- authorization policy matrix;
- payment/subscription transition tables;
- retry classification and backoff bounds;
- storage-key and filename safety;
- retention/cleanup decisions;
- event redaction;
- existing PDF adapters/state machine/confidence logic.

### 22.2 Database integration tests

- concurrent quota reservations cannot overspend;
- duplicate idempotency keys return the same outcome;
- expired reservation versus commit race;
- duplicate/out-of-order payment webhooks;
- transaction rollback leaves no partial ledger/payment/file ownership state;
- unique/check/foreign-key constraints enforce invariants;
- list pagination remains stable under inserts;
- migration upgrade and downgrade/rollback strategy where supported;
- orphan-storage reconciliation.

Use real PostgreSQL and Valkey containers for integration tests; do not replace their concurrency semantics with mocks.

### 22.3 API/security edge cases

Accounts:

- duplicate and case-variant email;
- invalid/weak/very long password;
- enumeration-resistant login/reset;
- expired, reused, tampered, and already-consumed tokens;
- session fixation, rotation, expiration, revoke, and concurrent revoke/use;
- suspended/deleted user;
- CSRF, missing origin, invalid content type;
- brute-force and distributed rate-limit behavior.

Authorization:

- user A cannot read/delete/download user B output;
- users cannot invoke admin operations and admins cannot exceed their explicit permissions;
- role changes invalidate relevant sessions/cache;
- client-supplied user/role/plan fields are ignored;
- pagination/search cannot reveal restricted PII.

Quota:

- exact boundary, one over, midnight reset, timezone/DST library behavior;
- 100 concurrent commits with limited remaining credits;
- retry after network disconnect;
- partial batch, skipped/review/failed pages;
- admin adjustment during an active reservation;
- downgrade/upgrade during the period.

Files:

- wrong magic bytes, polyglot/truncated/encrypted/malformed PDF;
- oversized file, batch, page count, filename, and metadata;
- client disconnect during upload/download;
- disk full, read-only disk, checksum mismatch, missing file;
- cleanup versus active download;
- path traversal and header injection.

Billing:

- invalid signature/raw-body mutation;
- duplicate, delayed, and out-of-order webhook;
- captured, failed, refunded, cancelled, and ambiguous states;
- provider timeout before/after order creation;
- repeated checkout click and callback replay;
- reconciliation corrects a missed webhook without double entitlement.

Queue/providers:

- broker restart, worker crash, hard timeout, poison task;
- retry storm prevention and exhausted retry handling;
- provider 429/Retry-After, 5xx, slow response, invalid payload;
- circuit opens and optional feature degrades without blocking core flow.

### 22.4 Browser E2E

- register, verify, login, logout, reset;
- pricing/checkout test-mode flow;
- mixed marketplace processing under authenticated quota;
- progress, review, bulk approve, save, preview, download, and Print All;
- saved output appears and respects ownership/expiry;
- quota exhausted and reservation expiry UX;
- individual page failure does not kill a batch;
- admin user/credit action and audit entry;
- responsive and keyboard workflows;
- browser file picker and drag/drop;
- browser/OS print invocation is requested, never silent USB printing.

### 22.5 Quality gates

Every phase runs relevant:

- Vitest;
- Pytest unit and container integration tests;
- Playwright;
- TypeScript typecheck;
- ESLint;
- Prettier;
- Ruff lint/format;
- production builds;
- OpenAPI contract drift check;
- migration check;
- dependency/security scan;
- Docker Compose config/build/health verification.

Never silence a failing check with `any`, broad ignore comments, removed tests, or relaxed security rules without a written technical justification.

## 23. Deployment topology on Hostinger

### 23.1 Launch topology

Production Compose remains one project with private networks:

- Caddy exposed on 80/443;
- one or more Next.js instances;
- two or more API processes/instances only if the measured VPS memory permits;
- isolated Celery worker pools by queue;
- one Celery Beat scheduler;
- PostgreSQL not exposed publicly;
- Valkey not exposed publicly;
- persistent generated-output, database, broker, Caddy, and backup volumes;
- optional monitoring components only after their resource budget is measured.

The current local `compose.yaml` remains the zero-config development path. Add a production override/config rather than embedding production secrets/defaults into the local file.

### 23.2 Caddy

- automatic HTTPS on a stable domain;
- strict request body limits by route;
- reverse proxy timeouts appropriate to streaming versus normal API calls;
- active/passive health checks when multiple upstreams exist;
- trusted proxy ranges only when an actual upstream proxy/CDN is added;
- security headers and request IDs;
- no buffering configuration that forces whole generated PDFs into memory;
- access logs redact query strings/headers that could contain secrets.

### 23.3 PostgreSQL

- explicit connection budget across all API and worker processes;
- bounded SQLAlchemy pool with acquisition timeout;
- statement/lock/idle-in-transaction timeouts where appropriate;
- indexes justified by real queries and `EXPLAIN` evidence;
- PgBouncer only when connection measurements justify it;
- backups, restore drills, vacuum/analyze monitoring, and disk alerts;
- no public port and unique production credentials.

### 23.4 Scaling path

Scale in this order:

1. measure the bottleneck;
2. remove obvious inefficient query/file buffering/serialization;
3. tune bounded concurrency and pools;
4. add API/web worker processes within safe memory;
5. add isolated Celery workers for the saturated queue;
6. vertically resize the VPS if CPU/RAM/disk/network is the constraint;
7. move PostgreSQL or storage to a separate private host only when measured contention/reliability requires it;
8. add another application VPS behind a health-aware load balancer only when single-host availability/capacity is no longer acceptable.

A single VPS remains a failure domain even with multiple containers. This limitation must be public internally and included in the risk register.

### 23.5 Release process

- CI builds and tests immutable images.
- Take/verify backup before risky migration.
- Run migration as a one-off controlled step.
- Deploy compatible app containers.
- Verify live/readiness, migrations, queue, login, quota, save, download, and test-mode billing smoke paths.
- Monitor error/latency/queue/disk during a defined observation window.
- Roll back application image when safe; use database rollback only if migration design permits it.
- Never run two incompatible schema versions concurrently.

Public launch needs a domain and HTTPS. An IP or temporary host is sufficient only for private testing.

## 24. Graceful degradation matrix

| Failure                         | Required behavior                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Gemini/OpenAI unavailable       | deterministic local flow and manual review continue                                |
| ImageKit unavailable            | local storage remains default; no boot failure                                     |
| fallback queue saturated        | reject/defer fallback; local/manual processing continues                           |
| email provider unavailable      | account action remains pending; bounded retry and clear message                    |
| Razorpay unavailable            | checkout unavailable/pending; no false entitlement                                 |
| Valkey unavailable              | authoritative reads continue where safe; async work pauses; no lost business truth |
| PostgreSQL unavailable          | fail closed for auth/quota/payment/save; static/public page may remain available   |
| generated-output disk near full | stop accepting saves before full; immediate local download remains                 |
| cleanup job fails               | alert and reconcile; do not affect current processing immediately                  |
| one API instance unhealthy      | Caddy removes it when another healthy instance exists                              |
| entire VPS unavailable          | external alert and documented restore/failover procedure                           |

## 25. Phased implementation

These are release phases and are distinct from the existing PDF pipeline Phases 0-10.

### R0 - Baseline, decisions, and characterization

- Freeze current behavior with tests.
- Record current dependency and file-size inventory.
- Read required local Next.js docs and `crazi-stufsss` references.
- Create ADRs for auth, UI primitives, API contract generation, email delivery, retention, and monitoring.
- Establish production capacity assumptions and obtain VPS specifications.
- Add architecture/import boundary strategy.

Exit criteria: decisions are explicit; no security-sensitive library remains an unreviewed guess.

### R1 - Safe modular refactor

- Split `pdf-engine.ts` by pipeline responsibility without behavior changes.
- Split global CSS into tokens/base/layout/feature modules.
- Preserve public interfaces while migrating callers.
- Add characterization and regression tests.
- Enforce the 600-line handwritten-file gate for new changes.

Exit criteria: same PDF outputs and E2E results; no big-bang rewrite.

### R2 - Database migrations and foundations

- Add Alembic and baseline current schema.
- Add user/access, plan, subscription, ledger, storage, idempotency, inbox/outbox, and audit tables.
- Add constraints/indexes and repository boundaries.
- Add real Postgres concurrency tests.

Exit criteria: clean database can migrate from zero; current database can upgrade; restore/rollback procedure tested.

### R3 - Authentication and account security

- Implement selected auth ADR.
- Registration, verification, login/logout, reset, sessions, revoke, security events.
- Add rate limits, CSRF, secure cookies, and staff MFA.
- Add public auth UI using chosen component/form libraries.

Exit criteria: security edge-case suite and Playwright auth flows pass.

### R4 - Authorization, plans, and atomic quota

- Permission dependencies/policies.
- Database-backed plan catalog and entitlements.
- Reservation/commit/release ledger.
- Usage display and quota-exhaustion UX.
- Admin adjustment with immutable audit trail.

Exit criteria: concurrency test proves no overspend/double debit.

### R5 - User dashboard and private output storage

- Dashboard shell and navigation.
- Batch metadata history.
- Streaming save/finalize/list/download/delete.
- Retention and orphan reconciliation.
- Disk admission control and alerts.

Exit criteria: cross-user access tests pass; disk-full/client-disconnect behavior is safe; restore drill succeeds.

### R6 - Razorpay test-mode billing

- Order/subscription integration through adapter.
- Signature verification, inbox, async transitions, reconciliation.
- Billing pages and plan activation.
- Cancellation/refund behavior defined and tested.

Exit criteria: all webhook/order edge cases pass in test mode; no UI-only activation.

### R7 - Admin panel

- Redacted user operations.
- Credits, plans, subscriptions, payment reconciliation.
- Audit and failed-job operations.
- Staff MFA and permission tests.

Exit criteria: role matrix and privilege-escalation tests pass; every mutation is audited.

### R8 - Queue isolation and resilience

- Split worker queues and Beat service.
- Add task contracts, retry caps, jitter, deadlines, failure records, and outbox/reconciliation.
- Add provider concurrency limits/circuit breakers only where evidence supports them.
- Add user-facing queued/degraded states.

Exit criteria: broker restart, worker crash, provider failure, and poison-task tests recover safely.

### R9 - Observability and operational readiness

- Structured redacted logging and request/task correlation.
- Metrics and dashboards.
- external uptime alerting;
- runbooks, backup alerts, disk/queue/DB alerts.
- CSP/security headers rollout.

Exit criteria: staged failures trigger correct alerts and runbooks are executable by someone other than the implementer.

### R10 - Capacity and surge qualification

- Version-controlled k6 suite.
- Baseline, 500-user load, spike, upload/download, webhook, queue, soak, and breakpoint tests.
- Tune pool, worker, concurrency, resource limits, and admission control.
- Record safe operating limit and headroom.

Exit criteria: stated thresholds pass on recorded Hostinger hardware with no correctness failure.

### R11 - Production deployment rehearsal

- Production Compose/Caddy/domain/TLS/secrets.
- Backup/restore and migration rehearsal.
- Test-mode billing and full E2E on production-like host.
- Rollback rehearsal and incident contacts.

Exit criteria: clean-machine deploy, restore, rollback, and smoke checklist pass.

### R12 - Controlled launch

- Small invite cohort.
- Low initial system-wide fallback limits.
- Monitor SLOs, queue, disk growth, payment reconciliation, and support issues.
- Increase cohort/capacity only after evidence.
- Publish honest limits and status/support paths.

Exit criteria: stable observation period and signed launch checklist.

## 26. Mandatory pre-implementation reading gate

Before implementing any new API, queue, cache, retry policy, UI system, auth path, billing integration, storage boundary, or folder architecture, the implementing agent/developer must:

1. read the relevant existing repository files and tests;
2. read `apps/web/AGENTS.md` for any web change;
3. read the relevant installed Next.js guide under `apps/web/node_modules/next/dist/docs/` for any Next.js change;
4. inspect the relevant materials under `C:\Users\asnoi\Downloads\crazi-stufsss`;
5. verify time-sensitive claims against current official documentation;
6. write or update the relevant ADR before adding a major dependency or changing a boundary;
7. state which files and contracts will not be changed;
8. define verification and rollback before editing.

Routing for the `crazi-stufsss` materials:

| Change                                        | Required material                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| folders, dependencies, UI, tests, file size   | `agent-safe-architecture-folder-ui-testing-rules.md`                                                           |
| new/change API                                | `contract-first-api-engineering-agent-playbook.md`, `system-design-api-agent-playbook.md`                      |
| retry, timeout, provider calls, queue failure | `resilience-timeouts-retries-circuit-breakers-agent-playbook.md`, `system-des-fail.txt`, `supabse-prevent.txt` |
| cache                                         | `caching-cache-aside-production-agent-playbook.md`                                                             |
| scaling and surge                             | `api-scaling.txt`, `system-design-api-agent-playbook.md`                                                       |
| proxy/load balancing                          | `api-gateway-reverse-proxy-load-blancer.txt`                                                                   |

The remaining research files are read only when their subject matches the feature. Do not treat unrelated contact-enrichment or scraper recommendations as project requirements.

If the external folder is unavailable, this plan's embedded rules remain mandatory, and implementation pauses only when a missing source contains a decision not captured here.

## 27. Documentation freshness and primary references

The following official references informed this plan. Re-check them at implementation time because versions and security guidance change.

- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [Next.js Proxy guide](https://nextjs.org/docs/app/getting-started/proxy)
- [Next.js instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation)
- [Next.js `use cache` reference](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- [FastAPI server workers](https://fastapi.tiangolo.com/deployment/server-workers/)
- [Celery tasks, idempotency, and retries](https://docs.celeryq.dev/en/stable/userguide/tasks.html)
- [Celery optimization and queue monitoring](https://docs.celeryq.dev/en/stable/userguide/optimizing.html)
- [Valkey persistence](https://valkey.io/topics/persistence/)
- [Valkey key eviction and memory limits](https://valkey.io/topics/lru-cache/)
- [PostgreSQL concurrency control](https://www.postgresql.org/docs/current/mvcc.html)
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [Caddy reverse proxy, health checks, and load balancing](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy metrics](https://caddyserver.com/docs/metrics)
- [Grafana k6 API load testing](https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/)
- [Grafana k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Razorpay Python server integration and payment verification](https://razorpay.com/docs/server-integration/python/test-app/)
- [Razorpay security checklist](https://razorpay.com/security/checklist/)
- [Radix Primitives overview](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [Hostinger VPS backup and restore](https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps-at-hostinger/)
- [Hostinger VPS firewall](https://www.hostinger.com/support/4805502-how-to-set-up-a-firewall-at-vps/)

## 28. Decisions required before coding

The following decisions are intentionally not fabricated by this plan:

- exact Hostinger VPS CPU/RAM/disk/network tier;
- production domain;
- final retention and saved-byte limits per plan;
- trial/free-plan behavior;
- tax/refund/cancellation wording;
- maintained auth library selected by the R0 compatibility/security spike;
- email delivery provider and sender domain;
- external uptime/alert delivery channel;
- off-machine encrypted backup destination;
- whether generated-output history is enabled for all plans at launch;
- measured API pool/worker/concurrency/resource-limit values.

These do not block R0 research and characterization. They block the phase that depends on them.

## 29. Definition of production-ready

The system is production-ready only when:

- all R0-R11 exit criteria are evidenced;
- a clean Hostinger deployment and documented restore both work;
- database migrations replace production `create_all`;
- auth, sessions, MFA, authorization, quota, storage, and Razorpay test-mode paths pass security/edge tests;
- original PDFs stay local by default and saved generated PDFs are private;
- 500-concurrent-user test passes on recorded hardware, or public capacity claims are reduced to the proven number;
- overload returns bounded queue/rejection states without data corruption or cascading failure;
- queue retries are capped, jittered, observable, and recoverable;
- backups have been restored, not merely created;
- disk, database, queue, payment, and uptime alerts are live;
- no handwritten product file exceeds 600 lines without explicit approved justification;
- every new major dependency has an ADR and no competing UI/auth/state systems were added casually;
- CI passes lint, formatting, typecheck, unit, integration, contract, E2E, build, migration, security, and Compose verification;
- known limitations, retention, support, privacy, refund, and terms are visible to users;
- an incident rollback and reconciliation runbook exists.

Correctness, privacy, and recoverability take priority over superficially completing the dashboard.
