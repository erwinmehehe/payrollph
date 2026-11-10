# Merged checkout method recovery

**SOLO_VERIFIED_DEV_RECOVERY. Draft; source merge and production acceptance are separate.**

This promotion adds exactly one method: `POST /api/billing`. On the branch's
starting main, 498 methods comprised 452 COVERED, 20 GAP, 15 PUBLIC-BY-DESIGN
and 11 PRIVILEGED-OPERATIONS-TOKEN-ONLY. The generated proposal is 453 COVERED
and 19 GAP; no page/action or classification credit is added.

## Executed evidence

Merged #1900's exact head `09f172f8280d345ed57decbe8a05aaf3a4e066e7`
passed [the dedicated PG16 production HTTP job](https://github.com/erwinmehehe/payrollph/actions/runs/42809117765/job/129805758274).
The successful job log contains the sanitized result now sealed in
`scripts/qa/tenant-billing-checkout-credit-receipt.json`. It records:

- Two distinct authenticated employers with persisted owned 201 checkouts:
  existing-subscription update and new-subscription insertion.
- Two actual foreign-employer 403 refusals, forged victim invoice,
  subscription and legal-entity selectors, and unchanged victim business/audit SQL.
- Persisted victim organization, user, employee, membership, pay-profile,
  invoice and subscription IDs greater than six.
- Anonymous, cross-site, unit-restricted and missing-MFA refusals before
  simulated provider traffic.

Forged secondary selectors are **ignored**, not claimed as HTTP validation
errors: the owned request stays bound to the authorized employer; the foreign
organization selector returns 403. The proof verifies the owned returned URL,
invoice owner/amount, subscription reference and simulated transport owner.

The only provider transport is a fail-closed in-process PayMongo fixture.
No real checkout, payment, plan activation or payroll disbursement occurs.
The historical proof reports zero credits; this separate reviewed writer
promotes its one method. No fresh local billing HTTP execution is claimed.

## Source identity and reconciliation

The verifier seals 53 unchanged runtime, fixture, workflow, dependency and
build-input blobs, including the billing import graph, shared employer/session
seeds, authorization/MFA/audit implementation and synthetic provider transport.
Every sealed file matches both the successful proof head and this proposal.
Drift requires fresh HTTP/PG16 proof, not an automatic repin.

`node scripts/qa/tenant-billing-checkout-credit.mjs --write` generates the
manifest, inventory and frozen closure table; `--check` verifies the identical
result without writing. Existing source-pinned credits remain intact. Tests
reject changed inputs, fabricated receipts, borrowed proof anchors and altered
route identity. Existing invitation/high-risk/six-method guards call the scoped
verifier for this exact promotion; they do not accept arbitrary new credits.

## Other candidate held

`POST payroll-runs/[id]/exports` stays GAP: manual completion has a legitimate
positive, but successful preflight and disbursement do not have a complete
source-current flags-OFF whole-method receipt. The separate legacy money
harness requires a synthetic payout-enabled profile and is not borrowed as
flags-OFF evidence. No payout flags or CI-only guards were changed here.
Approvals, readiness and Automation Studio work are owned elsewhere and are
not counted by this proposal.

## Validation and remaining gates

- 62 focused credit, inventory, closure, six-method, invitation, filing and
  high-risk tests passed.
- Full tenant selection against newly initialized private PG16: 1,644 tests,
  1,627 passed, eight failed, nine skipped. The eight failures are the existing
  seven DL-02 Windows POSIX file/permission fixtures and private-0600 preseed
  fixture. No skips or relaxed guards were added. Linux CI must validate them.
- TypeScript passed. Full lint: zero errors, ten existing warnings and zero
  warning-baseline violations.
- Repin: 2,414 unchanged, five new citations, zero repinned/review needed.
- Generic table-credit check was preview-only; its unrelated Automation Studio
  suggestion was not applied.

Final integrated-head CI is pending. If another manifest PR merges first,
sync and rerun reconciliation/repin before review. Rollback is a source revert
of this evidence proposal; no database migration, live flags or provider
configuration changes are part of it.
