# EDG-02: Xendit subscription callback, higher-ID tenant isolation proof

**DRAFT / NOT ACCEPTED / ZERO NEW METHOD CREDITS / NO PRODUCTION APPROVAL.**

## One-method ownership and independent PR scope

- Target: `POST /api/webhooks/xendit/subscriptions` only, currently **GAP** on `main`.
- Family: **EDG-02** provider subscription callbacks. This is **not** payroll
  payout, year-end, self-profile, invitations, issued workforce demand, or a
  customer-initiated subscription setup/checkout.
- Existing real-HTTP PG16 runner: `scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs`.
- Existing strict environment contract and test:
  `scripts/qa/tenant-webhook-xendit-subscriptions-contract.mjs` and
  `tests/tenant-webhook-xendit-subscriptions.test.mjs`.
- Existing exact-head workflow: `.github/workflows/tenant-webhook-xendit-subscriptions-http.yml`.
- **Original #1750 scope:** the dedicated test runner, contract tests and this document only. **Combined #1754 reconciliation:** the same high-ID proof is now tested together with #1754's transactional audit fix in the dedicated PG16 runner; #1754 also changes the handler and re-pins the source-only GAP inventory without granting coverage credits. No production flags, payroll money, migration or provider configuration are enabled.

## Evidence strengthened on this branch

The runner still refuses any test environment other than GitHub Actions with
an exact localhost production-mode app and fresh `127.0.0.1:5432/app_db`
PostgreSQL **16**, synthetic merchant and callback token, and no external
provider, payout, worker, SMTP or remote DB credentials.

1. Seed two independent fictional employers `ATTA` and `ATTB`, **six
   additional real employers**, and the actual `VICTIM` **last**. Create
   persisted employees, legal employers, members, subscriptions and checkouts
   for all nine. Check victim organization, entity, unit, owner, employee,
   subscription and checkout IDs are real safe integers **greater than 6**
   and greater than both attackers' IDs. Test low/forged-ID mutants.
2. Snapshot each employer's subscriptions, checkouts, billing state,
   event inbox, invoices, employee markers and business audit receipts.
   Every comparison must include **all nine** employers. Test missing
   snapshots, mutated filler employers, and forbidden victim writes.
3. Submit real signed simulated incoming provider events to localhost
   (no real Xendit request). Both independent employer checkouts must
   receive a positive persisted callback with tenant-bound billing event,
   invoice and business audit. The higher-ID victim gets an independent
   legitimate provider event and changes **only** its own billing rows.
4. Verify missing provider authorization, wrong business, missing checkout
   reference or plan identity, unknown event name, mismatched signed
   reference/plan pairs across A, B and victim, invalid amounts/currency,
   missing cycle IDs, stale plans, and concurrent duplicates. Compare the
   entire fictional cohort before/after. Cross-bound pairs must produce
   the same refusal body as a nonexistent pair.
5. Change **both** top-level and nested organization, subscription and
   legal employer selectors on a replay of A's real already-processed
   event. It must remain deduplicated, with no second invoice, business
   audit, or mutation of the real victim or any other employer.
6. Keep explicit `methodCoverageCredit: false`, `productionTested: false`
   and `certified: false` in the generated receipt.

## Why this is still a zero-credit review candidate

The Xendit callback credential is **platform-wide**, not one credential
per authenticated employer. A correctly signed callback for the real
victim's valid checkout is authorized provider input and is expected
to update the victim's own subscription. It is **not** the same as an
attacker-tenant session being denied the victim object. Therefore the
normal two signed-in tenant-user own-success/victim-denial model cannot
be mechanically credited by counting 401s, mismatched identities, or
synthetic provider signatures. An independent security owner must approve
a method-specific provider-authority acceptance rule before any
manifest change.

**Resolved in combined code, review still pending:** PR #1754 proposes moving the verified subscription business audit inside the same PostgreSQL billing transaction. Its integrated PG16 runner additionally injects an audit INSERT veto, checks complete rollback, retries the identical callback and verifies one invoice/audit pair with replay deduplication. This is an unaccepted proposed fix until the combined exact-head workflow passes and independent billing/security reviewers approve the code and evidence. Original #1750 remains a separate test-only PR; this document alone does not merge or certify it.

## Required checks before review or promotion

- [ ] New exact PR head: syntax checks and contract unit tests pass.
- [ ] Dedicated local-only PG16 production-mode HTTP workflow passes on
      this **exact** head, with populated A/B/victim positive rows,
      all six fillers and real victim IDs above six.
- [ ] Full repository CI and security checks pass; inspect actual job logs.
- [ ] Confirm every denial leaves victim, fillers, and unrelated employer
      business/audit rows unchanged and does not expose a victim marker.
- [ ] Independently review provider authority, event replay/idempotency,
      audit atomicity, exact source hashes, and any route changes required.
- [ ] Only after that independent signoff: reconcile the one **GAP**
      method in a separate review, without borrowing another PR's credits.
- [ ] Separately approve production billing/provider activation; this PR
      gives **no** permission to deploy, change credentials, call Xendit,
      run production migrations, or move real money.

**Until then: zero tenant-coverage credits and the existing GAP remains.**

## Combined proof-source status

The #1754 conflict-resolution head includes the higher-ID/nine-employer proof enhancements alongside the atomic-audit-veto checks. The original #1750 branch remains independent. The combined runner, contract tests, route and uncredited manifest review carry new Git blob identities, and their **new-head CI receipts must be reviewed**. Neither PR is full provider-authority acceptance, payroll/payout authorization or a live provider deployment request.
