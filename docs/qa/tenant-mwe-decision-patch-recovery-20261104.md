# Isolated tenant API recovery candidate: MWE classification PATCH

**Scope:** Statutory/MWE governance only. Separate from draft PRs #1760 (shared DL/PII/EDG credit reconciliation), #1761 (WRK-01 staffing policy GET), and #1764 (public /api/v1 classification).

## Exact target
- PATCH /api/employees/[id]/mwe-classifications/[classificationId]
- Route: src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts
- Current route Git blob: 1861013e1006fbe8fa5f75ceb26767e9da807350
- Main manifest at starting head: GAP, testedBy:null. This PR makes **zero manifest or inventory changes**, so active drafts can reconcile their independent shared-ledger work without collisions.
- GET and POST on the adjacent classification path already have separate provisional coverage and are not re-credited.
- No application route, authorization helper, payroll engine, migration, schema, payment provider, feature flag, deployment, or live data changes.

## Evidence needed for one future provisional method credit
A dedicated GitHub Actions workflow uses its own disposable PostgreSQL 16 app_db, no external database or provider credentials, Next production mode on 127.0.0.1, and signed-in HTTP. The guard refuses unsafe profiles before loading DB modules. The cohort has **two independently authenticated attacker employers**, **six filler employers**, and a **real persisted high-ID victim**. Independent same-employer owner/checker identities are used for the actual PATCH.

Acceptance assertions in the proof:
- Genuine independent checker can approve one pending MWE classification and reject a separate pending classification **per attacker employer**, with exact persisted row and one matching audit event.
- Maker cannot approve their own request; foreign attacker cannot PATCH the actual populated victim row.
- Cross-swapped employee/classification path IDs, revoked checker membership, malformed decision, malformed worker ID and replayed decision are refused.
- The victim (and all other employers) has unchanged MWE rows, workers, payroll runs and audit events after every denied request and every own decision; a forged employer/employee/classification body cannot change the target.
- No live money, statutory filing, payroll processing, banking, provider delivery, or production activation.

## Review/release constraints
**DRAFT / NOT ACCEPTED / ZERO NEW COVERAGE CREDITS**. Do not promote method status until the new exact-PR-head dedicated workflow and all applicable CI/security tests pass; verify the route and proof hashes and the actual run receipts; have an independent security/coverage-owner reviewer accept the method-specific evidence. A later serial ledger-only PR may change this one PATCH from GAP to provisional COVERED with source and CI pins. Do not infer whole-tenant isolation or production payroll compliance from this proof.
