# Ten workflow frontends — role, state, mobile and screenshot acceptance

**Status: DRAFT / NOT READY TO MERGE / DO NOT ACTIVATE IN PRODUCTION.**  
Baseline fetched from `main`: `e31da5ce84b3943a0747b0a0ad9acc0ac0562b14` on 2026-10-12.  
Implementation branch: `feat/ten-workflow-frontend-20261012`, PR #862.  
**Security invariants:** enforce authoritative server permissions on every request, preserve tenant and scoped HR isolation, preserve maker-checker. No changes to `src/lib/payroll-engine.ts` or to government/loan computation algorithms.

## Default-OFF flags

Every flag is evaluated **on the server**, passed to the client through `WorkflowUiProvider` and accepts **only** the exact string `true`:

| UI family | Environment variable |
| --- | --- |
| First payroll | `FIRST_PAYROLL_INLINE_UI_ENABLED` |
| Import | `IMPORT_REVIEW_UI_ENABLED` |
| New tenant navigation | `CORE_ONLY_NAV_UI_ENABLED` |
| Camera/offline claims | `FACE_OFFLINE_PUNCH_UI_ENABLED` |
| Roster review | `ROSTER_PUBLISH_UI_ENABLED` |
| Approval chains | `APPROVAL_BUILDER_UI_ENABLED` |
| Report builder | `REPORT_BUILDER_UI_ENABLED` |
| Benefits and loans | `BENEFITS_LOANS_UI_ENABLED` |
| Recruitment | `RECRUITMENT_JOURNEY_UI_ENABLED` |
| Employee case management | `EMPLOYEE_CASES_UI_ENABLED` |

The new release registry lives in `src/lib/critical-release-flags.ts`. Unset flags leave the new interface invisible. Other existing safety flags (e.g. `WFM_BULK_PUBLISH_UI_ENABLED` and treasury/payroll approval controls) remain independent; these UI flags **cannot** override them.

## Screen inventory and state/role contract

| Block / screen | Flag-ON roles | Empty, loading, error, outcome states | Narrow-phone requirements |
| --- | --- | --- | --- |
| First payroll inline drawers and blockers | Existing workspace first-payroll roles; owner/admin/HR with company-wide scope may send to team | Seven steps; ready/blocked/review, errors and sending status; no employee or no checker; handoff records operational case, does not grant role | Horizontal preview grid scroll, action buttons wrap; modal remains accessible |
| Import upload / correction grid | Existing authorized People import roles | CSV file chooser; parse/validation error, upload/network failure, no rows, all/valid/error filter, corrected CSV download; commit after validation when new flag on | Grid scrolls, filter and download remain reachable |
| Core-only nav / More modules | New self-service customer workspaces under flag, each role's already permitted modules | Core tab list and module directory; restricted modules visibly unavailable; existing tenants not opted in | Standard mobile drawer; tiles reflow at 320px |
| Camera consent and offline claim | Employee linked to their own identity; reviewer queue restricted to authorized company HR | Consent unchecked, camera requesting/ready/denied, online/offline, queued unsent, sync sending/error, HR pending/flagged/dismissed; no raw face photo stored | Web Bundy modal max 95vw/90vh scroll; check camera no overflow and all buttons reachable |
| Governed roster publish/staging findings | Existing company-wide People roster maker/checker roles, **plus** underlying WFM pilot flag | Source loading and error; no worker/shift; blocked vs warning findings; confirmation dialog reason and acknowledgement; staged, checker review, error | Scroll modal and findings list, buttons wrap |
| Approval-chain preview/delegation | Existing company-wide approval-chain admin; actual delegation actions restricted to existing authorized approval participants | No policies, loading/error, configured steps, missing approver or invalid chain; delegation list/empty/error/saving; reviewer expiry | Step list and form fields wrap; no invisible approve control |
| Custom report builder / CSV | Existing report viewers; report API remains final authority | Saved list/loading/error, no report data, field picker, filters/no matches, preview, save/update/delete, CSV | Preview table scroll, selects/filters wrap |
| Benefits enrollment, loan schedule, payslip lines | Existing benefits/loan admins for changes; employee sees only own released payslip lines | Enrollment review & confirmation, pending/approved loans, no schedule/recorded payments; stored payslip lines/no deduction lines | Split inputs and schedule table scroll |
| Careers / job pipeline | Existing recruitment admins; public visitors see only explicitly published jobs, no private candidates | Published/unpublished/error; no published vacancy; application form and submit/sending/error/received; candidate Hire still goes through existing approval gates | Jobs stack, form single column at phone |
| Employee case form / HR inbox | Linked employee sees only own cases; HR owner/admin/HR with existing unit constraints may view relevant cases | Form validation, loading, no submissions, status filters, error/retry, detail conversation, private HR note, resolution; no attachments yet | Scroll inbox and adaptive form/cards |

**Critical distinctions / NOT fully implemented:** The first payroll drawers include inline blockers and handoffs but some underlying company/employee/time edits still use their governed existing screens; true in-drawer editing for every step is not certified. Approval-chain “escalation settings” currently use due/review labels and existing delegation controls; they do **not** automatically schedule escalation. The camera panel is a **non-biometric preview**; no live face template enrollment, matching, biometric retention, or anti-spoof model exists. Offline events are *claims*, not verified attendance and never used in payroll until separate HR correction. File uploads for employee cases are deliberately unsupported until scan/retention controls are integrated. Projected loan schedules and report previews are UI-only, not financial calculations or agency-approved formats.

## Data / migration design and rollback

**MIGRATION NOT ALLOCATED / DO NOT APPLY:** The SQL below is a design proposal, not a numbered release migration. The current #865 train exclusively owns 0115-0119. Split the ten-feature PR and obtain a reviewed post-train number with exact-head code/schema parity and historical-receipt DBA signoff before merging or enabling any flag.

`docs/engineering/migration-proposals/workflow-frontend-requests.sql` adds only additive schema: `job_requisitions.careers_published` (default false), `saved_report_definitions`, `employee_service_cases`, `employee_service_case_messages`, `offline_punch_claims`. Composite tenant foreign keys exist for case-to-employee, case-message-to-case, and offline-claim-to-employee. Existing payroll and employee identity are not modified. Because main is frequently rewritten and PR #860 may also use numeric prefix 0115, **a final re-fetch, migration number reconciliation and applied-hash receipt audit are mandatory before merge**. Do not run production migration until DBA rehearses it **twice** on a representative isolated copy and signs data/constraint evidence. Rolling back the feature is flag-OFF; keep immutable case/claim data and never truncate payroll.

## Executable tests added

- `tests/workflow-frontend-behavior.test.ts` executes real flag decisions, first-payroll preview, multiline quoted CSV parser and spreadsheet-safe error download, report projections and formula-safe CSV, centavo-safe loan schedule, and React server-rendered screens for role-specific navigation/requests/camera/careers. Tests assert behavior, **not source-code grep**.
- `tests/workflow-case-tenant-integration.test.ts` executes PostgreSQL two-tenant and multiple-employee fixtures, using the same tenant/employee predicates and composite FK refusal for foreign employee IDs and case IDs. Requires additive schema; before the migration is installed, this fixture reports explicit skipped status rather than pretending successful isolation.
- Additional full HTTP authentication/permission, real camera/reconnect, maker-checker roster, hiring, browser and two-role tests are still required for release acceptance.

**Required commands on exact head SHA:**
```sh
npx tsc --noEmit
npm run lint
npm run payroll:golden
npm run payroll:golden:phase2a
npm run payroll:golden:phase2b
npm run payroll:golden:pay-rules
TZ=Asia/Manila npm test
```

No result is green until **actually observed** and documented. A queued GitHub Action is not a pass. Flag OFF should retain legacy behavior and golden payroll outputs, but complete app snapshot parity has **not** yet been proven.

## Before/after and Playwright screenshot requirements (NOT YET CAPTURED)

Use an **authenticated isolated staging tenant** and synthetic workers. Log the commit SHA, role, route, employer, viewport and flags in each report. Capture flag-OFF before and flag-ON after desktop at 1440x900 and phone at **320, 375, 390, 430px**. Screenshot paths must be created by an actual browser run; do not substitute design mockups for test evidence.

| Screenshot target | Required captures |
| --- | --- |
| First payroll | Old checklist; new 7-step preview, opened blocker, send-to-role success/error |
| Import | Old import; new preview, error filter, downloadable error CSV |
| New tenant navigation | Before original sidebar; after core-only nav, More modules, restricted card; mobile drawer |
| Face/offline | Consent, camera permission denial/preview, offline queued banner, returned connectivity, HR flag queue |
| Roster review | Before existing staging form; after publish finding dialog with blockers/warnings and reason |
| Approval chains | Old builder; after step preview, delegation empty/saving/error, role-denied action |
| Reports | Old report page; new picker, filters, empty results, saved view, CSV |
| Benefits/loans | Old enrollment/loan; new enrollment confirmation, approved schedule, stored payslip lines |
| Recruitment | Old pipeline; published careers listing, empty careers state, application form/success and HR publish button |
| Cases | Employee request form/receipt/conversation; HR inbox empty/pending/details/resolution/private note |

For each phone width, assert **no page-level horizontal overflow** (tables inside intentional scroll containers excepted), focus reachability, no cut-off actions, dialogs scroll vertically, and accessibility text/label readability. Test switching roles and tenants does not reuse stale component state. Use a before/after `main` screenshot on the **same fixture** for true flag-OFF comparison.

**Actual screenshots and mobile results are missing:** no authenticated running app + browser/Playwright session is accessible in the current tooling. Do not claim captured evidence.

## Release signoff

Keep PR #862 **draft**, all flags OFF. Before merging: fresh `main` fetch/rebase check, DBA migration copy/receipt, exact-SHA TS/lint/golden/full Manila tests, HTTP-level tenant+role authorization, reviewer signoffs for privacy/workforce/HR/legal and every listed browser screenshot. Source code presence alone does not satisfy DONE.
