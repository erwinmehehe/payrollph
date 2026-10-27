# HCM employment decision manager-attestation GET — isolated GAP candidate

## Exact scope

This is a **new, independent HCM employment-decision manager-attestation family**. The authoritative manifest currently marks the following method **GAP**:

`GET /api/hcm/employment-term-decisions/[id]/manager-attestation?organizationId=...`

At branch selection, no open PR addressed this method or the manager-attestation family. This change adds one auto-discovered tenant-table read proof, five focused Node source tests, and this document. It does **not** alter any application route, feature flag, schema, migration, manifest, production employee or payroll record.

## Actual data and HTTP evidence required

The existing shared read runner creates **two independent signed-in fictional employer owners and a genuine higher-ID victim employer** in disposable PostgreSQL 16. The new row persists, separately for each employer:

- A fictional worker and a different fictional current manager; no pay-profile writes in this row.
- A real employer-scoped job profile, position with that manager, and active primary assignment.
- A fictional active employment term and **pending** `continue_current` decision; nothing is approved, applied, terminated or separated.
- One directly seeded fictional manager-attestation record with unique employer marker, manager/worker/decision IDs, `needs_more_review` recommendation, statement and reporting-line snapshot. This is **not** evidence of actual managerial submission or MFA.

| Scenario | Required outcome |
| --- | --- |
| Attacker A or B, signed in, GET own real decision path and own organization ID | **200**, exactly one real employer-specific attestation, exact row and decision IDs, worker/manager IDs, reporting-line snapshot, statement and manager identity; `canAttest=false` for the owner without a manager employee identity |
| Either attacker, signed in, GET victim's genuine higher-ID decision path with victim organization ID | **403**, without victim statement or employee marker |
| Attacker B's proof is supplied attacker A's actual own HTTP response | Must fail, preventing an empty/default or another employer's result from counting |
| Response carries forged decision/manager/worker IDs, a different statement, a modified reporting-line snapshot, an approval capability, unexpected sensitive fields or victim marker | Source negative proof must fail |
| Read request writes victim organization, staff, org-unit, legal entity or audit records | Existing shared before/after victim snapshot must fail |

The existing read runner checks the victim's current organization, employee, org-unit, legal-entity, audit, and recovery snapshot; it **does not separately snapshot manager-attestation/decision tables**, so independent reviewers may require additional before/after checks.

## Deliberate non-claims and acceptance

- **GET only.** This does **not** verify the manager's own scoped employee session, POST submission, recent MFA, maker/checker review, sealing, approval, reporting-line changes, termination, or payroll.
- The common runner exercises *foreign victim organization + real victim path ID*; it does **not** independently prove *attacker's own organization + stolen victim path ID*. That forged-path variant should be added in a dedicated HTTP acceptance pass before full-family credit.
- The seeded attestation is synthetic source data, not a permitted action carried out through the POST endpoint.
- [ ] Run `node --check` on both new files and `node --test tests/tenant-hcm-manager-attestation-family.test.mjs` from the **exact PR head**. Do not claim passes without an execution receipt.
- [ ] Execute the **Tenant table proof** GitHub workflow with disposable PostgreSQL 16 / real localhost HTTP. Verify actual seed, 200 own, 403 foreign, swapped-employer rejection and untouched victim.
- [ ] Review full CI, CodeQL, tenant GAP factory, HTTP smoke and independent security assessment. Inspect any failures.
- [ ] Add any demanded stolen-ID-in-own-org and table-level immutability coverage.
- [ ] Independent accepted exact-head evidence and coordinated manifest reconciliation **before** any coverage credit.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO NEW CREDITS.** Keep this method at GAP; no production activation, live payroll or money movement is authorized by this candidate.
