# PR #902 — Exact-Source HCM/WFM Freeze Exception (Development Only)

**Decision date:** 14 October 2026  
**Owner decision:** Payroll PH has no current customers. Development-only source integration may proceed without independent human review when repository source and CI requirements pass. This decision does **not** approve live payroll, government filings, real employee files, or production migration.

## Precise grant

This is one immutable, development-only exception for [PR #902](https://github.com/erwinmehehe/payrollph/pull/902) at commit `94435b43f98de209065a373d4959af3db8e14b69`, whose exact 34-file GitHub diff passed all **24/24** engineering workflows before this policy proposal. The repo policy pins the full GitHub changed-file set by **path + status + blob SHA**, not a label, comment, author, branch name, or truncated first page. Only three of the 34 paths cross the HCM freeze:

- `src/app/api/hcm/documents/route.ts`
- `src/components/hcm-documents-panel.tsx`
- `src/lib/hcm-documents.ts`

Other protected HCM/WFM, attendance, scheduling, payroll, settlement, government, bank, approval, and worker files are **not** allowed. A different PR, new commit on #902, added/deleted file, changed bytes, duplicate, rename, copy, or omitted file will again return `PILOT_HCM_WFM_FREEZE_ACTIVE`. The exception changes **only** the scoped *pilot source-freeze decision*; it does not alter file tier/risk classification or loosen source-approval handling for unrelated PRs.

## Separation of independent human review, source freeze and release

The already adopted `INDEPENDENT_SOURCE_REVIEW_REQUIRED=false` setting means the **solo-maintainer development** mode does not demand a fabricated second person. The freeze is separate and still blocks unrelated HCM/WFM changes. In strict reviewer mode (`INDEPENDENT_SOURCE_REVIEW_REQUIRED=true`), this exception lifts the **freeze only**, and an actual current-head independent approval is **still required** for sensitive paths. Draft-sensitive PRs remain blocked in strict mode. Neither mode returns production or payroll release authorization.

This policy is evaluated from GitHub's authenticated **read-only** metadata and complete PR file listing in the **trusted default-branch workflow**. The untrusted feature branch cannot authorize itself by editing its own policy source.

## Verification evidence and limitations

[PR #902 previously verified commit](https://github.com/erwinmehehe/payrollph/commit/94435b43f98de209065a373d4959af3db8e14b69): 24 successful full CI/security/vault workflows, including PostgreSQL, storage/scan, consent/ESS privacy, and browser acceptance. The earlier A4 Spend #896 merge is preserved via additive schema and retention reconciliation. The source snapshot is not permission to automatically merge; confirm `main` and #902 still integrate cleanly and that the latest application checks are green.

Policy regression tests assert exact 34-file approval, no fake human approval, no release authorization, strict-mode separation, wrong PR/head rejection, unrelated HCM denial, and all changed/renamed/copied/omitted/duplicated or extra-file negatives. **No production DDL, real external object use, employee PII, payouts, signed filing evidence, or runtime feature flag activation** belongs to this exception.

**Retirement:** once #902 is merged or superseded, remove this one-time source exception in a separately tested policy cleanup. Do not repurpose its SHA for subsequent A5 revisions.
