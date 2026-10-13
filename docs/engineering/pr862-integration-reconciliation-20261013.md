# PR #862 integration reconciliation (source-only, 2026-10-13)

Status: DRAFT. This reconciliation merges the existing workflow frontends onto main after #860 **without enabling any flag, applying migrations, moving money, or filing**.

- Keep merged core #860 as the authority for employer grants, server-scoped reports, entity navigation, maker/checker and HCM pilot guards. Never replace these files wholesale with the older workflow branch.
- Keep main's governed `src/components/workspace/first-payroll-readiness.tsx` and `src/lib/first-payroll-preview.ts` authoritative. The duplicate, inactive #862 `first-payroll-inline.tsx` and its `workflow-readiness-preview.ts` advisory mapper have been **removed from this integration PR**. Canonical source-backed payroll preview and its flag-off parity test remain. `FIRST_PAYROLL_INLINE_UI_ENABLED` and the guarded legacy handoff endpoint remain OFF/unused, pending an independently scoped future review; they do not enable main's `FIRST_PAYROLL_INLINE_ENABLED`. Do not shadow the main payroll preview.
- Preserve the new workflow flags as strictly default OFF. One flagged overlay must not enable another or override backend authorization.
- With `MULTI_ENTITY_ENABLED`, the older custom-report overlay and organization-wide offline-punch review panel are denied, rather than bypassing employer scoping. Core entity selection remains visible even in compact navigation.
- Preserve newer first-payroll employer review/step-owner logic and entity-context controls from main. The older #862 inline workflow and handoff form are not automatically wired into production; require a separate narrow review before removing the duplicate.
- Proposed `saved_report_definitions`, HR cases and other workflow SQL are **source-only**. Number allocation, canonical predecessor receipts, database clone/rollback, tenant privacy/security and end-to-end owner UAT remain distinct blocked approval gates.
- This reconciled PR is a technical integration candidate, NOT authorization to merge or activate ten screens. Compare exact-head TypeScript, lint, all four golden payroll suites, Asia/Manila tests, 320/375/390/430px browser screenshots, flag-off behavior and multi-entity authorization before any approval.

## Post-#860 extraction and release decomposition

- **Canonical first payroll (#915 merged):** removed inactive duplicate seven-step #862 drawer/mapper instead of shipping a parallel preview. Separate `FIRST_PAYROLL_INLINE_UI_ENABLED` and its handoff route stay OFF, unwired and under review. Never infer actual payroll/employee readiness from a cosmetic checklist.
- **Existing owner surfaces:** WFM offline evidence (#856), roster rules (#859/#861), report builder (#882), module disclosure (#874), and approval-chain governance (#887) are already on main. #862 optional overlays may not replace or bypass their server authority.
- **Independent follow-up scopes before merging #862:** employee-import error UI; legacy single-employer offline-claim review; saved reports/migration; benefits/loans presentation; recruiting/careers publishing; employee/HR cases. Each needs its own owner, flagged endpoints, tenant/role+maker-checker negative tests, SQL migration lineage and actual phone screenshots. Do not merge the 10-workflow integration branch as a shortcut.
- **Multi-entity hold:** new organization-wide endpoints and all ten UI flags stay denied/hidden whenever `MULTI_ENTITY_ENABLED=true`. Changing that requires independently reviewed legal-employer scoping, not a presentation-layer toggle.
- **Gate:** no migration application, payout/filing, pilot freeze relaxation or production feature activation; this remains DRAFT until narrow functional splits and independently verified acceptance are complete.
