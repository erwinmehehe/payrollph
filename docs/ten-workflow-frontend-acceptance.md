# PR #862 — remaining source-only workflow overlay acceptance

**Status:** Draft; six default-OFF optional UI families. This historical integration branch is NOT the recommended final merge vehicle. Extract features into focused, independently reviewed PRs based on main; do not enable a draft overlay or apply the unnumbered SQL proposal.

## Canonical features retained on main

- Employee CSV import uses the existing approved preview/receipt, error CSV, skip, validation and commit flow under `EMPLOYEE_IMPORT_PREVIEW_ENABLED`. The duplicate import-review panel/CSV parser and `IMPORT_REVIEW_UI_ENABLED` have been retired.
- Tenant core navigation and More modules use `CORE_MODULE_NAVIGATION_ENABLED` and the existing role- and employer-scoped components. The duplicate `CORE_ONLY_NAV_UI_ENABLED` and `MoreModulesPage` are removed.
- HR Requests, COE and confidential case data use `EMPLOYEE_HR_CASES_ENABLED` and main's governed API/UI/model; the extra service-case system is retired.
- Roster proposal/staging and checker verification use main's governed WFM controls. The parallel `ROSTER_PUBLISH_UI_ENABLED` overlay was removed and the frozen WFM file restored exactly to main.
- Source-backed first payroll and approvals remain the official authoritative flows; cosmetic handoffs or descriptions never override maker/checker.

## Six still-draft UI controls (all require exact lowercase "true")

| Source-only proposal | Environment gate | Integration requirement |
| --- | --- | --- |
| Legacy first-payroll handoff advisory | `FIRST_PAYROLL_INLINE_UI_ENABLED` | Separate from canonical `FIRST_PAYROLL_INLINE_ENABLED`; do not connect without owner review |
| Camera preview and offline *claims* | `FACE_OFFLINE_PUNCH_UI_ENABLED` | No biometrics; offline claims never become payroll punches without separate correction; privacy & device review |
| Approval chain labels/delegation overlay | `APPROVAL_BUILDER_UI_ENABLED` | Main's authoritative escalation and maker/checker gate cannot be replaced |
| Saved report definitions | `REPORT_BUILDER_UI_ENABLED` | Existing report API data permissions remain authoritative; DBA table and scoped exports required |
| Benefits/loan explanation & projection | `BENEFITS_LOANS_UI_ENABLED` | Display-only; exact payroll/ledger unchanged, no illustrative amount authorized as deduction |
| Recruitment/public careers opt-in | `RECRUITMENT_JOURNEY_UI_ENABLED` | Publish only explicitly approved open jobs; public data minimization and privacy review |

Server-only flags live in `src/lib/workflow-ui-flags.ts`; under `MULTI_ENTITY_ENABLED=true` all six optional controls resolve false and legacy unscoped routes return `403 ENTITY_WORKFLOW_DEFERRED` before DB access. The source-only SQL design in `docs/engineering/migration-proposals/workflow-frontend-requests.sql` is **not** a numbered migration or authority to apply DDL.

## Acceptance to perform on individual feature PRs

- Current-head `npx tsc --noEmit`, `npm run lint`, `TZ=Asia/Manila npm test`, 4 payroll golden suites, Next.js production build, CodeQL and required browser/security workflows; capture check run URLs.
- Real authenticated two-role/two-employer access and foreign-employee ID rejection; revoked/unauthorized access remains fail closed, including under multi-entity mode.
- Flag-OFF parity against main at same fixture; 1440px desktop and 320/375/390/430px phone; dialog/focus/overflow/accessibility, employer-switch and mobile browser results recorded.
- DBA-controlled numbered migration/restore rehearsal and signed tenant constraints for offline claims and saved reports; no live Neon DDL or data purge.
- HR/Workforce/Privacy/Finance approvals appropriate to each feature and external operator witnesses for #691 / employer payroll #579 where relevant. No synthetic CI run counts as live human UAT, government acceptance, payout authority or a release signoff.

**Safe rollback:** flags remain OFF; no money movement, tax filing, new secret, production DDL or payout operations are included. Keep #862 Draft while independent extraction work proceeds.
