# EDG-02 Xendit subscription billing/audit atomicity

**Review-only security fix. No provider activation, production approval, or tenant method credit.**

## Problem
`POST /api/webhooks/xendit/subscriptions` previously committed the billing state,
invoice and provider event dedupe row inside `db.transaction` and inserted the
business audit receipt afterward. An audit insert failure therefore left an
un-audited committed billing change. Retrying the same Xendit event could
encounter an already-inserted dedupe row, leaving the audit permanently missing.

## Fix
- Use the existing `recordAuditEvent(input, tx)` transaction writer to insert the
  organization-bound audit **inside** the same PostgreSQL transaction, after
  successful paid/past-due/inactive billing changes and before commit.
- Keep duplicates, stale callbacks and acknowledged-only events unchanged and
  avoid creating audit receipts for unhandled events.
- Maintain existing provider authentication, amount/currency checking,
  plan/reference checks, and generic API errors.

## Disposable PG16 negative proof
The existing real localhost-only Xendit workflow now:
1. Seeds fictional employers and records a complete cross-tenant snapshot.
2. Installs a short-lived PostgreSQL `BEFORE INSERT` trigger on
   `public.audit_events` that deliberately rejects a successful subscription
   audit.
3. Sends a new callback and requires an HTTP 500 with **no** committed invoice,
   subscription, dedupe marker or audit entry across *any* fictional employer.
4. Drops the trigger in a `finally` block and replays the identical event.
   The retry must succeed exactly once, create an invoice and its business
   audit, and deduplicate any subsequent replay.
5. Keeps `methodCoverageCredit: false`, `productionTested: false`, and
   `certified: false` in the proof receipt.

## Merge and acceptance
- [ ] Exact-head dedicated PG16 workflow passes, and the audit-failure and
      replay counters are present in real job logs.
- [ ] CI, CodeQL and Security HTTP Smoke pass on the exact PR head.
- [ ] Independent billing/security reviewer checks transactional boundaries,
      provider authority and idempotency.
- [ ] Reconcile any overlap with test-only PR #1750 without weakening its
      nine-employer/high-ID victim evidence.
- [ ] Only a separate approved source-pinned manifest promotion may alter
      tenant method status. The method stays GAP, with zero credits.

**No live Xendit calls, migration, provider keys, payment processing or deployment.**
