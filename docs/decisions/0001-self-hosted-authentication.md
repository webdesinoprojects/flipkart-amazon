# ADR 0001 — Self-hosted authentication with backend-owned opaque database sessions

- Status: accepted
- Date: 2026-10-07
- Scope: Release phase R3 (authentication foundation). Supersedes nothing.
- Deciders: product owner (single operator) plus the implementing engineer.

Every time-sensitive statement below is marked `Verified 2026-10-07` and must be
re-checked before an upgrade or before a new dependency is adopted.

## 1. Context

`docs/SAAS_RELEASE_AND_SCALE_PLAN.md` §9.1 requires an ADR comparing currently
maintained, self-hostable options before any authentication code is written. The
product is a browser-local marketplace shipping-label normalizer with:

- a Next.js 16.3.1 / React 19.2.8 frontend,
- a FastAPI 0.141.1 / SQLAlchemy 2.0.51 / PostgreSQL 17 backend on Python 3.13,
- Celery 5.6.3 + Valkey for asynchronous work,
- Caddy as the single integrated origin (`http://localhost:8080` locally),
- Docker Compose as the only supported zero-paid-service deployment path.

The product must add accounts, exactly two roles (`user`, `admin`), a private
dashboard, and an administration surface later. Customer PDFs stay in the
browser; the backend owns identity, authorization, and (later) quota and billing.

## 2. Decision

Authentication is **owned by the existing FastAPI backend** and uses
**opaque, revocable, database-backed sessions** carried in an `HttpOnly` cookie.
No hosted identity provider is introduced. No browser-readable JWT is issued.

Security-sensitive primitives come from maintained libraries; none are written
by hand.

## 3. Why no hosted identity provider

Clerk, Auth0, Firebase Auth, Supabase Auth, WorkOS and similar products were
rejected for this product, not in general:

- The release plan's first non-negotiable outcome is that no paid or external
  service is required to boot or to perform the core workflow. A hosted IdP
  makes login an external dependency, so a provider outage or free-tier change
  becomes a full product outage for a single-operator business.
- The backend already owns PostgreSQL, the user-facing resources, quota, and
  (later) Razorpay payments. Splitting identity into a third party would create
  a second source of truth that still has to be mirrored into `users` rows for
  foreign keys, quota, and audit.
- Data residency and privacy: the product's privacy promise is that customer
  shipping documents and seller identity stay on infrastructure the operator
  controls. Exporting the full user table to a third party weakens that claim.
- Cost: per-MAU pricing scales against the INR 99–299/month plan model.

Trade-off accepted: the operator must own password storage, session hygiene,
email deliverability, and the security review. Social login, enterprise SSO, and
MFA are not provided for free and must be implemented later (see §10).

## 4. Why not an end-to-end auth package

`Verified 2026-10-07`

| Option                                                          | Current stable | Maintained?                                                                                           | License    | Fit for split Next.js + FastAPI                                                                                                  | Decision                                                              |
| --------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Build on FastAPI + SQLAlchemy directly, with focused primitives | n/a            | n/a                                                                                                   | n/a        | Backend owns sessions; Next.js only forwards cookies                                                                             | **Selected**                                                          |
| FastAPI Users                                                   | 15.0.5         | **Maintenance mode** — "no new features will be added"; maintainers are building an unnamed successor | MIT        | Would own the user model, router shapes, and JWT/cookie strategies                                                               | Rejected                                                              |
| Authlib                                                         | active         | yes                                                                                                   | BSD-3      | OAuth/OIDC client+provider toolkit; does not provide password/session storage                                                    | Not applicable to this phase                                          |
| NextAuth.js / Auth.js                                           | active         | yes                                                                                                   | ISC        | Lives in Next.js, which would become a second authentication truth in front of FastAPI                                           | Rejected                                                              |
| Better Auth                                                     | active         | yes                                                                                                   | MIT        | TypeScript/Node-owned; the authoritative API and database are Python                                                             | Rejected                                                              |
| Supabase Auth (self-hosted GoTrue)                              | active         | yes                                                                                                   | MIT        | Adds a second database and service to Compose for one feature                                                                    | Rejected                                                              |
| Ory Kratos                                                      | active         | yes                                                                                                   | Apache-2.0 | Capable and self-hostable, but adds a Go service, its own schema, and an admin/public API split to a single-VPS modular monolith | Rejected for now; revisit if enterprise SSO/MFA becomes a requirement |

FastAPI Users was evaluated explicitly because the release plan forbids choosing
it by default. Its PyPI description states the project is in maintenance mode
and that a successor toolkit is being built. Adopting an auth library whose
replacement is already announced would mean a forced migration of the most
security-sensitive subsystem within the product's first year, so it was
rejected on maintenance trajectory — not on code quality.

Rejecting an end-to-end package does **not** authorize writing cryptography. The
narrow backend module composes the libraries in §5 and the Python standard
library's reviewed primitives.

## 5. Selected libraries

`Verified 2026-10-07`

| Library                            | Version | License   | Role                                                     | Why                                                                                                                                                              |
| ---------------------------------- | ------- | --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `argon2-cffi`                      | 25.1.0  | MIT       | Argon2id hashing, verification, and `check_needs_rehash` | Official CFFI binding to the reference Argon2 implementation; declares Python 3.13/3.14 support; typed; constant-time verification is handled inside the library |
| `alembic`                          | 1.20.0  | MIT       | Versioned migrations                                     | SQLAlchemy's own migration tool; requires SQLAlchemy >= 2.0, supports Python 3.13                                                                                |
| `email-validator`                  | 2.3.0   | Unlicense | Syntax/IDNA validation behind Pydantic `EmailStr`        | Already the library Pydantic delegates to; avoids a second regex dialect                                                                                         |
| `redis`                            | 6.4.0   | MIT       | Valkey client for rate limiting                          | Already present transitively through `celery[redis]`; Valkey is wire-compatible. Pinned explicitly because it is now a direct dependency                         |
| stdlib `secrets`                   | —       | PSF       | Session, CSRF, and one-time token generation             | `secrets.token_urlsafe` is the documented CSPRNG interface                                                                                                       |
| stdlib `hmac` / `hashlib`          | —       | PSF       | Keyed token digests and `hmac.compare_digest`            | Reviewed constant-time comparison and HMAC-SHA-256                                                                                                               |
| stdlib `smtplib` / `email.message` | —       | PSF       | SMTP transport behind the `EmailProvider` capability     | No provider SDK is required for generic SMTP or a local Mailpit capture                                                                                          |
| `axllent/mailpit` (container)      | v1.27.4 | MIT       | Local SMTP capture + REST API on 1025/8025               | Gives a complete zero-paid-service verification/reset test path without any paid provider                                                                        |

Explicitly **not** adopted:

- `passlib` — last release 1.7.4 on 2020-10-08; effectively unmaintained, and
  `argon2-cffi` is the layer passlib would wrap anyway.
- `python-jose` / `PyJWT` — no JWT is issued, so no JWT verifier is needed.
- `fastapi-csrf-protect` and similar single-maintainer CSRF add-ons — the chosen
  pattern (§7) needs no third-party algorithm, only `secrets` and
  `hmac.compare_digest`.
- `itsdangerous` — token signing is unnecessary because the server stores the
  authoritative token digest.
- `slowapi` — its in-process limiter is per-worker; the release plan requires
  Valkey-backed limits with deterministic boundaries.

## 6. Why opaque database sessions and not browser JWTs

Decision: the browser holds a 256-bit random opaque session token. PostgreSQL
holds only `HMAC-SHA-256(AUTH_SECRET, token)`.

- **Revocation is a product requirement.** The release plan requires a
  user-visible device/session list, revoke actions, revoke-all on password
  reset, and session invalidation on role change and suspension. A self-contained
  JWT cannot be revoked without a server-side deny list, which reintroduces the
  database lookup that was the only reason to choose a JWT.
- **Rotation on privilege change** is required (§14 of the phase brief). Opaque
  rows rotate by inserting a new row and revoking the old one.
- **No claims in the browser.** Role, suspension state, and verification state
  are read from PostgreSQL on every authorization decision, so a stale token
  cannot carry a stale `admin` claim.
- **Database cost is acceptable at this scale.** One indexed lookup on
  `sessions.token_digest` per authenticated API call is negligible next to the
  500-concurrent-session target, and PostgreSQL is already on the request path
  for every protected resource.
- **Hash choice.** The token has 256 bits of entropy, so a slow KDF adds cost
  without adding security; a keyed HMAC-SHA-256 digest is used so that a
  read-only database leak alone does not yield usable tokens, and so
  `AUTH_SECRET` rotation is a global revocation lever.

Trade-off accepted: every authenticated request touches PostgreSQL, and the
database is a hard dependency for login. This matches the existing degradation
matrix, which already requires auth to fail closed when PostgreSQL is down.

## 7. Cookie, CSRF, and session lifetime decisions

### Cookies

| Attribute           | Value                                                                                               | Reason                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session cookie name | `__Host-ln_session` when `AUTH_COOKIE_SECURE=true`, otherwise `ln_session`                          | The `__Host-` prefix requires `Secure`, so a single name cannot serve plain-HTTP localhost; the name is derived from the security setting instead of weakening production                                                           |
| `HttpOnly`          | yes (session cookie)                                                                                | The session token must never be readable by client JavaScript                                                                                                                                                                       |
| `Secure`            | `AUTH_COOKIE_SECURE`, default `false` in development, **forced `true` and validated in production** | Local Compose serves `http://localhost:8080`; production must fail fast rather than silently drop `Secure`                                                                                                                          |
| `SameSite`          | `Lax`                                                                                               | The app is same-origin behind Caddy. `Lax` blocks cross-site `POST`, keeps top-level navigation from verification/reset email links working, and avoids the `None` + `Secure` combination that would be required for cross-site use |
| `Path`              | `/`                                                                                                 | One application, one cookie scope; `__Host-` also requires it                                                                                                                                                                       |
| `Domain`            | omitted                                                                                             | Host-only cookies; `__Host-` forbids `Domain`                                                                                                                                                                                       |
| `Max-Age`           | absolute session lifetime                                                                           | The browser discards the cookie no later than the server-side absolute expiry                                                                                                                                                       |

### CSRF

The **session-bound synchronizer token** pattern is used, not a stateless
signed double-submit token:

1. `GET /api/v1/auth/csrf` issues a 256-bit random CSRF token, stores
   `HMAC-SHA-256(AUTH_SECRET, csrf_token)` on the session row, and sets a
   **non-`HttpOnly`** `__Host-ln_csrf` / `ln_csrf` cookie holding the raw value.
2. Every cookie-authenticated mutation must send the same value in the
   `X-CSRF-Token` header. The server recomputes the digest and compares with
   `hmac.compare_digest`.
3. `Origin` (falling back to `Referer`) must match an allowlisted application
   origin for every mutation, including unauthenticated ones.

Only the CSRF value is JavaScript-readable; the session token never is. No
algorithm is invented: the token is CSPRNG output, the comparison is the
standard-library constant-time comparison, and the server holds the authority.

Classification of each mutation (tested):

| Endpoint                          | Session cookie required | CSRF token required | Origin check |
| --------------------------------- | ----------------------- | ------------------- | ------------ |
| `POST /auth/register`             | no                      | no                  | yes          |
| `POST /auth/login`                | no                      | no                  | yes          |
| `POST /auth/logout`               | yes                     | **yes**             | yes          |
| `POST /auth/verify-email/request` | no                      | no                  | yes          |
| `POST /auth/verify-email/confirm` | no                      | no                  | yes          |
| `POST /auth/password/forgot`      | no                      | no                  | yes          |
| `POST /auth/password/reset`       | no                      | no                  | yes          |
| `DELETE /auth/sessions/{id}`      | yes                     | **yes**             | yes          |

Unauthenticated endpoints carry no ambient authority, so a forged cross-site
request to them cannot act as the victim; they are protected by the `Origin`
check and by rate limiting instead. There is no CSRF exemption for admin
endpoints. CORS is not used as a CSRF control: the deployment is same-origin and
no permissive `Access-Control-Allow-Origin` with credentials is configured.

### Lifetimes

| Setting                      | Default                                                    | Reason                                                                                                   |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Idle expiry                  | 12 hours                                                   | A seller's working day; `last_seen_at` is refreshed at most once per minute to bound write amplification |
| Absolute expiry              | 30 days                                                    | Caps the damage of a stolen cookie regardless of activity                                                |
| Email-verification token TTL | 24 hours                                                   | Long enough for delayed mail, short enough to limit replay                                               |
| Password-reset token TTL     | 30 minutes                                                 | Reset tokens are the highest-value one-time secret                                                       |
| Rotation                     | on login, on password reset, on role change, on suspension | Defeats session fixation and prevents a pre-existing session from retaining stale privileges             |

One-time tokens are 256-bit random values stored only as keyed digests, are
single-use through an atomic conditional `UPDATE`, and are invalidated in bulk
when the password changes.

## 8. How Server Components validate a session

Next.js Server Components never read or verify the session token themselves.

```
browser --cookie--> Caddy --/api/*--> FastAPI (authoritative)
Server Component --cookie header--> FastAPI GET /api/v1/auth/me
```

- A Server Component calls `GET /api/v1/auth/me` over the private internal
  origin (`API_INTERNAL_ORIGIN`, `http://api:8000` in Compose), forwarding only
  the incoming `Cookie` header. The result is memoised per render with
  `React.cache`.
- The returned DTO contains `id`, `email`, `role`, `emailVerified`,
  `createdAt`. It never contains the session token, password hash, or any token
  digest, so nothing sensitive can be serialised into the RSC payload.
- `proxy.ts` performs **cookie-presence-only** optimistic redirects. It does no
  network or database work, per the installed Next.js 16 Proxy guide, and is
  never the authorization decision.
- Every protected read and every mutation is authorized again inside FastAPI.
  Hiding UI is never treated as authorization.

No Server Action writes authentication state, so no second authentication truth
exists. Browser forms post directly to the same-origin `/api/v1/auth/*` routes
and the browser stores the `Set-Cookie` that FastAPI emits.

## 9. Compatibility

`Verified 2026-10-07`

| Component  | Version                                 | Compatibility note                                                                                                                           |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| FastAPI    | 0.141.1                                 | Cookie handling, dependencies, and `Response.set_cookie` are framework built-ins; no third-party auth middleware added                       |
| SQLAlchemy | 2.0.51                                  | `Mapped[...]` declarative models, `with_for_update`, and conditional `UPDATE ... RETURNING` are all 2.0 APIs already used in this repository |
| PostgreSQL | 17                                      | Unique index on normalized email, partial indexes for live sessions, `CHECK` constraint for the two-value role                               |
| Python     | 3.13 (container), 3.11 verified locally | `argon2-cffi` 25.1.0 and `alembic` 1.20.0 both declare 3.13 support; no 3.12+-only syntax is used                                            |
| Next.js    | 16.3.1                                  | Proxy (not Middleware), route groups, `loading`/`error` conventions, Metadata API, server-side `redirect()`                                  |
| React      | 19.2.8                                  | `useActionState` is not required; forms are small Client Components with `useTransition`-free explicit pending state                         |

The experimental `forbidden()` / `unauthorized()` conventions are **not** used:
the installed documentation marks both as `version: experimental` and they
require the `authInterrupts` flag. Stable server-side `redirect()` and
`notFound()` are used instead.

## 10. Removal and migration path

- All authentication state lives in four tables (`users`, `sessions`,
  `auth_one_time_tokens`, `security_events`) created by a single Alembic
  revision. The schema has no library-specific columns.
- The browser contract is two cookies and nine JSON endpoints under
  `/api/v1/auth`. Replacing the backend implementation without touching the
  frontend only requires preserving that contract.
- Migrating to an external IdP later means: add an `external_identities` table,
  keep `users.id` as the stable foreign key used by quota/billing/outputs, stop
  issuing passwords, and keep the same session cookie. No table would need to be
  dropped.
- Rotating `AUTH_SECRET` invalidates every session and one-time token at once;
  password hashes are unaffected because Argon2 stores its own salt.

## 11. Known gaps that this ADR does not close

- Staff MFA is required by the release plan before production launch and is not
  implemented in this phase.
- An external security review of the module is still required before public
  launch.
- Production email provider selection, deliverability, and sender-domain
  authentication are deferred; only generic SMTP and local capture exist.
- Rate limiting fails **open** for the authentication endpoints when Valkey is
  unavailable (see `docs/AUTHENTICATION.md`); an availability-versus-abuse
  decision that must be revisited before public launch.

## 12. Primary sources consulted

- OWASP Password Storage Cheat Sheet — Argon2id parameter guidance.
- OWASP Session Management Cheat Sheet — opaque session identifiers, rotation,
  idle and absolute timeouts.
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet — synchronizer token
  pattern and `Origin`/`Referer` verification.
- Installed Next.js 16.3.1 documentation: `02-guides/authentication.md`,
  `01-getting-started/16-proxy.md`, `03-api-reference/03-file-conventions/`.
- PyPI release metadata for `argon2-cffi`, `alembic`, `email-validator`,
  `fastapi-users`, and `passlib`.
- Mailpit official Docker installation documentation and GitHub release feed.
