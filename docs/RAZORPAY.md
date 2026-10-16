# Razorpay Subscriptions rollout

Billing is **off by default**. The API receives the Razorpay API keys and webhook
signing secret; the trusted worker receives only the API keys. The web, migration
and storage containers receive none. Never
put them in a `NEXT_PUBLIC_` variable, a frontend file, a URL, or a support message.
The browser receives only Razorpay's hosted HTTPS subscription link.

## Test mode first

1. In Razorpay **Test Mode**, create three INR plans with period **monthly** and
   interval **1**: Starter ₹99 (9,900 paise), Growth ₹199 (19,900 paise), and
   Scale ₹299 (29,900 paise). Copy their `plan_...` IDs into the matching
   `RAZORPAY_PLAN_*` variables in the private staging `.env`.
2. Use an isolated staging deployment with its own database and HTTPS URL;
   **never expose Test Mode checkout on the production site**, because test
   charges could otherwise grant real account credits. Create a **separate**
   random webhook secret in Razorpay's Test Mode webhook settings. Subscribe
   `https://YOUR-STAGING-HOST/api/v1/billing/webhook` to
   `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
   `subscription.pending`, `subscription.halted`, `subscription.paused`,
   `subscription.resumed`, `subscription.cancelled`, `subscription.completed`,
   and `refund.processed`. Put the exact signing secret
   in `RAZORPAY_WEBHOOK_SECRET`. Do not reuse `RAZORPAY_KEY_SECRET`.
3. Set `RAZORPAY_MODE=test`, Test Mode `RAZORPAY_KEY_ID` and
   `RAZORPAY_KEY_SECRET` privately on staging. Set `BILLING_ENABLED=true`
   **only on staging**. Recreate
   `api` after the additive migration succeeds. Do not enable live checkout by
   copying test IDs into a live-key configuration.
4. With a verified test account, buy a plan using Razorpay's test instruments.
   Confirm a `subscription.charged` webhook, exactly one billing charge row,
   the new daily allowance, and cancellation at the current cycle end. Repeat
   the webhook and check that credits do not change twice. Test a declined
   payment, a halted renewal, an abandoned created subscription, activation
   arriving before charge, a missed webhook recovered from invoices, and a full
   refund. Neither declined nor abandoned payments may upgrade credits.
5. Before live mode, set `RAZORPAY_MODE=live` and configure **new live** key pair,
   plan IDs, and webhook secret, with the live webhook at
   `https://sellerlabel.in/api/v1/billing/webhook`. Confirm Razorpay account
   approval, legal/business identity and
   refund-policy wording with the operator. Set a monitored webhook alert email
   in Razorpay Dashboard and confirm delivery. Take a database backup. Only then
   turn on `BILLING_ENABLED=true` and deploy the API/web build.

### Local Test Mode webhook

The local app is at `http://127.0.0.1:8080`, but **do not tunnel port 8080**:
its development Caddy also serves Mailpit. Use the optional webhook-only
Compose service instead. It forwards only `POST /api/v1/billing/webhook` and
returns 404 for every other request:

```powershell
docker compose -f compose.yaml -f compose.webhook-test.yaml up -d --no-deps webhook-test
curl.exe -i http://127.0.0.1:8081/
```

The second command should return 404. With zrok2 installed and enabled, run
`zrok2 share public 8081` in a separate terminal. Keep it running and copy its
public HTTPS URL. In **Razorpay Test Mode**, add a webhook at
`https://YOUR-ZROK-URL/api/v1/billing/webhook` with the same event selections
listed above. Create an independent signing secret there and set it as
`RAZORPAY_WEBHOOK_SECRET` in the private local `.env`. The Test Mode plan IDs,
Test Mode key pair, `RAZORPAY_MODE=test`, and `BILLING_ENABLED=true` are also
required. Recreate the API with `docker compose up -d --no-deps --force-recreate api`.
Use a verified test account at `http://127.0.0.1:8080/dashboard/subscription`.
Credits change only after a valid `subscription.charged` webhook, not merely
after opening checkout. Turn the public share off when finished. Never expose
Live Mode credentials or a real payment flow through the local test tunnel.

Razorpay currently blocks `localhost` and many common tunnel domains for
webhook URLs; its [test webhook guidance](https://razorpay.com/docs/webhooks/validate-test/)
recommends zrok for local testing. A separate staging host is the other option.

Never disable the Razorpay keys or webhook secret while paid subscriptions may
still renew; setting `BILLING_ENABLED=false` only stops **new** checkout.

The server verifies each provider plan's INR amount and monthly frequency
before checkout. Keep offers, coupons, add-ons, and plan price changes off these
three plan IDs: an amount mismatch is flagged for manual review, never granted
automatically. A signed webhook is persisted and acknowledged promptly; the
worker verifies the captured payment, paid invoice, subscription link, billing
period and single plan line item before granting credits. A periodic invoice
reconciliation recovers a missed charge without trusting browser claims. Old
periods cannot extend access. The provider's auto-renewal has a 120-cycle
maximum and can be cancelled by the
seller in Account / Subscription. A failed or abandoned payment does not grant
credits. The worker must remain running even if new checkout is disabled because
existing subscriptions can still renew. After any outage, inspect the worker logs,
Razorpay webhook deliveries and reconciliation reports. Keep one worker replica
while it embeds Celery Beat; scaling workers also duplicates the scheduler.
Database claims prevent duplicate credit grants, but a standalone single Beat
service is required before scaling the worker tier.

### Paid upgrades

Starter, Growth and Scale have 300, 700 and 1,200 daily credits respectively.
A seller can buy only a **higher** tier while an earlier paid period remains.
This creates a new full-price monthly Razorpay subscription; it does not edit
the old mandate, prorate the price or refund the earlier payment. Razorpay's
hosted checkout must show and authorise the entire new tier's price. Only a
worker-verified captured full-price invoice activates the new allowance.
While both paid periods overlap, allowances add (Starter + Growth = 1,000/day).
Credits already used that day still count. When Starter's paid period ends,
Growth alone gives 700/day. No second purchase is permitted for the same or a
lower tier, and a new checkout cannot start within 24 hours of a renewing
paid period's end; use support for that timing edge case.

The `billing.cancel_superseded` worker task runs every 20 seconds after a
higher-tier payment is verified and stops renewal on every lower active tier
**at its cycle end**. It never shortens already-paid access. The operation is
retried if Razorpay is unavailable. `/health/ready` reports
`billing_upgrade_cleanup: stale` (HTTP 503) if a verified upgrade's previous
renewal is still open after five minutes. Investigate this before its next
renewal; the task and webhook worker must run together. Test the full upgrade
and cancellation flow with small controlled payments before offering it broadly.

To backfill one account without an admin dashboard, find its existing `sub_...`
ID and run:

```bash
docker compose exec -T api python -m app.cli reconcile-billing --subscription-id sub_EXAMPLE
```

The command only grants credits from a matching paid Razorpay invoice and captured
payment; it never accepts an amount or credit count from the operator. A nonzero
exit or `flagged` count requires investigation. Do not paste private keys, complete
`.env` files or customer payment details into chat. A future admin dashboard can
read these billing records and expose an audited manual-credit workflow; it is
not required for the initial repair path.

## Safe deployment checks

From `/opt/sellerlabel`, inspect the current services and Git status first.
Do not use `docker compose down` or change the host Nginx/other sites. After a
database backup and a successful Test Mode deployment, build the `migrate`,
`api`, `web` and `worker` images, run the one-shot migration, then recreate
**all three long-running code services** (`api`, `web`, `worker`) together. The
worker owns billing inbox draining and hourly reconciliation; an old worker
can leave paid sellers without credits even while the webhook returns 200.
Never recreate the API without its matching worker image.

Check `docker compose ps api web worker` and
`curl -fsS https://sellerlabel.in/health/ready` after the rollout. Readiness
returns 503 with `billing_inbox: stale` if the oldest unprocessed billing event
is at least five minutes old. The API container healthcheck deliberately uses
`/health/live`, so a billing backlog cannot prevent Caddy from starting or
take the free tool offline. Configure an external uptime alert for non-200
readiness responses and investigate any nonzero
`billing_oldest_unresolved_seconds` that keeps rising. Also inspect the
`billing_upgrade_cleanup` status after an upgrade; a stale value means the
previous plan might still renew. Also inspect the
signed-in subscription status and Razorpay
webhook delivery dashboard. Do not paste a full `docker compose config`,
`.env`, or process environment into chat; those can contain secrets.

Official references: [create a plan](https://razorpay.com/docs/api/payments/subscriptions/create-plan/),
[create a subscription](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/),
[cancel a subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/),
[validate and deduplicate webhooks](https://razorpay.com/docs/webhooks/validate-test/).
