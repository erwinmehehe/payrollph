# Linaw — Self-Serve Registration and Subscription Launch Runbook

**Status: implementation is a draft and remains disabled until the gates below pass.** Never switch feature flags on as a substitute for tests.

## Customer purchase flow

1. Customer visits /pricing and chooses Core, Scale or Enterprise.
2. /signup takes the proposed number of **paid employee seats**, company name, owner email and strong password. No demo employees or sample financial entries are inserted.
3. The submitted email must be verified using a 60-minute, single-use token. Pending accounts cannot sign in before verification.
4. Owner signs in and sees /billing/setup. The shown monthly PHP price comes from pricing_plans: base fee + per-seat fee × seats.
5. Checkout opens the Xendit-hosted Subscription Payment Session. Customer authorizes their compatible recurring payment method. Linaw never receives the card number.
6. Subscription remains pending until authenticated Xendit webhook **recurring.cycle.succeeded** confirms money collected. A browser success redirect never activates the service.
7. A successful cycle creates a paid invoice, starts the paid-through window, unlocks payroll mutation routes and leaves employee headcount at zero until onboarded.
8. Xendit attempts the following monthly renewal. A verified cycle payment extends the paid-through date. On failure, past-due status appears, but prepaid access persists through its paid-through date.
9. Cancellation requires the owner/admin's password and stops provider renewal. Retain access until paid-through. Retain payroll/employee/audit records per the applicable retention and privacy policy. Cancellation is not a refund.

## Reconciliation, refunds and support

- **Never activate from browser redirect, checkout creation, or a plan activated event.** Only verified paid cycle.
- Treat Xendit event IDs as idempotency keys. Alert on duplicate/replayed events, unexpected plans/amounts, failed deliveries and unknown references.
- If Xendit creates a checkout but the response is lost, mark the local checkout `review_required`. An operator must find the reference in the merchant dashboard and reconcile it. Do not blindly create a second mandate.
- Reconcile Xendit settlements, provider fees, bank deposits and platform paid invoices. Check first-month collection and consecutive monthly cycles.
- Enforce purchase amounts as immutable snapshots until explicitly approved changes. Review tax treatment and invoice/receipt requirements with a Philippine accountant before launching. Xendit payouts to the merchant's verified settlement account follow the provider's schedule; deposits are not directly initiated from our payroll app.
- Document a support policy for refunds, double payments, contested charges, billing date changes, payment-method updates, plan changes, and card expiration.
- During payment failure, provide a self-service update-payment-method/recovery path before the general launch. Never ask the customer to email card details.

## Required merchant and environment setup

**Do not paste credentials into GitHub or chat.** Configure in the correct environment's encrypted secret store only.

| Key | Use |
| --- | --- |
| `XENDIT_BILLING_ENABLED` | `true` only after merchant verification and sandbox tests |
| `XENDIT_SECRET_KEY` | Server-side account key for creating subscription sessions |
| `XENDIT_CALLBACK_TOKEN` | Verify `x-callback-token` at the webhook receiver |
| `XENDIT_BUSINESS_ID` | Check webhook belongs to the expected Xendit business |
| `APP_BASE_URL` | HTTPS canonical customer URL |
| `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` or `SMTP_URL` | Owner verification and receipts |
| `SELF_SERVE_SIGNUP_ENABLED` | `true` ONLY after complete launch approval |

On the Xendit merchant dashboard, enable Subscriptions and recurring-compatible Philippine payment methods; register the callback endpoint `https://<app-host>/api/webhooks/xendit/subscriptions`. Verify that enabled methods truly permit unattended recurrent debit (one-time GCash payments do not imply auto-debit). Add payment-method update and portal instructions.

**Current implementation limitation:** existing one-off PayMongo checkout is not recurring. When Xendit billing is enabled, the legacy checkout endpoint returns a redirect to the new billing portal.

## DB/schema & deployment order

- **Dependency order:** review/merge #667 (0100–0103), then #673 (0104), then #682 (0105), then this billing integration (0106). The ESS and billing Drizzle schema lists and app navigation are merged on this branch; no duplicate migration prefix remains.
- Use reviewed migration `drizzle/0106_saas_selfserve_recurring_billing.sql` on the intended staging database. Compare with generated Drizzle diff. Backup, apply, verify indexes/constraints and rollbacks, then deploy. **Do not apply this migration on a production database from an unreviewed PR.**
- Run full CI and browser tests. Test organization isolation (two customers), zero-data dashboard, plan/seat quote, employee imports and limits, paid checkout, failed checkout, retry, duplicate webhook, missed webhook, cancellation and expiry.
- Confirm configuration on **the correct Vercel project/team**; current connected Vercel account has not identified a PayrollPH deployment, so there is no authorized target for automatic deployment.
- Use a staged production build and post-deployment tests before traffic cutover. Keep a rollback strategy for app code *and separately* for stateful migrations.

## Live operational checks

- Uptime probe `/api/health` must consistently reflect DB connectivity. Configure an external uptime monitor and on-call contact.
- Review and alert on exceptions and error budgets for auth, checkout, callback validation, invoice inserts, failed renewals, mail delivery, trial activation, backup health and scheduler.
- Maintain offsite DB backups with restore rehearsal; do not conflate a passing CI restore rehearsal with an observed production restore.
- Enforce secure vendor keys, environment separation, rotated secrets, company access boundaries, audit logs and least-privilege admin roles.
- Run a billing reconciliation each business day: Xendit succeeded cycles vs invoices, settled deposits, unknown plans, retries and unpaid organizations.
- Publish subscription agreement, recurring consent language, cancellation process, refund policy, privacy policy, terms of service, retention/deletion timeline, contact/support channel and complaint escalation flow.
- Confirm customer-facing invoice documents satisfy local accounting/tax rules before calling the checkout production-ready.

## Release-gate tests

- [ ] Email verified and one-time token cannot be reused
- [ ] New company shows 0 employees and no synthetic sample data
- [ ] Amount matches live pricing catalog AND checkout AND first settled charge
- [ ] Plan/seat snapshot cannot be modified from request body at checkout
- [ ] Payment rejected/canceled does not activate subscription
- [ ] Authenticated first-cycle payment activates exactly once (duplicate webhooks harmless)
- [ ] Second recurring cycle advances paid-through and records exactly one invoice
- [ ] Failed cycle yields a correct status, no extension of paid access
- [ ] Cancel deactivates renewal at Xendit and preserves paid period
- [ ] Customer can retrieve data and invoices after cancellation
- [ ] Seat cap enforced on manual creation and bulk imports, including concurrent requests
- [ ] No cross-tenant access via manipulated org IDs/employee numbers
- [ ] No plain card or Philippine government IDs in audit logs/checkout metadata
- [ ] Merchant bank settlement and financial reconciliation observed
- [ ] Backup restore, production monitors and support handoff verified

## Roadmap after initial launch

- Plan upgrades/downgrades, increased seat mandates and plan change notification/consent, proration policy and Xendit patch recurring plan.
- Payment method update and failed invoice retry journey: use provider-generated recovery URL and verified callbacks.
- Refund/credit notes, subscription pause/resume, tax receipts/invoice PDFs, invoice email notifications, operator dashboard.
- Reconciliation worker on scheduled intervals, anomaly alerts, overdue state enforcement across every mutation route, concurrency-safe seat checks.
