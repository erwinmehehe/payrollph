# Compliance filing validation PATCH — isolated tenant GAP proof

**Exact method:** `PATCH /api/compliance/filing-validations/[id]` | **Manifest: GAP** | **No new coverage credits**.

**Base:** `main@6faa4dba1e71c94408f17e3aa4a1881f06f46b6e`. At selection the open PRs were Invitations, Automation Studio language, ESS Documents, Careers Publishing, Payroll Overpayment Preview, Attendance Offline Claims, Performance Governance, HMO Benefits, People Home UI, ESS Development, Leave Preview, and ESS Identifier Review. **None targets Compliance filing validation**. All changes are new standalone proof files; no production source, schema, release flags or manifest records are edited.

## Evidence boundary

This is a tenant-isolation proof for a **filing outcome record**, not proof of agency acceptance or a government submission. The positive path exclusively records an **operator-entered synthetic rejection** for an SSS R-3 worksheet. It does not accept a filing, validate an official acknowledgment, submit a government return, change a payroll release, perform remittance, or move money.

The focused GitHub Action runs a **fresh disposable PostgreSQL 16** on `127.0.0.1:5432/app_db`, with the standard production-mode Next application on `http://127.0.0.1:3000`. An executable launcher rejects every other CI/host/DB combination, disables payout/provider credentials, checks for PostgreSQL 16, and refuses databases containing any organization, filing, payroll run or audit rows before invoking the existing shared real-HTTP write table filtered to `compliance-filing`.

## Authenticated synthetic actors and data

The shared write runner seeds **two independent signed-in attacker owners** (A and B), then a **third genuine higher-ID victim** with its own organization, employee, unit and legal employer. For each employer this row inserts one real synthetic `Released` payroll run and one genuinely persisted `generated` SSS R-3 filing record, with the real run ID, legal employer ID and unique SHA-256 fictional file identity. The victim filing ID is verifiably higher than both attackers and used in attacks by its **actual database ID**, never a guess.

**Released** is seeded directly as fictional historical source. No independent real payroll approval or agency filing workflow is executed. The synthetic hash is deliberately not claimed to be an agency-compatible upload file.

## Exact acceptance matrix

| Probe | Required PostgreSQL/HTTP result |
| --- | --- |
| A signs in and PATCHes its real own filing | **200** with the actual committed own filing row changed `generated -> rejected`, `submissionMethod=manual_entry`, the correct unique fictional rejection note and exact recorded-by identity |
| B signs in and PATCHes its different own filing | **200** bound to B's distinct legal employer, payroll run, source SHA, actor and filing |
| A's real successful before/after proof is substituted for B's | **Rejected**; false, generic or other-employer success cannot pass |
| A or B uses its own session, victim `organizationId` and victim's real higher filing URL ID | **403** before foreign filing data is disclosed |
| A or B uses own `organizationId` with the victim's genuine higher filing URL ID | **404** and no foreign filing or source metadata |
| A or B repeats its own already-recorded rejected filing PATCH | **409** and no second decision or duplicate audit |
| A or B attempts an `accepted` outcome without agency reference | **400**; synthetic data cannot claim agency acceptance |
| A or B submits `2026-02-30` as a filing submission date | **400**, no normalization or silent acceptance |
| Successful own filing update audits | **Exactly one** own `SSS R-3 filing rejected` audit receipt naming the actual record ID, source run ID, SHA and actor |
| Read back own employer payroll, employees, pay profiles and unrelated records | **Unchanged** apart from the single own filing outcome and own audit |
| Read back victim organization/employee/unit/legal-employer, filing, payroll and audit snapshot | **Entire victim source snapshot unchanged** across both attackers |

### Source and immutability conditions

The proof must reject changes to original filing ID, source SHA-256, agency/form, generator version, legal-employer ID, linked payroll run ID or source period. It requires no new or deleted filing row, no change to any unrelated own filing, and no changed employee, pay profile or payroll run. For each denied replay/forgery, all current own-company and victim snapshots must match byte-for-byte. The shared runner additionally compares its comprehensive victim organizational and audit snapshot.

## New files

- `scripts/qa/tenant-compliance-filing-contract.mjs` — strict own/denied results, unchanged source checks and disposable target guard.
- `scripts/qa/tenant-table-rows/write/compliance-filing.mjs` — one auto-discovered path-bound PATCH row with real released/source fixtures, correct outcome and forged victim path.
- `scripts/qa/tenant-compliance-filing-run.mjs` — fail-closed PostgreSQL 16 / empty-database launcher; runs the established two-attacker real-HTTP table.
- `tests/tenant-compliance-filing-contract.test.mjs` — **eight** source-level adversarial tests, including swapped employers and forged source/audit/replay checks.
- `.github/workflows/tenant-compliance-filing-http.yml` — exactly scoped PG16, Node source checks, real production-mode localhost Next and authenticated HTTP acceptance.
- `docs/qa/tenant-compliance-filing-http.md` — this acceptance matrix and limitations.

## Exact-head acceptance gates

- [ ] All four new JS source files pass `node --check`; eight focused source tests pass on the **exact PR head**.
- [ ] Dedicated PG16 / production-mode localhost HTTP job completes and prints its two legitimate own-vs-foreign pairs, genuine victim denial and unchanged full victim snapshot.
- [ ] Full shared Tenant table proof, CI, CodeQL and security checks are reviewed; no success claimed before receipts.
- [ ] Independent reviewer confirms synthetic-rejection scope and absence of actual agency acceptance, accepted-filings positive path, payroll release, money movement, remittance or provider calls.
- [ ] An explicitly separate reviewed reconciliation is required before `PATCH compliance/filing-validations/[id]` can be changed from **GAP** to **COVERED**; this PR grants **zero** coverage credits.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO NEW CREDITS.** The accepted-outcome branch has only an invalid-reference negative here and remains outside full positive-path coverage. A passing synthetic rejection does not establish government acceptance or certify tenant isolation globally.
