# PATCH filing outcome — one whole-API-method recovery candidate

**Draft and unaccepted.** Target: `PATCH /api/compliance/filing-validations/[id]`.
The provisional inventory currently marks this API method **GAP**. This
candidate deliberately **does not** edit the inventory, acceptance baseline,
shared CI gate, production route, migrations, SDKs or release flags.

## Why this batch exists

The previous accepted-outcome proof was merged via #1877 and the independent
rejected-outcome proof already exists. Their separately completed runs do not
create an automatically accepted whole-method credit. This PR re-executes
**both** against the exact same branch head in fresh independent PostgreSQL 16
jobs, and adds a third real-HTTP guard leg for role, recent MFA and revoked
memberships.

The all-legs gate fails if *any* leg fails. The final branch review must
verify the evidence directly; no prior SHA's green status is sufficient.

## Exact-source pins

The runner refuses to connect to a database until it has confirmed that
the following Git blobs are unchanged:

- `src/app/api/compliance/filing-validations/[id]/route.ts`: `09f642a67035dc9ce22fa502d80518ba18641b0f`
- `src/lib/filing-evidence-store.ts`: `ae9b8e3f048e24b23fb35e4c9cd2334c2e44819f`
- `src/lib/filing-evidence.ts`: `85cc9ecc86daa9ab18bd6dfb08878dab32b46180`
- `src/lib/security-request.ts`: `de996ebb7eb663aaebf65f8a963d955b8bc90c9d`
- `src/lib/access.ts`: `08d3481dbd20279a4a8aef64f0932f79bec48444`
- `src/lib/multi-entity-server.ts`: `f38a8bb77a5026d581d4a92b22533fc879ea7e00`
- `scripts/qa/tenant-compliance-accepted-http.mjs`: `796a593c8eea153d45baea804fdde225ccb7c95b`
- `scripts/qa/tenant-filing-outcome-http.mjs`: `4cab7b09aca3c82259444b47d6fa6d33017c9544`
- `scripts/qa/tenant-filing-outcome-contract.mjs`: `646616813fc04e7a3762ef4471a0f5739e91f14c`
- `scripts/qa/tenant-table-http.mjs`: `31894982d768e34c1653be7c4335194f60233c6e`
- `scripts/qa/disposable-insert-veto.mjs`: `ed957b356e8a837076b97ccf82251e22b06bea65`
- `scripts/qa/tenant-table-env.mjs`: `05dcdcdbd513b0e257b6aefb5d9449117224b357`

Source drift must fail closed, be reviewed and repinned *in a new review*.

## Three independent PG16 scenarios

1. **accepted** — from the previously reviewed #1877 real-HTTP runner:
   two independently authenticated fictional owners, manual and file-upload
   SSS R-3 paths, **two owned HTTP 200 accepted transitions**, 18 denials,
   a real higher-ID victim employer/filing/payroll source, foreign-vs-absent
   indistinguishability, genuine file source reproduction, two injected
   PostgreSQL audit-insert vetoes with rollback, and unchanged cross-tenant
   SQL/audit/payroll rows.
2. **rejected** — independently re-execute the original filing rejection
   proof at this same source and exact PR head. Two signed-in owners,
   **two HTTP 200 persisted own rejections**, 16 denials, real higher-ID
   victim filing, forged IDs, identical foreign and absent responses,
   two genuine audit-veto rollbacks, and immutable protected SQL/audit.
3. **guards** — independently seed two owners, genuine employee and manager
   memberships, valid authenticated sessions lacking recent MFA, revoked
   owner memberships and a higher-ID victim. Verify all role, MFA, forged
   employer, foreign filing ID, anonymous, cross-site, invalid-ID and
   revoked-session denials. Reject leaks and compare protected SQL tables
   after **every** denial.

Each case starts with an empty database and builds the production-mode Next
server on `127.0.0.1:3000` with `postgres:16`.
No real payroll calculations, payments, agency portals, email delivery,
external keys, or production tenants are involved. The accepted test's
acknowledgement string is explicitly **fictional**, not evidence of a
government filing. Both action paths preserve separate legal-employer,
payroll-run, role, MFA, origin and transactional audit gates.

## Candidate, not an accepted credit

- [ ] All three cases pass on the final branch head, in addition to required
  baseline CI; verify the raw receipts and immutable victim snapshots.
- [ ] Independent security/payroll reviewer inspects exact source, scopes,
  multi-entity behavior (disabled in this batch), forged-selectors, source
  regeneration and transaction/audit ownership.
- [ ] Human reviewer confirms that the method's *supported operation classes*
  are adequately exercised, or requests additional cases (other form,
  legal-entity or submission-method combinations) **before** any credit.
- [ ] Explicit privacy and government-filing caveat accepted: no official
  agency receipt, prescribed-file-format approval or production release.
- [ ] If approved, a **separate reconciled manifest PR** may change at most
  **one** API method from GAP to COVERED using final-head receipts, while
  preserving all other GAP and token/public classifications. Do not
  overwrite any active manifest-editing PR.

Potential inventory change **only after those gates**:
450 COVERED / 22 GAP -> 451 COVERED / 21 GAP (total 498 methods).
Not a tenant-wide certification. This batch itself earns **0 credits**.

Rollback: close or revert these five additive QA files. There is no
production data, route, provider or flag change to roll back.
