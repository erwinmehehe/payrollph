# Governed roster batch tenant isolation — independent provisional HTTP batch

**Methods still GAP:** GET and POST `/api/workforce/roster-batches`.
**Evidence status:** NOT ACCEPTED / zero coverage credits / draft PR. Not a whole-route or production certification.

## Independence and scope
This batch targets governed workforce roster batches, not the asset-custody,
Recruitment privacy, leave-preview, Year-End, multi-entity or People Home work.
It introduces only a dedicated disposable proof workflow, isolated test files
and this document. It does not change the route, DB schema, migrations,
shared tenant runner, global inventory, coverage manifest, reservation ledger,
payroll, payouts, production flags or live systems.

The real localhost PG16 proof is intentionally bounded:
- GET: three independently signed-in fictional employer owners each see a real
  populated, own-only pending batch and employee marker. Two attackers cannot
  read the populated higher-ID victim employer (403).
- POST: only the `action=reject` path is exercised. Each of the two attackers
  independently rejects an existing, *other-maker* batch in its own employer
  (real 200, persisted pending-to-rejected transition, correct checker, reason
  and one actor-bound audit). The victim has an independent positive rejection.
- Both attackers are denied the victim's real batch via foreign organization
  (403) and forged own organization + victim batch ID (404), with no victim
  marker leaked and unchanged victim roster, employees, shifts, overrides,
  payroll, punch, leave and audit state until the victim's own positive action.
- Discriminating checks fail if the first employer's actual HTTP response is
  passed as the second employer's own data. The mutation contract also fails
  on no-op DB state, missing audit, wrong actor or unintended staff changes.

## Safe CI execution
The dedicated PR-only workflow uses a fresh disposable PostgreSQL 16
`127.0.0.1:5432/app_db` and production-mode Next on `127.0.0.1:3000`,
with two-stage private 0600 fictional session fixture, dynamically constructed
explicit three-employer allowlist, scheduler/workers disabled, provider
credentials absent and disbursement flags OFF. The preflight rejects
non-local hostnames, enabled providers, non-disposable mode and malformed
allowlists **before importing any database/application module**.

The reject path does not create or publish shifts. The seeded pending rows
are testing fixtures, not successful `stage` API operations. POST `stage`
and `approve` (including scheduling/guardrail/payroll implications),
independent MFA and role permutations, employee sessions and production
feature activation remain NOT PROVEN. The broader method and global
tenant-isolation inventory remain GAP; do not add credits automatically.

## Acceptance gates
- [ ] Dedicated exact-head PG16 localhost HTTP job passed on this PR head
- [ ] Exact-head full CI/security checks reviewed; no unrelated failures hidden
- [ ] Maintainer and independent security review of source-specific evidence
- [ ] Separate proof for staging/approval before any whole-POST-method credit

Keep as DRAFT, do not merge or enable production flags without owner review.
