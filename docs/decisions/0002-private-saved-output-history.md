# ADR 0002: Private generated-output history

- Status: accepted
- Date: 2026-10-07

## Context

The label pipeline is browser-local by default, while an authenticated user may
want to retrieve a previously generated combined label PDF. Saving original
marketplace documents would unnecessarily retain customer addresses and other
PII. Billing is not implemented yet, so history must not pretend that a paid
credit balance exists or block the existing local workflow.

## Decision

- Saving is automatic after a signed-in user's combined output PDF is assembled.
- A visible saving/saved/error state is shown; failed automatic saves can be
  retried without reprocessing the source documents.
- The browser sends only aggregate non-PII counters and the generated
  `PRINT_READY_LABELS.pdf` artifact.
- Original marketplace PDFs, original filenames, extracted text, addresses,
  and barcode payloads are excluded from the history contract.
- PostgreSQL owns per-user history metadata. The configured private storage
  provider owns the generated PDF bytes.
- `(user_id, client_batch_id)` is unique. A repeat with the same request digest
  returns the existing record; a different payload conflicts.
- Every history read, inline preview, and download is scoped by the authenticated
  user id. Automatic saves require the existing trusted-origin and CSRF checks.
- Uploads are streamed with a byte limit, PDF magic/MIME checks, structural
  inspection, and an exact output-page-count check.
- Retention defaults to 30 days and is configurable. The existing cleanup worker
  removes both the storage object and database row after expiry.
- Dashboard usage is derived from saved batches in the Asia/Kolkata business
  timezone. It measures retained output; it is not yet the paid credit ledger.
- No plan is inferred for a user. Until subscription assignment and billing are
  implemented, `availableCredits` and `activePlan` are `null`.

## Operational consequences

- Local storage requires the existing persistent private volume on the API and
  worker. ImageKit uses a separate private saved-output folder/tag.
- `SAVED_OUTPUT_RETENTION_DAYS` and `MAX_SAVED_OUTPUT_BYTES` are bounded runtime
  settings.
- An application rollback may leave migration 0003 in place safely; older code
  ignores its additive columns/tables. The migration cannot be downgraded
  because doing so would destroy user history.
- Failed database writes delete the newly created storage object. Concurrent
  identical requests converge on one history row and one retained object.

## Deferred work

- Plans, subscriptions, quota reservations, and the append-only paid credit
  ledger.
- Razorpay checkout, signed webhooks, reconciliation, refunds, and adjustments.
- Storage admission control, disk watermarks, and backup/restore drills for VPS
  production.
- A user-triggered deletion workflow with durable deletion reconciliation.
