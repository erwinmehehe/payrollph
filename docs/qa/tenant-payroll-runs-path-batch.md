# Payroll-run path isolation batch — fictional PG16, no money

**Source-only hardening and real localhost negative-scope probes. No new tenant-method credits, production acceptance, provider activation, or financial execution authorization.**

## Exact scope

The seven requested method keys are:

| Method | Own fixture observation intended | What this batch can and cannot prove |
| --- | --- | --- |
| POST `payroll-runs/[id]/submit-review` | Draft 409; Processed with revoked/disabled checker 422 | Active checker and foreign-employer access; NOT a successful submitted review |
| POST `payroll-runs/[id]/exports` | Draft 409 with `mode=preflight` | Foreign employer and legal-entity denial; NOT a valid bank export, PayMongo preflight or disbursement |
| POST `payroll-runs/[id]/pilot-signoff` | Draft 409 | Foreign employer and legal-entity denial; NOT real independent pilot sign-off |
| POST `payroll-runs/[id]/release` | Draft 409 | Foreign employer and legal-entity denial; NOT a successful release or payslip settlement |
| GET `payroll-runs/[id]/xendit-payout` | 200 with own, distinct seeded unsent Xendit ledger row | Actual authenticated owned-data read and victim denial, pending exact-head acceptance |
| POST `payroll-runs/[id]/xendit-payout` | 409 when Xendit is not the selected provider | Scoped preflight rejection; NOT a successful provider preflight, transfer or reconciliation |
| POST `payroll-runs/[id]/payout-reconciliation` | Released run, missing PayMongo key 501 | Auth and legal-employer denial before disabled-provider reply; NOT a successful payout reconciliation or retry |

All paths preserve original role, unit, CSRF/origin, MFA, rate limiting, treasury separation and provider controls.

## Hardening applied

- `submit-review` validates **both** `userOrganizations.active` and `users.active` when selecting a checker. Revoked employer grants and disabled accounts cannot be assigned new payroll approvals.
- `pilot-signoff` now calls `requireRunEmployer` on the persisted `run.legalEntityId` before reading sign-off evidence or recording audit events.
- Shared `xendit-payout` context applies the persisted payroll legal-employer boundary to **both GET and POST**, before ledger reads or transfer actions.
- `payout-reconciliation` applies the same boundary to GET and POST before payout data reads or sensitive actions.
- `exports` and `release` already use `requireRunEmployer` and remain byte-for-byte unchanged. Provider implementations and their actual call paths are untouched.

## Disposable execution

Run `node --test tests/tenant-payroll-runs-path-boundaries.test.mjs` for source contracts.

The dedicated workflow `.github/workflows/tenant-payroll-run-path-boundaries.yml` builds production-mode Next with Postgres 16 and localhost-only HTTP, with two independent signed-in attacker employers, a third higher-ID victim employer, and synthetic exact payroll IDs. The seeded Xendit ledger is *unsent*, has an employer-specific fictional worker marker, and is only read. All other methods deliberately exercise **preconditions / denial paths** and cannot count as successful writes.

A separate multi-entity job creates a second, ungranted legal employer **inside each attacker organization**, and verifies the same-workspace access denial on all seven methods. The fixture snapshots real payroll runs, entries, Xendit batch/transfer/link rows, approvals, and audit logs after every probe. Revoked checker and globally disabled checker cases run against seeded Processed payroll with entries.

Both jobs enforce `TENANT_SECOND_PASS_MODE=isolated-ci-only`, `127.0.0.1` for PostgreSQL and app, fictional sessions and encryption keys, and flags for disabled worker, scheduler, PayMongo and Xendit payout. No real credential, production connection, webhook, payroll release, payout, retry, bank file, or sign-off is permitted.

## Acceptance and rollback

- All seven routes: **zero newly certified methods**; prior status, counts and original proof references retained.
- GET Xendit status remains GAP until exact-head success, independent proof review and coordinated manifest acceptance.
- All six POST methods are still GAP until a real positive outcome is separately authorized and proven on disposable PG16/HTTP. A feature-disabled `409`/`501` and a refused submit do not count.
- Changes to `scripts/qa/tenant-isolation-coverage-manifest.json` are **route SHA/line inventory only** to keep drift gates honest; central inventory, method statuses and metric counts are not promoted.
- Other open PRs edit that shared manifest; resolve source-row conflicts from current `main` before any merge.
- Rollback: revert this PR's four route patches and dedicated source-proof additions. No schema change or production activation exists.

A separate finance/treasury decision and real provider acceptance are required for any live transfer or recovery. An unknown provider outcome must **never** be treated as a failed transfer eligible for blind resubmission.
