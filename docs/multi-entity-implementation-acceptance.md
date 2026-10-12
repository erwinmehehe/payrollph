# Multi-entity #860 — current source status (2026-10-12)

**Keep PR #860 DRAFT, deployment flags OFF.** The canonical source migration remains `drizzle/0121_multi_entity_v2_scope_transfer.sql` (merged into `main`, **not applied to live Neon**). The new `docs/sql/pending-multi-entity-registration-versions.sql` is **unnumbered/source-only**, and must receive a DBA-approved forward migration number only after reconciling #910's missing `worker_employment_events`, actual Neon migration history and existing 0122+ source reservations. GitHub CI may use disposable PostgreSQL `db:push`; this is not a production migration receipt. Do not apply `0121`, this pending SQL, or any write on Neon until the isolated clone, applied-SHA and restore sign-offs exist.

**Additional code hardening staged on this draft (not independently accepted):** transfer create/decision/list responses use an explicit non-sensitive metadata whitelist, so leave and 13th-month evidence is never serialized to clients; all company exports require an exact allowlisted kind (unknown kinds cannot fall through to JSON/audit); unlinked approval status cannot be probed before authentication/active tenant membership; generic approvals reject read-only group HR and employee-linked HCM approval checks use the selected employer; a stale/revoked saved entity preference recovers only to an authorized employer, while explicit unauthorized IDs still deny. Entity settings selection now persists the server-side selected employer before showing the new form. The pending unnumbered registration migration now adds same-tenant, same-worker, same-source/target composite foreign keys and requires sealed reviewer evidence for a reviewed liability state. Executable PostgreSQL negatives and pure React/policy tests were extended; **do not claim new exact-head CI passed until the run finishes successfully**.

**Source blockers addressed on PR branch:**
- Explicit tenant+entity access is required for employee/run/payroll-adjacent reads. Dashboard pay profiles, revisions, retros, leave, time and provisioning SQL now share a real employer scope predicate (tested with two synthetic tenants); group HR has no personal bank/government identifiers and no mutation ability.
- Multi-granted owner/admin/HR can select *only* individually granted employers; there is no implicit `All entities` read. Dedicated `group_hr` alone gets read-only tenant-local group view. Normal entity-scoped staff with one grant never see the switcher. Context persists per user.
- Source/destination employee transfer permission no longer depends on the read-only `group_hr` role. Instead, only granted source+target employer makers/checkers with separate identities are permitted by the policy; transfer POST/PATCH also require the *independent* `MULTI_ENTITY_TRANSFERS_ENABLED=true` flag, which must remain OFF pending unresolved Philippine service/liability/legal decisions. GET strips sensitive leave/pay snapshots and masks unauthorized entity/tenant resource IDs.
- Group payroll totals use decimal-string centavo arithmetic and honor selected group HR entity filter. Wrong-employer typed confirmation and existing flag-off UI guards remain.
- Employer legal name, statutory IDs, address and company payout configuration no longer overwrite projections through the old settings PATCH. A new, independently gated `MULTI_ENTITY_REGISTRATIONS_ENABLED` proposal/approval API and UI encrypt sealed changes, require MFA/tenant+entity admin role, maker != checker, stale-version revalidation, immutably append an approved profile, atomically update legacy projections and redact history on GET. This code has **not** received an independent migration/operational activation review.
- The approved schema proposal also models entity-owned employee payout account intervals and transfer-liability evidence, but **neither is wired to money movement or automatic 13th/final-pay allocation**.

**Still NOT done / do not claim ready:** independent Philippine payroll/legal approval for transfer service/13th/final-pay/2316/loans; audit/import historical attribution; source `0121` safe production predecessor/receipts; disposable PostgreSQL *and real protected clone* duplicate/idempotent tests, rollback; HTTP-level adversarial role/resource/file/worker/API coverage; real-role mobile/browser 320/375/390/430px screen captures and flag-off full-workspace snapshot; migration checksum approvals; stage/UAT signoff; external provider filing acceptance. Running green GitHub source CI is necessary but insufficient for these gates. No money movement and no change to `src/lib/payroll-engine.ts`.

---

**Legacy API isolation hardening:** Under `MULTI_ENTITY_ENABLED=true`, the old `/api/legal-entities` all-entity directory (employee and bank metadata), new-employer POST and every legacy PATCH action (registration, employee reassignment, primary switch, active toggle) fail closed instead of bypassing explicit employer grants or the versioned-registration rule. The old selector GET remains role-checked and narrowed to an authorized selected employer; under the legacy flag-OFF mode the established management API remains available. Default-employer bootstrapping is now performed only after membership authorization even on legacy GET. No production schema writes were performed by this source change.

**PR #860 safety hold (2026-10-12):** `MULTI_ENTITY_TRANSFERS_ENABLED` is a NEW, separate default-OFF feature gate for all legal-employer transfer writes (request, approve, reject, apply), in addition to `MULTI_ENTITY_ENABLED`. This gate is not a payroll/legal signoff. Direct changes to legal-entity registration, statutory employer identifiers and bank destinations through the legacy settings PATCH now return `409 VERSIONED_REGISTRATION_REQUIRED`; those fields are read-only in the UI until an immutable, reviewed versioned-registration workflow exists. Only an authorized pay-schedule change remains available with MFA, employer grant and an audit receipt. The proposed `drizzle/0121_multi_entity_v2_scope_transfer.sql` is source only; no Neon migration, transfer or employer-liability reassignment occurred. Independent PH payroll/labor continuity, HR/privacy, DBA and current-head UI/database acceptance still block merge and activation.

**Source reconciliation and legal hold (2026-10-12):** This branch now inherits merged canonical SQL 0115–0121 from main. The old duplicate 0115–0119 migrations were dropped from the branch merge result; the only proposed multi-entity source is `drizzle/0121_multi_entity_v2_scope_transfer.sql`. No Neon DDL has been applied. The Philippine employment-continuity, 13th-month, final-pay, BIR 2316 and government-loan handoff rules are NOT decided. Any transfer moving liabilities or service continuity across legal employers remains blocked behind `MULTI_ENTITY_ENABLED=false` and independent professional, DPO, HR and payroll acceptance. Group HR is read-only and grants are tenant-scoped.

**Migration-numbering correction (2026-10-12):** The canonical multi-entity migration SOURCE is now `drizzle/0121_multi_entity_v2_scope_transfer.sql` merged through PR #865; it is **not confirmed applied to Neon**. Old 0115/0119 descriptions below are superseded historical context. The registration-version SQL in `docs/sql/pending-multi-entity-registration-versions.sql` is unnumbered and unapproved for production.

# Multi-entity v2 implementation and UI acceptance

**Status: NOT READY TO MERGE OR ACTIVATE.** Draft implementation only.  
**Feature flag:** `MULTI_ENTITY_ENABLED` in `src/lib/critical-release-flags.ts`; default off, enabled **only** by exact string `true`.  
**Recent inspected main:** `3b1fa4512bd72ef187d4f152751d15e15751d4dd`, October 12, 2026. Refresh exact head/main immediately before any merge or release.  
**Related original design:** merged PR #857, `docs/multi-legal-entity-scope-transfer-design.md`; the merger of its RFC does **not** approve statutory liability transfer or production DDL.  
**This implementation draft:** PR #860, feature branch `feat/multi-entity-v2-flagged-20261012`.

## Schema decisions

The existing `legal_entities` table and `drizzle/0045_multi_legal_entities.sql` / `drizzle/0065_legal_entity_compliance_scope.sql` already implement many requested columns and PRIMARY-employer backfills. `drizzle/0121_multi_entity_v2_scope_transfer.sql` is additive: it creates a default primary entity for tenants without one, adds nullable employer ownership to downstream child records, copies ownership from immutable payroll runs where trustworthy, introduces per-user entity grants/preferences and effective-dated assignments/transfer requests. It deliberately leaves **historical imports and unaffiliated final-pay/filing evidence unassigned** until an operator proves the correct paying employer; guessing from the employee's current assignment would be wrong.

Never run this SQL on a production database before DBA verification of applied receipts/full-path checksums, isolated **copy/clone** migration twice (idempotence), backfill exception counts, composite FK validation, and tested rollback. The migration is NOT yet proven on a copy. No adjustment to `src/lib/payroll-engine.ts` is included.

## Screens and states (feature flag ON only)

| Screen / component | Who sees it | Loading / empty / error behavior | Phone-width intent |
| --- | --- | --- | --- |
| Workspace header legal-entity switcher | Group roles `owner`, `admin`, `bookkeeper`, `group_hr` | Initially reflects server-persisted selection; disabled while saving; error shown inline; all employers option only for group roles | Width limited to `min(42vw, 250px)`; must verify header does not obscure actions at 320/375/390/430 px |
| Entity-scoped header employer badge | `hr`, `payroll`, `checker`, `manager` with exactly one explicit grant | Fixed employer name, no switcher; missing/invalid grant fails request | Single line truncation/wrap to review |
| Entities settings (new) | Group owner/admin/bookkeeper edit; HR/group HR read only; scoped HR sees only granted entity | Loading message, explicit empty message, error + retry; saving disabled and audited; government numbers and bank accounts masked | Responsive grid uses min 240px cards; check input overflow at 320px |
| New hire Entity field | People creation roles; exactly one authorized employer for scoped roles | Choose employer placeholder and disabled submit until selected; validation errors from API | Existing new-hire modal form layout must be checked at 320/375/390/430 px |
| Employee profile Entity selector + transfer dialog | Group owner/admin/bookkeeper initiate; scoped HR sees current employer badge only | Dialog loads target employer list, handles no selection, displays server error, shows saving state; preserves current value until independently applied | Dialog is `min(95vw, 620px)`, scrollable at 88vh, buttons wrap |
| Transfer approval inbox (new) | Owner/admin/bookkeeper can decide, HR/group HR may view authorized requests | Loading, no transfer requests, error + retry, deciding state; checker cannot be original maker | Table scrolls horizontally on narrow phones |
| Payroll run creation | Authorized payroll operators | Typed exact legal name required when enabled; wrong/missing name disables UI + returns 422 from API | Inline typed-name input in existing run dialog |
| Payroll approval and release | Existing checker/releaser roles with entity access | Browser typed-name confirmation before action; wrong text cancels, server also rejects | Native prompt works at phone width, custom mobile dialog remains a UX improvement |
| Payroll register, expanded payslip, filing evidence, exports | Existing payroll operators with entity grant; group roles may select one | Employer identity badge; missing attribution displayed as attention text, backend scope denies cross-entity data | Wrap badges; inspect all panels at phone width |
| People/Time/Payroll/Reports filters | Group roles only; entity-scoped roles cannot switch | Changing entity stores preference and reloads scoped data; rejected selection shown as error | Filter uses header switcher style; verify second switcher does not crowd phone views |
| Group headcount & released payroll cost | Group HR, owner/admin/bookkeeper; **not** entity-scoped HR/payroll | Loading, no entity rows, error + retry; totals explicitly released runs only; refuses unattributed records | Scrollable summary table; no fixed-width charts |

Current **implementation caveats**: some legacy enterprise or HCM endpoints have not yet been independently audited for every entity-scoped field; ambiguous historic data and some advanced analytics are deliberately blocked rather than presented incorrectly. The group totals are **all released history**, not a date-range drilldown. Mobile browser behavior, exact overall flag-off workspace snapshot and original employer-specific agency file acceptance are **not yet witnessed**.

## Behavioral acceptance evidence required

- Run `npm run typecheck` and `npm run lint` (no new warnings).
- Run `npm run payroll:golden`, `npm run payroll:golden:phase2a`, `npm run payroll:golden:phase2b` and `npm run payroll:golden:pay-rules` **unchanged** with the flag OFF and compare against base main receipts.
- Run `TZ=Asia/Manila npm test` with real DB fixtures (new `tests/multi-entity-behavior.test.ts` and `tests/multi-entity-isolation-db.test.ts`; these execute policy/React/Postgres behavior rather than grep strings). Add HTTP-level multi-role resource guessing, file download and maker/checker concurrency tests before approval.
- Rehearse `0119` twice on a restricted isolated **copy** with representative tenant and payroll records, verify counts/centavos/foreign keys and that unknown imported history stays blocked. No production backfill without audit receipts.
- Verify full before/after **flag OFF** legacy workspace HTML or screenshot; React widget empty-render test alone is not a whole-workspace snapshot.
- Validate exact enrollment/transfer roles and role changes, including revoked grants and concurrent users who change selected employer.
- Verify group HR cannot modify or release payroll, and entity-scoped users cannot read any other entity or tenant through direct IDs, search, notifications, CSV, bank downloads, government files, self-service impersonation, workers or V1 APIs.
- Review payroll/labor-law attribution: leave balances carry forward as continuity evidence, source employer basic and paid 13th records are retained by year; no inter-employer final-pay settlement is created automatically. A separate Philippine payroll/legal approval is required to certify assumption of any old-employer liability.

## Screenshot capture checklist (NOT YET CAPTURED)

Capture *actual authenticated running app*, flag OFF (before) and ON (after), at desktop 1440px and Playwright mobile viewport 375px (also 320/390/430px overflow assertions). Evidence for each must show correct role, selected employer, date/build SHA and no sensitive IDs:

1. Owner workspace header: before without entity control; after All entities and selected employer.
2. Entity-scoped HR workspace header: before legacy; after fixed employer badge and **no switcher**.
3. Entities settings: loading, masked and read-only/editor, validation error, successful audit notice.
4. New employee modal: before no Entity field, after required employer dropdown.
5. Employee profile: after field change opens effective-date transfer dialog (source/target/leave/13th).
6. Transfer inbox: empty, pending, maker blocked on own approval, checker approval and applied history.
7. Payroll start: wrong legal name blocked, exact match allowed.
8. Payroll approval/release: wrong name cancelled, correct name still subject to maker-checker/MFA.
9. Payroll register and expanded payslip: employer badges.
10. Government filing evidence and export picker: employer badges.
11. People, Time, Payroll and Reports entity-filter states.
12. Group HR report and entity-scoped role denied group totals.
13. Flag-OFF whole-workspace screenshot parity against `main` on identical fixture.
14. Both tenant/entity cross-access attempts at 403/404 with no sensitive response body.

**Actual screenshots/Playwright reports are not attached**, because a runnable authenticated app + isolated DB + browser fixture is not yet available in this execution environment. Do not substitute illustrations or synthetic mockups as proof. Required acceptance is blocked until real browser screenshots and 320px overflow evidence are stored as CI artifacts.

## Release and activation instructions (after approval only)

1. Check branch against **fresh** `origin/main`; resolve any force-update or SQL numbering conflict, and verify DB applied migration receipts.
2. Have DBA execute additive SQL `0119` twice **on an isolated copy only**, check the exception report and required constraints; authorize a controlled production schema release independently.
3. Run all behavior, TypeScript, lint, goldens and timezone-regression suites on the exact proposed SHA. The GitHub queued CI status is not a passed test.
4. Obtain HR, Philippine payroll and security/privacy signoffs for transfer liability and statutory report boundaries.
5. Enable exact env `MULTI_ENTITY_ENABLED=true` on an allowlisted staging/pilot environment, then perform the above browser acceptance. **Do not enable in production until all tests and evidence are complete.**
6. Roll back application behavior by reverting the flag to OFF. Keep additive SQL and immutable history intact; never reset or silently reassign money evidence.
