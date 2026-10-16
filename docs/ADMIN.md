# Admin control room

`/admin` is a private, uncached control room. Every API route requires a current
database-backed admin role; hiding the navigation item is not the security
boundary. The UI has Overview, Customers, Payments, Operations and Audit pages.
It reads local verified billing records and never exposes Razorpay credentials,
payment methods, customer label PDFs or raw webhook bodies.

There is no default admin password. Promote an authorized account using the
existing `python -m app.cli create-admin --help` operator flow, then sign in
normally. The server rechecks the admin role from PostgreSQL on every API call.

Overview revenue means captured subscription charges minus fully refunded
charges in the local ledger. It is **not** Razorpay settlement, fees or tax
reporting. Paid customers have at least one subscription with `paid_through` in
the future. Label charts count saved batches, grouped by Asia/Kolkata day.
Operations shows the signed webhook inbox, including pending, processing,
retrying and rejected events. A rejected item still needs investigation.

On a customer detail page, an admin can grant 1–10,000 one-time support credits
with a reason and 7-, 30- or 90-day expiry. The action requires an admin
session, CSRF validation and rate limiting, is idempotent by request ID, and
creates an audit event. These credits are used only after the daily plan
allowance, do not reset at midnight, and cannot be used after expiry. Batch
replacement reallocates the same day's bonus spend within the same database
transaction. A grant never changes a Razorpay subscription and must **not** be
used to conceal a missing charge; use the reconciliation procedure in
`docs/RAZORPAY.md` for that.

Deploy `0006_bonus_credits` with the normal migration job **before** recreating
the API, web and worker images together. This migration only adds grant and
spend tables and their indexes. Back up the database first. Do not deploy the
new API against the old schema; even ordinary credit checks now read the new
tables. Confirm `/health/ready` is 200 after rollout.

This first admin release does not create refunds, edit live Razorpay plans, or
trigger invoice reconciliation from the browser. Those actions still use the
documented operator process/provider controls; later UI actions should be
added only with their own audit and recovery tests.
