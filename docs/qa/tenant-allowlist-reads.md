# Batch 2 — dynamically allowlisted tenant reads (draft, NOT ACCEPTED)

Branch: `qa/tenant-allowlist-reads`. **This is test-only work.** No production feature
flags, employer configuration, credentials, application routes, business-state mutations,
SQL migrations, payment integrations or deployment settings are changed.

## Why the old table profile returned 404

These read routes use a server feature flag **and** an explicit comma-separated
allowlist of numeric employer IDs. The existing table runner created new synthetic
employers **after** the production-mode localhost Next server was already running.
Their IDs could not be included in the server's environment, so the route correctly
answered 404 before checking user membership.

The `allowlisted-reads` matrix profile keeps the default and existing
`flagged-reads`/`multi-entity` jobs unchanged. After provisioning the disposable
PG16 schema, a new guarded bootstrap creates:

- Attacker A and attacker B, with separate real authenticated fictional sessions.
- A genuine victim whose employer, worker, unit and entity IDs are greater than both
  attackers' IDs.
- **One more real, authenticated fictional employer excluded from every allowlist.**

**Both attackers AND the victim are allowlisted** for every positive tenant-boundary
read. This is intentional: otherwise an attacker reading the victim could receive a
404 only because the victim's feature is off, falsely counting a feature-gate denial
as tenant authorization proof. The ordinary read runner must still show each
attacker's nonempty own-employer 200, victim-employer 403, a discriminating
row-specific own-data proof, no victim marker, and an unchanged victim SQL/audit
snapshot. The excluded fourth employer separately proves every rollout gate is
404 even to its own signed-in user; that gate check earns **zero** coverage credits.

The numeric list has exactly three distinct PostgreSQL-issued IDs (not hard-coded),
within WFM's maximum of 20 IDs / 240 characters. Only IDs are appended to
`GITHUB_ENV`. Synthetic session cookies live in a mode-0600 `/tmp` file inside
the disposable CI job, are not logged, and are reloaded by the unchanged-line-count
read runner. This preserves the positions and expressions of existing cited proof
lines.

## Verified feature gates and candidate methods

| Exact GET method | Runtime controls | Positive evidence |
| --- | --- | --- |
| `hcm/team-leave-calendar` | `HCM_TEAM_LEAVE_CALENDAR_ENABLED` + `HCM_TEAM_LEAVE_CALENDAR_ORG_IDS` | Own employee's seeded current-month pending leave span |
| `hcm/process-monitor` | `HCM_PROCESS_MONITOR_ENABLED` + `HCM_PROCESS_MONITOR_ORG_IDS` | Own persisted in-progress process ID and scoped status |
| `hcm/position-history` | `HCM_ORG_EXPLORER_ENABLED` + `HCM_ORG_EXPLORER_ORG_IDS` | Own position and historical worker assignment |
| `hcm/org-explorer` | Same HCM org explorer gate | Own active linked child organizational unit |
| `hcm/manager-decision-inbox` | `HCM_MANAGER_DECISION_INBOX_ENABLED` + `HCM_MANAGER_DECISION_INBOX_ORG_IDS` | Pending leave decision tied to a different source approval task, no decision made |
| `workforce/schedule-receipt-review` | `WFM_SCHEDULE_RECEIPTS_ENABLED` + `WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS` | Actual own employee with a linked fictional self-service account and 7-day status envelope, no receipt acknowledgment made |
| `workforce/demand-outlook` | `WFM_HISTORICAL_OUTLOOK_ENABLED` + `WFM_HISTORICAL_OUTLOOK_ALLOWED_ORGANIZATION_IDS` | Owned PH worksite with fictional historical staffing requirement rows |
| `workforce/demand-observations/outlook` | `WFM_OPERATIONAL_DEMAND_ENABLED` + `WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS` | Owned PH worksite and append-only synthetic aggregate demand revision rows |

**Gate correction:** operational demand forecasting is controlled by
`WFM_OPERATIONAL_DEMAND_*`, **not** `WFM_HISTORICAL_OUTLOOK_*`.
The separate source gate is source-verified and configured independently.

There are **8 verified target methods**, not 10–15. The 10–15 estimate was not a
source-verified promise. Additional methods must first have their own gate,
fixture/role, provider-risk and proof contract reviewed. Do not pad a batch with
empty or disabled endpoints to reach a numerical goal.

## Acceptance and proof accounting

- Run `node --test tests/tenant-allowlist-reads.test.mjs` for fixture/contract
  negative-evidence checks.
- The workflow executes the normal default, flagged-reads, multi-entity and new
  allowlisted-read profiles in separate disposable PostgreSQL 16 jobs.
- In the new profile, the bootstrap runs **before `npm run build` and before
  `npm start`**, the excluded employer's eight gates are verified 404, then
  the shared table reader runs all eight GET proof rows for both attacker employers.
- The shared write-table step is allowed to be empty in this read-only profile;
  no money path or business write is exercised by the HTTP test itself.
- All new methods stay **GAP** in
  `scripts/qa/tenant-isolation-coverage-manifest.json` until a passing **exact
  PR-head** HTTP/PG16 receipt, reviewed source pins, and a dedicated reconciliation
  explicitly credit only genuinely passing methods. A positive fixture or a gate
  404 is not a security credit.
- After other open tenant-family PRs merge, synchronize and rerun exact-head CI;
  reconcile sources and manifests sequentially rather than overwriting evidence.

**Tenant isolation: NOT ACCEPTED. Release/deployment: NO-GO.** These checks use
only fictional local PostgreSQL rows; they neither activate production employer
allowlists nor certify payroll, filing, provider or financial workflows.
