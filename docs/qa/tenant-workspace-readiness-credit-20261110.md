# Workspace readiness GET — one-method credit recovery review

**Scope:** One API method in the tenant-isolation ledger: `GET /api/readiness/workspace`. The proposed change is **452 -> 453 COVERED** and **20 -> 19 GAP**, with the total fixed at 498. The 16 page/action gaps are unchanged.

## Evidence on main (no substitute receipt)

- Merged proof PR: [#1901](https://github.com/erwinmehehe/payrollph/pull/1901), execution head `7b46658a7ea9f5eee86662cf35d7ca1730b7b5f4`; merge commit `dda898b05ba5dc14444ecb57b5c67d567bb3ea02`
- Exact-head [GitHub Actions run 42814903331, job 129825397604](https://github.com/erwinmehehe/payrollph/actions/runs/42814903331/job/129825397604): **success**, including PostgreSQL 16 isolation, production-mode localhost build, exact-head checks and real HTTP test
- Recorded job output: **3 independent own read successes, 4 authenticated foreign denials, 15 negative controls, high-ID real fictional victim business/member/pay-profile rows >6, unchanged protected SQL, zero provider calls**
- The original proof remains an **uncredited** proof by design; this separate PR is the *only* proposed credit promotion. No test proof has been rewritten or retroactively re-executed.
- Exact source pins (Git blobs): route `26378409dcfddc6bb0b726433e6896b3487a4cf7`, tenant-qualified loader `782853dada317783100dd1ee40004fa7e6126244`, proof `228db712a89f66ef775116b62e909f06cb1e6bb9`. The [receipt](../../scripts/qa/tenant-workspace-readiness-credit-receipt.json) includes the workflow and supporting source pins.
- [Fail-closed method verifier](../../scripts/qa/tenant-workspace-readiness-credit.mjs) rejects changed files, forged/borrowed receipts, stale line anchors, different method IDs, weakened route scoping and false security acceptance.

## Boundaries

The method returns employer-only *counts* for company-wide authorized administrators/bookkeepers, not individual compensation or platform-wide readiness. Foreign employers are refused. Repeated and noncanonical `organizationId` query values fail closed. The endpoint remains read-only, no-store and always `not-launch-ready` for a valid employer.

**The classification becomes a recovered method under the owner's definition only when this evidence-backed PR is reviewed, accepted and merged into `main`.** Code or green CI in a branch is *not* that acceptance. Independent tenant-security/privacy review is still pending. This method-only ledger credit does not authorize production, tenant-wide acceptance, payroll release, bank/payouts, filings or a pilot. The other API gaps and page/action gaps stay open.

## Reviewer gate

1. Verify that #1901's successful workflow belongs to the exact merged source head; inspect its actual PG16 job log.
2. Confirm all six pinned source/workflow blob hashes match current code and the receipt is unchanged.
3. Review own and foreign HTTP response privacy, source queries, duplicate-selector refusal, revoked membership and SQL immutability.
4. Require final-head CI, Security HTTP Smoke and inventory/credit-regression checks on this *credit* PR.
5. Confirm only this one method changes `GAP -> COVERED`, the manifest totals reconcile, and the 16 page/action gaps remain intact.
6. Apply the repository's source-merge policy and the owner's merge instruction. Independent security/privacy acceptance, production and launch approvals remain separate and pending.

## Reconciled after billing #1910

Main now contains billing POST's separate source-sealed credit: 453 COVERED /
19 GAP. This proposal preserves that receipt and adds only readiness GET,
producing 454 COVERED /18 GAP. Both receipts have distinct verifiers; statuses
and frozen batch totals are derived from the combined ledger. No double credit.

Current integration checks: 60 focused tests passed. Fresh private PG16 full
tenant selection: 1,676 tests, 1,659 passed /8 existing Windows permission
failures /9 skipped. Lint had zero errors/ten existing warnings, TypeScript
passed, and repin/restricted credit reconciliation passed without repinning.
Fresh integrated-head CI is required before merge.
