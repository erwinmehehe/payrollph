# PayrollPH build program: attached list acceptance ledger

Baseline: freshly fetched main `4d816361`, 12 October 2026 Asia/Manila. This ledger records inspected source, not production certification. Existing code is not marked complete until the requested behavioral, UI, role, phone, flag-off and full-suite evidence exists. One block per PR; multi-entity and approval chains remain isolated.

| Order / block | Evidence on latest main or draft | Remaining acceptance work |
| --- | --- | --- |
| First payroll inline | Draft #858; latest full CI and inline acceptance passed | Review and complete any additional UI evidence required by the attached list; not merged or activated |
| Import preview | Draft #873 (supersedes closed combined #863) | Error filter and MFA/role/phone/flag-off browser workflow added; predecessor actual PostgreSQL acceptance passed; final isolated CI/screenshots pending |
| Core-only nav | Separate draft #874 (supersedes closed combined #863) | New/existing snapshots and migration rehearsal passed on predecessor; scoped-admin UI checked; final isolated CI/browser screenshots pending |
| C-1 accounting export | exporters.ts, labor-costing.ts, labor_gl_mappings | Component mapping UI; strict missing mappings; immutable replay; actual format adapters; OT/loan/accrual balance fixture |
| C-2 SSO/directory | OIDC routes, oidc.ts, scim.ts, Enterprise screens | Verify provider/domain settings, lowest-role JIT, deprovision session invalidation, break-glass MFA and browser acceptance |
| A-1 benefits/loans | benefits/hmo routes, loans route, final-pay-loan-authority.ts | Audit amortization/floor/override/early-resignation behavior and screens; extend only confirmed gaps |
| Fix A prior-year retro | final-pay.ts already attributes RETRO to original pay year | 12 behavioral final-pay regression tests passed under TZ=Asia/Manila, including prior-year retro; do not introduce a second attribution implementation |
| Fix B scheduler | scheduler state/lease/liveness, tick/status/cron routes, worker and staging workflows | Production guaranteed trigger activation and credentials are not established by source; admin heartbeat evidence and isolated scheduler tests |
| Fix C runtime schema | Runtime writer inventory and receipt audit tools exist | Review ordered-migration-cutover-design.md before runtime changes; real DBA history evidence |
| Face/offline punches | Geofence/web-bundy routes preserve no raw GPS | Consent, encrypted photo storage, purge, IndexedDB/review/skew/device flags and UI acceptance |
| Roster paging/rules | team-roster already has SQL limit/offset; roster batches exist | 1,000-assignment paging proof; configured rule publish findings/overrides and exact 13-hour/5-hour fixture |
| Multi-entity step 0 | docs/multi-legal-entity-scope-transfer-design.md on main, status DESIGN FOR REVIEW | Review default entity, exhaustive table scope, continuous service history and rollback before phases 1–3 |
| Multi-entity phase 1 | legal_entities/ownership columns already exist | Implement reviewed intervals, grants, registrations and real isolation only after design review |
| Multi-entity phase 2 | Existing entity settings/backend baseline | Switcher, badge/filter, transfer, typed wrong-entity guard; unchanged flag-off snapshot |
| Multi-entity phase 3 | Effective changes/events exist | Approved transfer accounting, accrual and group-read reporting without separation inference |
| Approval chains | Existing policy/instance/admin/delegation tables | Review approval-chain-extension-design.md; numeric escalation and full delegation independence behavior |
| Report builder | Fixed whitelisted reports and analytics exist | Field/filter/group/saved-report UI; salary field isolation; audited CSV; no arbitrary SQL |
| Public API/events | v1 employees/payroll and provider_events pattern exist | Audit scoped/revocable tokens/rate limits; org-unit/payslip endpoints, idempotency/feed and OpenAPI |
| C-3 bank files | Exporters/templates/payout profiles and ledger already exist | Official specs only; immutable generation/redownload evidence and separate bank confirmation state |
| C-4 government files | Government drafts, BIR/remittance flows exist | Per-form status/version/fixture inventory; complete verified gaps; no portal submission |
| A-2 recruitment | Pipeline and governed hire/position handoff exist | Consent/6-month rejection purge/export-delete/public careers and first-payroll prefill acceptance |
| A-3 employee cases | ESS plus operational/contribution cases exist | Employee request types, internal/public replies, SLA/COE approval and Taglish UI |
| A-4 spend payroll | Spend report reimbursement state and expense claims exist | Receipt/chain/tax category and actual payroll idempotency proof; no duplicate payment |
| A-5 document vault | Document requirements/upload/access routes exist | Object-storage/signed URLs, base64 migration plan, sensitive-view audit and 30/14/7-day alerts |
| A-6 offboarding | Separation/final-pay/IT offboarding exist | Unified clearance/waiver/COE/access-revocation flow and Fix A regression |
| C-5 e-signature | Document infrastructure exists | Immutable signed PDF/hash/verification and built-in evidence interface; provider adapter slot |
| Later auto-schedule | Demand/coverage tooling exists | Draft-only deterministic solver after rules acceptance; explain unfilled slots and fairness |
| Later surveys | No acceptance proof in current inventory | Anonymous threshold >=5; page and default-off flag; anti-reidentification tests |
| Later goals/reviews | Performance routes/UI exist | Scope minimal cycle using existing machinery; avoid duplicate module; behavioral and UI acceptance |

## Build and rollout contract

Each feature gets a default-off release-registry flag, an independent PR, real tenant and maker-checker behavior tests, tsc, no new lint warnings, all golden payroll suites and full tests under TZ=Asia/Manila. Every new/changed screen records empty/loading/error states, roles and phone-width before/after screenshots. Never put secrets, tokens or government IDs in logs. No production money movement, government submission, live connector activation or deployment is inferred from implementing code.

No multi-country/EOR, SAP/Workday, licensed insurance or lending product work is in this program. No official bank/agency format is invented when a specification is unavailable.

## Review gates

The attached list explicitly requires reviewed written plans for multi-entity, approval chains and Fix C. Existing multi-entity RFC remains unapproved; new approval-chain (#869) and ordered-migration (#870) notes are design-only. Implementation of those three blocks waits for written review. Other independent blocks can proceed without that dependency.
