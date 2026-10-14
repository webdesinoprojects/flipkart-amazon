# Authentication and account operations

The application owns its account system. FastAPI stores users and opaque sessions in PostgreSQL, hashes passwords with Argon2id, and exposes only same-origin cookie authentication. Public registration always creates the `user` role. The only other role is `admin`.

## Browser contract

- The session token is random, stored only as an HMAC digest in PostgreSQL, and delivered in an `HttpOnly`, host-only, `SameSite=Lax` cookie.
- Authenticated mutations also require a session-bound CSRF token in the `X-CSRF-Token` header. The readable CSRF cookie is not an authentication credential.
- Production uses `Secure` cookies with the `__Host-` prefix. Plain HTTP development uses unprefixed cookies.
- Server Components call `/api/v1/auth/me` for the authoritative identity. Next.js proxy checks only cookie presence as an early redirect; it never grants access.
- Login and recovery responses do not disclose whether an email address exists.

## Account routes

Public pages are `/login`, `/register`, `/forgot-password`, `/reset-password`, and `/verify-email`. Protected pages are `/dashboard/labels`, `/dashboard/security`, and `/admin`. `/app` redirects to the protected label workspace.

The API surface is under `/api/v1/auth`: registration, login, logout, current user, CSRF, verification, reset, active-session listing, and own-session revocation. `/api/v1/admin/access-check` is the reusable backend authorization boundary for admin pages.

## First administrator

No administrator is seeded and no HTTP route can assign the admin role. Create or promote the first operator from inside the API container:

```sh
docker compose exec api python -m app.cli create-admin --email owner@example.com
```

The command uses a hidden prompt. For non-interactive deployment, mount a secret file and pass `--password-file /run/secrets/admin-password`. Passwords are deliberately rejected as command-line values. Re-running the command is safe; promotion requires confirmation or `--yes`.

## Email development path

Compose starts Mailpit. Verification and reset messages are captured at `http://localhost:8080/mailpit/` and are never delivered externally. Set `EMAIL_PROVIDER=disabled` to disable delivery. A generic SMTP server can be configured in production without changing account logic.

Verification messages contain both a six-digit, email-bound, single-use code and a secure fallback link. This supports a seller who opens email on a phone while registering on a laptop. Confirming either credential revokes the other.

Production uses Resend through the generic SMTP capability boundary:

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USERNAME=resend
SMTP_PASSWORD=re_your_private_key
SMTP_STARTTLS=true
EMAIL_FROM_ADDRESS=accounts@sellerlabel.in
EMAIL_FROM_NAME=SellerLabel
EMAIL_REPLY_TO=sellerlabels@gmail.com
AUTH_REQUIRE_VERIFIED_EMAIL=true
```

The private Resend key belongs only in the server `.env`; it must never be committed or pasted into browser configuration.

## Session policy

Sessions have idle and absolute expiration, are checked against the database on every request, and are revoked after a password reset or security-version change. `/dashboard/security` lists active devices and lets the owner revoke each one. Suspended accounts and stale sessions cannot authenticate.

## Rate limiting and audit

Valkey-backed limits cover login, registration, verification mail, and password recovery. A Valkey outage is recorded as degraded and does not make the application fail to boot. Security events store event types, outcomes, request IDs, and bounded device summaries; they do not store passwords, tokens, full addresses, or submitted PDF contents.
