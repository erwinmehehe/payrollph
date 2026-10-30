# Private Spend receipt worker-grant hardening (draft, zero coverage credits)

## Boundary and scope

The existing `GET /api/expenses/receipts?claimId=...` and multipart `POST /api/expenses/receipts` operate only when reviewed Spend, document-vault and verified upload controls are enabled. Both HTTP methods remain `GAP` in the authoritative tenant coverage manifest.

Before this narrow patch, the employee route path compared `users.employeeId` with the claim's `employeeId` and checked generic active employer membership. It did **not** verify the active membership's `workerEmployeeId` binding, nor confirm the employee record's tenant in that employee authorization branch. A stale or reassigned global account pointer plus an unrelated active employer membership must never be sufficient to access or stage a private claim receipt. This is a source-identified boundary weakness, **not** a demonstrated live cross-tenant exploit.

## Narrow source changes

- For ESS employees, resolve the actual persisted claim employee within the claim's employer. Require active **employee-role** membership for that same employer, the account's linked employee ID and an explicit membership `workerEmployeeId` match when present. The existing legacy null worker link is accepted **only** when account employee ID and same-employer active employee membership still match.
- For authorized People/payroll staff, preserve current role/permission/MFA checks and require their active employer/unit grant to still match the claim worker at the committing write.
- Before staging any unreadable upload intent, lock and verify a claim with the original employee identity, then lock the actual employee and active membership using PostgreSQL `FOR SHARE`.
- After private object-storage I/O, reject changed employee assignment and re-lock/recheck the current grant before attaching the receipt and audit in the final SQL transaction. The existing pending-object cleanup/reconciliation path is retained.
- For GET, re-authorize after reading/verifying private bytes and before returning them, to narrow the stale-membership window. This does not claim to eliminate every possible read/revocation race.
- Add focused pure grant unit tests, negative-control source assertions and a global manifest drift exception pinned to the exact route, helper and test blobs.

## Honest evidence status

**0 new COVERED method credits; both GET and POST remain GAP.** Pure unit tests and source assertions do not provide a real authenticated end-to-end security proof. Existing reviewed reimbursement tests use provider and session simulation; they do not authorize a method coverage promotion here. The source-pinned exception permits review of this bounded change without mislabeling it as complete tenant isolation.

A separate **disposable PostgreSQL 16 localhost** run is required before any method may be promoted. The independently reviewed acceptance must include:
- Two independent authenticated, lower-SQL-ID attackers and one populated higher-ID fictional victim employer, with actual own worker, claim, receipt, grant and audit rows.
- Each actor's successful own GET (verified byte/hash and no-store) and POST (scanned receipt, SQL attachment, private object and audit), not synthetic 404/500/feature-off results.
- Direct higher-ID victim claim ID probes against both attacker sessions. Also test same-employer peer claims, mismatched `users.employeeId`, mismatched `workerEmployeeId`, revoked membership, changed staff unit scope and claim worker reassignment while uploading.
- Before/after **all three employers'** workforce, membership, receipt document/evidence, payroll and audit SQL states; every denial must preserve victim and unrelated employer rows.
- Explicit revoked-grant timing checks around staging and final commit, plus failed provider/object cleanup and duplicate receipt replay behavior.
- Exact PR-head CI build, typecheck, isolated real HTTP receipts and independent security/privacy owner review.

## Merge and release gate

**DRAFT / REVIEW REQUIRED / DO NOT MERGE OR DEPLOY on source tests alone.** No shared coverage credit, schema, migrations, production database, payment, payout, worker, provider configuration, or feature-flag activation is proposed. Existing public and payroll release controls remain untouched. Do not enable reviewed Spend receipts in production based on this patch.
