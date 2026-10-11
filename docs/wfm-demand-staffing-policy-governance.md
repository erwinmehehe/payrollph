# Linaw WFM — governed demand-to-staffing policy pilot

**Engineering candidate · default OFF · no scheduling or payroll mutation.** Stacked PR #843 is based on advisory planner #837, which in turn depends on issued-demand release #828.

## Why this exists

Forecast-driven worker counts must never silently inherit arbitrary productivity or service assumptions. This opt-in feature lets a company-wide People administrator propose a **specific effective-dated aggregate workload policy**, requires author-only submission and **independent company owner/admin** decision, and gives a manager a distinct policy-backed *read-only* scenario mode.

Values are explicitly expressed as source metric **transactions / visits / orders / appointments / calls per productive worker-hour**, and a target percentage of the forecast volume to be staffed. These are staffing modeling assumptions, not Philippine legal wage, service-level agreement, employee employment/compensation or overtime determinations.

## Exact scope and lifecycle

A revision is bound to organization ID, worksite ID, explicit job profile (or generic role **without fallback**), one activity metric, one forecast interval of 15/30/60 minutes, inclusive PH local effective dates, productivity (4 decimal places), coverage percentage (2 decimal places), and a non-PII rationale.

The organization/worksite/role are checked from the database. A session bearer cannot appoint itself a manager through a browser-supplied organization ID. All mutations require a signed-in **company-wide People admin** with same-origin request, privileged MFA where configured, rate limit, and a non-demo user.

- Create: exact-key idempotent **draft** with content SHA; version increases per exact scope. Duplicate key with different content fails.
- Submit: only original author may submit their unchanged draft. A submitted policy cannot be edited or reverted.
- Approve/reject: a **different, independently signed-in owner/admin** must decide, supply a substantive reason, and meet MFA. A decision cannot be self-approved by either the original proposer or submitter.
- Approval: under a per-organization PostgreSQL advisory transaction lock, conflicting approved effective windows **fail closed**. An exact-range new version may supersede a previously approved one within the *same transaction*; overlapping partial windows are not auto-modified.
- Evidence: each transition records a hashed policy event and a separate audit event atomically; reads re-evaluate content and approval event hashes. Hashes are reproducibility and anomaly checks, **not proof against a privileged DBA altering the database**.
- Manager: the existing demand-to-staffing panel allows explicit **what-if/manual mode** or **independently approved policy mode**. Approved mode only uses a server-returned exact-scope, hash-confirmed policy covering the **entire selected work window**. Missing/partial/ambiguous/invalid evidence => no scenario. No synthetic default policy is claimed.

Managers may only GET the scoped approved policies. Policy creation and decisions use the role-gated administrative route; the manager planner itself never PATCHes schedules, attendance, timecards, payroll or payouts.

## API and UI

`GET /api/workforce/demand-staffing/policies` with exactly scoped `organizationId`, `worksiteId`, `jobProfileId` (`any` explicitly means generic), `metricKind`, `intervalMinutes`; `mode=approved` for managers, `mode=manage` only for authorized company-wide People admins.

`POST` same endpoint creates a bounded, immutable versioned draft, with explicit idempotency. `PATCH` same endpoint submits, approves or rejects using explicit `acknowledged:true` and a decision reason for approve/reject. Both mutation methods require CSRF origin check, privileged MFA, source allowlist, scoped organization access, and transaction-audited event storage. All responses are private/no-store.

Under **Coverage**, company-wide People admins see a policy proposal/approval queue, and managers can choose independently approved policy mode within the existing demand-staffing planner. A local manager review checkbox **does not** constitute a stored maker-checker approval of scheduling changes.

## Feature flags — all OFF by default

Server:
- `WFM_OPERATIONAL_DEMAND_ENABLED=true` and allowlist `WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS` (pre-existing source gate).
- `WFM_ISSUED_DEMAND_FORECASTS_ENABLED=true` and allowlist `WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS` (pre-existing issued forecast gate).
- **`WFM_DEMAND_STAFFING_POLICIES_ENABLED=true`** and exact `WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS` (new independent rule gate).

Client:
- `NEXT_PUBLIC_WFM_DEMAND_STAFFING_ENABLED=true` (review-only planner).
- `NEXT_PUBLIC_WFM_ISSUED_DEMAND_FORECASTS_ENABLED=true` (issued forecasts).
- **`NEXT_PUBLIC_WFM_DEMAND_STAFFING_POLICIES_ENABLED=true`** (new mode / admin UI).

These flags must not be activated in production merely because GitHub CI passes; staging select-organizations require a separately approved DBA/security/WFM configuration and a signed release owner.

## Migration release order

- Main highest numbered source migration as inspected: `0111_wfm_geofenced_web_bundy.sql`.
- Source-only WFM #828: `0112_wfm_operational_demand_observations.sql`, then `0113_wfm_issued_demand_forecasts.sql`.
- **This WFM proposal**: `0114_wfm_demand_staffing_policies.sql` (two new tables and indexes).
- Separately unmerged payout #813 reserves **`0115_xendit_payout_provider.sql`** and remains isolated. **Do not merge, activate, or move money merely to satisfy WFM sequencing.**

There is no ordered Drizzle migration journal. Source merges **do not** apply schema. A DBA must inspect actual applied objects and checksums; rehearse isolated backup, migration, index and rollback; and approve the selected staging employer. Do not run `db:push` against an actual employer database just because isolated CI used it.

## QA and release decision

Focus: `npm run lint`, `npx tsc --noEmit`, isolated PostgreSQL 16 tests `tests/workforce-demand-staffing-policy.test.ts` and `tests/workforce-demand-staffing-policy-db.test.ts`, Next production build and browser `node scripts/wfm-staffing-policy-browser.mjs` with a 375px synthetic manager/maker/checker fixture.

Independent operational signoff remains **unexecuted**: #840 DSP-01–10 read-only planner acceptance, #691 WFM-01–14 human real-device acceptance, #579 actual employer **no-money** employee-by-employee payroll reconciliation, and #112 production environment/security proof. No real merchant POS adapter or independently provider-certified freshness has been implemented yet (#838).

**Pilot release decision: NO-GO until staged database/security and authorized human evidence. Automatic scheduling and payout remain OFF.**
