# PR #862 integration reconciliation (source-only, 2026-10-13)

Status: DRAFT. This reconciliation merges the existing workflow frontends onto main after #860 **without enabling any flag, applying migrations, moving money, or filing**.

- Keep merged core #860 as the authority for employer grants, server-scoped reports, entity navigation, maker/checker and HCM pilot guards. Never replace these files wholesale with the older workflow branch.
- Keep main's governed `src/components/workspace/first-payroll-readiness.tsx` and `src/lib/first-payroll-preview.ts` authoritative. The latter is an actual read-only source-backed payroll preview, whereas #862's earlier helper was an advisory readiness mapper. Rename the advisory mapper to `src/lib/workflow-readiness-preview.ts` and update its **test-only / inactive** `FirstPayrollInline` component and isolated test imports; do NOT shadow the live money/readiness preview.
- Preserve the new workflow flags as strictly default OFF. One flagged overlay must not enable another or override backend authorization.
- With `MULTI_ENTITY_ENABLED`, the older custom-report overlay and organization-wide offline-punch review panel are denied, rather than bypassing employer scoping. Core entity selection remains visible even in compact navigation.
- Preserve newer first-payroll employer review/step-owner logic and entity-context controls from main. The older #862 inline workflow and handoff form are not automatically wired into production; require a separate narrow review before removing the duplicate.
- Proposed `saved_report_definitions`, HR cases and other workflow SQL are **source-only**. Number allocation, canonical predecessor receipts, database clone/rollback, tenant privacy/security and end-to-end owner UAT remain distinct blocked approval gates.
- This reconciled PR is a technical integration candidate, NOT authorization to merge or activate ten screens. Compare exact-head TypeScript, lint, all four golden payroll suites, Asia/Manila tests, 320/375/390/430px browser screenshots, flag-off behavior and multi-entity authorization before any approval.
