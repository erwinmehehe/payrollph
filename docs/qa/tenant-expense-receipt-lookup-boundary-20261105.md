# Expense receipt ID-lookup tenant isolation (draft)

**Method scope:** `GET /api/expenses/receipts?claimId=...` and `POST /api/expenses/receipts` (multipart form). Both were **GAP** on current main. This work is separate from the open managed-payroll, staffing-policy, MWE, ESS payslip and company export PRs.

## Problem and boundary

Previously, both receipt handlers resolved a globally addressed `expense_claims.id` before any employer membership check. A genuine foreign claim could return a different authorization response from an unknown ID, creating a claim-existence oracle. The GET read then rechecked authorization against the *original* claim snapshot after external private-object storage I/O, without verifying that the claim, employee, receipt path or digest were unchanged.

## Hardening

- Resolve each claim only via an **active organization membership join** before loading any claim details or receipt metadata. Both foreign and nonexistent IDs now return an indistinguishable private/no-store 404.
- All out-of-scope staff, revoked and wrong-role users receive the same generic missing-receipt response. Retain original People/payroll permission, MFA and branch-scope checks.
- Before returning receipt bytes after object I/O, fetch the current membership-bound claim, check its employer/employee match, recheck the current evidence receipt storage key and SHA-256, and rerun role/employee authorization against the fresh snapshot.
- Preserve existing checked object-identity read, malware scan, receipt upload staging, active membership row locks, independent review constraints, and atomic expense-evidence/audit attachment.

## Focused validation

```sh
npx tsx --test tests/tenant-expense-receipt-lookup-boundary.test.ts
npm run typecheck
```

These are testable grant-matrix and fail-closed source contracts, **not** real multi-tenant acceptance evidence. No live keys, receipt bytes, customers or external storage are required by these tests.

## Release hold

### Dedicated HTTP acceptance prepared; execution pending

`tenant-receipt-boundary-http.yml` now prepares an isolated production-mode Next
server, disposable PG16 and a localhost HTTPS byte-store/scanner contract fixture.
TLS verification stays enabled with a freshly generated disposable CA. No real
storage account, malware provider, payroll employer or deployed flag is involved.
The fixture is explicitly not S3 protocol or real antivirus acceptance.

The runner exercises two own uploads/downloads, a separately working higher-ID
victim receipt, forged employer selectors, foreign/missing denial parity, revoked
and out-of-unit grants, wrong-worker access, verified-byte corruption, observed
remote-read revocation/replacement/reassignment races, failed upload staging and
an audit-write fault. Victim claims/evidence/documents/employees/payroll/audit
snapshots are compared after each attacker's journey. Response discrimination
must reject another employer's receipt bytes.

**NOT_RUN:** these HTTP assertions must pass on the final PR head. Local source
and contract checks do not count as HTTP execution or coverage credit. Both
methods remain GAP with zero new credits. Runtime guards and production flags
are unchanged.

- [ ] Passing exact-head typecheck, unit/regression CI, lint, CodeQL and Security HTTP Smoke.
- [ ] Disposable PostgreSQL 16 production Next localhost real-HTTP proof for GET and POST separately: two independent employer sessions with own successful receipt GET and POST, a higher-ID real foreign claim versus unknown ID with identical 404/no-store, branch-scoped staff and wrong-employee denial, revoked membership, and unchanged victim claim/evidence/documents/audit/payroll rows.
- [ ] Independent review of claim reassignment, concurrent replacement, remote object readback, upload recovery and audit atomicity under controlled PG16 faults.
- [ ] Independent privacy/security/payroll signoff. Do not give either method a COVERED credit until method-specific evidence and ledger review are accepted.

**DRAFT / NOT ACCEPTED / DO NOT MERGE OR DEPLOY.** No changes to payroll money, providers, schema, migrations, global tenant coverage ledger, deployment, production flags, or real private receipts.
