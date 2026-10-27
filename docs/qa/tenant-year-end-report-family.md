# Year-end annualization JSON read: tenant-isolation proof candidate

**Scope:** Only `GET /api/year-end?organizationId=...&taxYear=2026&format=json`.
The authoritative `scripts/qa/tenant-isolation-coverage-manifest.json` currently marks
`GET year-end` **GAP**. This read-only fixture is not an acceptance receipt and
adds **zero coverage credits**. There are no route, schema, migration, flag, money,
filing, shared-runner or manifest edits in this PR.

## Distinct, non-overlapping family

At selection time, open tenant PRs were asset custody #1458,
Recruitment privacy #1464 and Leave preview #1465. This Year-End Reporting
family uses only the new `read/year-end-report.mjs` row, a focused Node test
and this documentation; it does not alter those other families.

## Exact fictional proof

The existing default-profile tenant table runner seeds and independently
authenticates two fictional employer owners, then a third **real persisted
higher-ID victim**. This row adds one fictional 2026 year-end tax adjustment
to each employer, tied to its real worker and returned database ID.

| Request | Required result |
| --- | --- |
| Each attacker reads its own employer's 2026 JSON report | HTTP 200, exactly one employer-marked worker and adjustment, exact tax-year, refund total and non-settled state |
| Attacker A/B reads the real victim employer via `organizationId` | HTTP 403; no victim marker in the response |
| Other attacker's genuine own response is submitted to the proof | The source assertion must fail, preventing an empty/constant or employer-agnostic positive |
| Victim integrity | Shared runner compares victim organization, employee, org-unit, legal-entity and audit snapshots before and after requests; this does **not** independently snapshot the `year_end_adjustments` table |

The source-level negatives reject wrong worker identifiers, swapped names,
missing own data, changed tax totals, unexpected JSON keys, an added government
identifier, an approved/settled payroll state or victim marker. These
negative controls do **not** replace live HTTP authorization evidence.

Only a fictional, already-computed **report row** is inserted into disposable
PostgreSQL. The fixture sets no payroll-run binding, review approval or
settlement. No annualization procedure, BIR form, CSV extract, provider request,
filing, actual tax calculation, payroll queue or payment is triggered.

## Acceptance and limitations

- Local syntax: `node --check` of the new row and test.
- Local focused source tests:
  `node --test tests/tenant-year-end-report-family.test.mjs`
  (**4/4 passed** in an isolated Node 22 scratch copy).
- Required: full exact-head **Tenant table proof** GitHub workflow for the
  `default` profile using disposable PostgreSQL 16, authenticated real
  `127.0.0.1` HTTP, and unchanged other profiles, plus required CI/security.
- Required: independent security review of actual own/victim response evidence,
  request denial status, fixture integrity and unchanged victim records.
- Separate work would be needed to prove `format=preflight`, annualization
  exports, 2316/Alphalist branches, privileged same-employer permissions,
  or any `POST /api/year-end` write.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO NEW CREDITS.**
No method status may become COVERED until independent exact-head acceptance,
including any extra snapshots reviewers require, and coordinated manifest
reconciliation. Global tenant-isolation and payroll release gates remain NO-GO.
