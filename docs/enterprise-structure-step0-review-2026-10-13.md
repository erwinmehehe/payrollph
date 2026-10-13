# Enterprise structure B-7–B-11, B-14/B-15 — Step 0 design and release review

**Status:** REVIEW REQUIRED — documentation-only assessment; **not** approval to merge, run SQL, activate flags, move funds, or implement the multi-entity / approval-chain review-gated phases.  
**Source baseline:** `main` at `eae6d021ee8b7e8c4d799ed4e61a0f381d25785c`, fetched 2026-10-13 08:xx Asia/Manila. Main is force-updated; re-fetch immediately before further work.  
**Scope:** compare merged source, draft pull requests, planned schema and release evidence. No edits to `src/lib/payroll-engine.ts`. No production database access or mutation was used in this assessment.

## Current state, not a new implementation

| Item | On `main` at reviewed SHA | Remaining release gate |
| --- | --- | --- |
| **B-7 multi-legal-entity** | `legal_entities`, `0045`, `0065`, `src/lib/legal-entity.ts`; source-only `0121_multi_entity_v2_scope_transfer.sql` is committed. The current release registry does **not** expose `MULTI_ENTITY_ENABLED`. | Design approval; reconcile merged `0121` against RFC; DBA/live-schema predecessor and applied-receipt investigation (#910); audited backfill and protected clone; review draft #860 and exhaustive HTTP/SQL/entity/file/worker isolation. |
| **B-8 approval chains** | `0070`/ `0071`, `src/lib/approval-chains.ts`, `/api/approval-chains`, and current admin UI support ordered policies, roles/named approvers and amount thresholds for automation/workforce planning. | Source-specific leave/OT/expenses/payroll-release/final-pay chain integration, expiring delegation/effective escalation and two-human decision behavior not fully accepted. Review `docs/approval-chain-extension-design.md` and draft #887 before implementing extensions. Existing source-grep tests are not sufficient. |
| **B-9 ERP/accounting** | Released-run generic journal CSV exists and can be reused. | No claim of SAP/Workday connector or independently witnessed accounting import/reconciliation. Define required target format before creating a custom connector. |
| **B-10 report builder** | Merged #889: `src/lib/hcm-report-builder.ts`, `hcm-report-source.ts`, `/api/hcm-report-builder`, and Analytics panel. `TENANT_REPORT_BUILDER_ENABLED` defaults off. Whitelisted People/Time/Payroll columns, salary-role constraints, server aggregation, audited CSV. | Multi-entity tenants deliberately blocked until entity-grant design; company-wide cost without historical department evidence fails closed. Independently validate DB fixtures, role access, UI states, mobile and export receipts. Draft #882 is a **second** candidate, not evidence that missing code must be duplicated. |
| **B-11 extended public API** | Merged #889: opt-in `/api/v1/org-units`, released payslips and sanitized `/api/v1/events`, plus OpenAPI updates; `PUBLIC_API_V1_EXTENDED_ENABLED` defaults off. | Actual partner UAT, key/tenant/role isolation and entity-bound approvals before enablement. |
| **B-14 engagement** | Merged #889: opt-in `/app/engagement` with role-scoped survey API and small-cohort suppression; `ENGAGEMENT_SURVEY_ENABLED` defaults off. | Proposed aggregate-survey SQL remains in `docs/engineering/migration-proposals/`, not an approved numbered production migration. Privacy/retention, migrated schema and real browser acceptance remain open. |
| **B-15 goals/reviews** | Merged #889: opt-in `/app/goals-reviews` read-only link/list reusing governed Performance; `GOALS_REVIEW_CYCLE_ENABLED` defaults off. | Single-entity scope is a deliberate limitation; review UX/role behavior and mobile. It is not a second complete performance engine. |

## Mandatory four-question review of the existing RFC

Source: `docs/multi-legal-entity-scope-transfer-design.md` (merged review document, status still DESIGN FOR REVIEW).

1. **Default entity per tenant — present in design, not proven operationally.** Existing `0045`, `ensurePrimaryLegalEntity` and `0121` each express idempotent PRIMARY creation/backfill. Before approval require an actual isolated-database test for pre-existing tenants, empty orgs and reruns, and verify exactly one authoritative PRIMARY per organization. Merge to `main` is **not** a production migration receipt.
2. **Full table inventory — strong proposal, incomplete implementation proof.** RFC lists 16 preexisting direct columns, dozens of required direct columns, versioned registrations, entity grants, assignment intervals, employee payout destinations, transfer liability evidence, and parent-derived tables. `0121` covers only selected payroll children and grant/preference/assignment/transfer tables. Reconcile every table in `src/db/schema.ts`, API/worker/exports and later migration against RFC before calling the inventory exhaustive. The RFC's proposed `employee_legal_entity_assignments` name differs from `0121`'s actual `employee_entity_assignments`; **reuse the existing table, do not create a duplicate**.
3. **Continuous service history — designed, not accepted for release.** Keep one `employees.id` and original service/start date. Close/open immutable employer assignment intervals, pin historical runs and agency evidence to the paying employer, carry *evidence* for leave/13th/final pay, and require independently reviewed liability allocation before any settlement or tax release. `0121` does not prove complete end-to-end transfer behavior; draft #860 includes a separately default-off `MULTI_ENTITY_TRANSFERS_ENABLED` gate.
4. **Rollback — documented, rehearsal outstanding.** Toggle flagged application capability off; retain additive schema, immutable history, filed evidence and audit events. Never roll back by rewriting released pay, deleting events or replaying old migrations. Require an actual protected-clone transaction rollback/restore rehearsal and applied-SHA receipts, not just an SQL idempotence claim.

**Review outcome:** RFC passes as a design *outline* for all four questions, but not as an implementation or production-release approval. Specific gaps and decisions below must be closed first.

## Review-blocking inconsistencies and decisions

- **Canonical flag:** RFC names `MULTI_LEGAL_ENTITY_V2_ENABLED`, while merged `0121` comments and implementation draft #860 use `MULTI_ENTITY_ENABLED`. Use **`MULTI_ENTITY_ENABLED`** for the requested parent gate (exact env string `true`, default off), with separate sensitive sub-gates where required. Update the RFC and draft contracts together only after review.
- **Role model:** `group_hr` is the only role allowed to request tenant-wide cross-entity workforce/payroll reads. Owner/admin/bookkeeper with several *explicit* employer grants may choose one granted employer, **not** implicit “All entities.” Group HR is read-only, never a maker/checker/releaser or viewer of clear bank/government IDs. Correct conflicting role statements in draft #860's UI matrix (group totals row vs stated authorization policy).
- **Schema naming and completeness:** retain `legal_entities`, `legal_entity_id`, `employee_entity_assignments` and `user_legal_entity_grants`. Review whether grant permission comes from membership or needs explicit per-grant capability; `0121` grants contain no per-grant role. Versioned registrations, effective-dated payout destination and transfer liability evidence are only source proposals in draft #860. Do not merge a competing schema model or make direct historical attribution from today's employee entity.
- **Existing `0121` source:** committed as part of merged #865, not evidence of execution on live Neon. Pending #921 and incident #910 report missing historical predecessors / `worker_employment_events`, missing receipt coverage and inability to apply `0121` directly. Approved clone, applied-hash reconciliation, foreign key/interval integrity and centavo exception reports must precede any production DDL.
- **Business logic:** require written Philippine payroll/HR/legal decisions about continuity classification, leave balance, 13th-month accrual, final pay, BIR 2316/1604-C/1601-C per payer, loan authorization and bank account handoff. Do not change statutory maths or bypass the existing cross-employer annualization block.
- **Approval extension:** `docs/approval-chain-extension-design.md` remains review-only; draft #887 covers escalations and human-role collision but not the complete requested policy/source lifecycle. Two **distinct authenticated humans** must remain mandatory for payroll release, including delegated decisions, concurrently processed tasks and stale approver grants.
- **Acceptance:** make tests execute handlers/SQL and transfer/approval behavior. Historic tests that read source text do not count. Include flag-off full-workspace parity, absent/mismatched entity, foreign tenant, resource-by-ID/CSV/file/queue and delegated maker-checker negative tests.

## UI inventory and screenshot acceptance (existing merged + draft only)

**No new screen was created in this documentation review. No screenshot is represented as having been captured.**

| Screen | Status and visibility | Required empty / loading / error; phone-width acceptance |
| --- | --- | --- |
| Analytics → **Report builder** | On `main`, only when `TENANT_REPORT_BUILDER_ENABLED=true` and authorized company-wide People/payroll role; salary fields only admin/HR/payroll. | No-data grouped result, initial capability fetch, preview/export busy, server error. Current panel silently renders nothing until capability fetch resolves; explicitly check loading UX and 320/375/390px layout before release. |
| **Approval chains** admin | On `main`, authorized company-wide admins/MFA; existing Automation/Workforce-plan chains only. | No configured policies, fetch/save in progress, validation/API errors and action feedback; check editing steps at 320/375/390px. Future source-specific extensions belong to separate review. |
| **Engagement survey** | On `main` behind `ENGAGEMENT_SURVEY_ENABLED`. Owners/admin/HR administer, linked employees participate. | No surveys, loading, error; open/closed/results suppressed under five; phone width; privacy review. |
| **Goals/review cycles** | On `main` behind `GOALS_REVIEW_CYCLE_ENABLED`, company-wide owner/admin/HR and verified single employer. | Empty cycles; SSR deny/not-found; narrow viewport. |
| **Workspace header switcher and fixed employer badge** | Draft #860 only. `group_hr` alone may select All; multi-granted authorized staff select only one employer; single-grant staff see fixed badge. | Loading/persisting, no grant/invalid selection, retry/errors, flag-off baseline at 1440 and 320/375/390/430px. |
| **Entities settings** | Draft #860 only, authorized configuration editors; other authorized viewers read masked IDs. | Empty entity, save/loading/error/audit success; long employer names and statutory labels on phone. |
| **New hire entity, employee transfer dialog and transfer inbox** | Draft #860 only, authorized entity grant makers and separate cross-entity approvers; read-only group HR cannot approve. | Missing entity, effective-date/leave/13th preview, pending/denied/replayed transfer, save/error/retry; mobile dialog and table overflow. |
| **Payroll start/check/release confirmation; payslip, filing and export badges** | Draft #860 only, entity-granted payroll and approver roles. | Missing/wrong typed employer blocks action at API and UI; correct name still requires maker-checker; badge on empty/loaded/errors; phone. |
| **People, Time, Payroll and Reports entity filters; group report** | Draft #860 only, role-allowed filter or group-read screen. | Empty, loading, denied cross-entity and no financial aggregate; phone-width layout. |

**Screenshot gate:** compare the same synthetic tenant/role fixture in a running authenticated build with flags OFF (before) and selectively ON (after), including desktop 1440px and phones 320, 375, 390 and 430px. Capture *every* new screen, role-specific variants, empty/loading/error, denied scopes and full flag-off workspace parity. Artifacts must identify build SHA and role and redact personal IDs. The draft #860 document has a detailed 14-point capture checklist, but reports **no actual screenshots yet**.

## Verification and stop point

At the reviewed `main` SHA `eae6d021ee8b7e8c4d799ed4e61a0f381d25785c`, GitHub CI and other workflows were queued; queued does **not** equal passing. The immediately preceding `47f58de` main run had failed Live RBAC Sandbox Smoke and Production Readiness Report (other workflows succeeded). This documentation review did not run local TypeScript/lint/PG suites: direct clone was blocked by container network DNS; no test receipt is being invented.

Before claiming any *runtime* tranche DONE on an exact proposed SHA:

```sh
npm run typecheck
npm run lint
npm run payroll:golden
npm run payroll:golden:phase2a
npm run payroll:golden:phase2b
npm run payroll:golden:pay-rules
TZ=Asia/Manila npm test
```

Require no new lint warnings, unchanged flag-off golden output, actual two-tenant/two-employer/Postgres HTTP tests, browser screenshots, DBA clone/rollback/receipt signoff and HR/payroll/security independent approvals. Store evidence without raw secret values, tokens, personal government IDs or bank numbers in logs.

**Decision required before implementation:** approve the reconciled entity schema/flag/role matrix and Philippine employer-liability rules; approve the extension approval-chain design separately. Continue draft #860 / #887 rather than creating competing implementations. Retain flags OFF until all staged exit criteria are independently witnessed.
