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
1. Seeds nine fictional employers (two attackers, six filler employers, and a higher-ID victim), checks persisted victim identifiers exceed six and all preceding employer IDs, and records complete cross-tenant snapshots.
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
- [x] The #1750 nine-employer/high-ID victim, cross-bound callback, forged replay and receipt-delta assertions are integrated in the same source-pinned PG16 runner as the audit-rollback test. **This is code reconciliation only, not proof acceptance.**
- [ ] Verify the combined tests and signed-event authority behavior on this exact final head.
- [ ] Only a separate approved source-pinned manifest promotion may alter
      tenant method status. The method stays GAP, with zero credits.

**No live Xendit calls, migration, provider keys, payment processing or deployment.**

## Integration with source-pinned #1749 main and #1750 tests (2026-11-04)

The conflict-resolution branch preserves merged main's independent #1749 payout-profile PATCH provisional credit and retains the Xendit subscriptions POST as **GAP, zero method credits**. The Xendit route's prior and current source blobs are pinned, while the same disposable PostgreSQL 16 proof runner now combines nine-employer real higher-ID victim checks and the atomic audit-veto, retry and deduplication path. This resolves test-runner overlap with #1750 **inside this branch only**, without merging that other PR or claiming its independent acceptance. Source-only inventory guards bind the exact combined proof/contract blobs. The previous passing proof logs do not certify the new combined runner: run fresh exact-head CI/PG16 and obtain independent security/billing approval before merge. No live provider requests, production-money activation, ledger credit or release authorization.
