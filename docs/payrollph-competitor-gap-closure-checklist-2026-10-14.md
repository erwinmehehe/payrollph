# PayrollPH / Linaw — Competitor Gap-Closure Master Checklist

**Baseline date:** October 14, 2026 (Asia/Manila)  
**Scope:** HRIS, workforce management (WFM), guided first payroll, HCM, employee profile, compensation, analytics, security and go-live evidence.  
**Decision:** Finish and independently verify core employer workflows before broad feature expansion.

> **Interpretation:** This is an execution backlog, not a competitor feature-parity certification. A feature can be implemented in source and still require role-scoped UI, live environment, privacy, employer and reviewer acceptance. Unchecked boxes mean gap closure or independent proof remains open; they do not automatically mean the feature does not exist.

## Priority and benchmark matrix

| Priority | Workstream | Product experience benchmark | Gap to close | Tracking |
| --- | --- | --- | --- | --- |
| P0 | First employer / first payroll | Gusto | New employer completes a safe, understandable end-to-end payroll journey | [#853](https://github.com/erwinmehehe/payrollph/issues/853), [#993](https://github.com/erwinmehehe/payrollph/issues/993) |
| P0 | WFM proof | Deputy, Rippling | Manager, worker and payroll operator complete the same shift-to-pay workflow | [#691](https://github.com/erwinmehehe/payrollph/issues/691) |
| P0 | Payroll correctness / security | Philippine payroll requirements | Independent real-period reconciliation and mandatory production safeguards | [#579](https://github.com/erwinmehehe/payrollph/issues/579), [#112](https://github.com/erwinmehehe/payrollph/issues/112) |
| P1 | Everyday HRIS | BambooHR, PeoplesHR | Easy employee, onboarding, leave, tasks and approvals journey | [#848](https://github.com/erwinmehehe/payrollph/issues/848), [#852](https://github.com/erwinmehehe/payrollph/issues/852) |
| P1 | Employee 360 | Deel | One connected, permission-safe worker profile | [#700](https://github.com/erwinmehehe/payrollph/issues/700), [#692](https://github.com/erwinmehehe/payrollph/issues/692) |
| P1 | Compensation | HiBob | Cycle-first manager worksheet, budgets, HR/Finance approvals | [#601](https://github.com/erwinmehehe/payrollph/issues/601) |
| P2 | Advanced WFM | UKG | Verified forecast accuracy, labor planning, scale and operational controls | [#678](https://github.com/erwinmehehe/payrollph/issues/678) |
| P2 | Enterprise HCM | Workday | Governed processes, position/plan continuity, identity and analytics | [#601](https://github.com/erwinmehehe/payrollph/issues/601) |

## Implemented foundations — reuse, do not rebuild

These are **source implementations**, not independently signed customer parity:

- Everyday HR task-first navigation: merged [PR #849](https://github.com/erwinmehehe/payrollph/pull/849).
- Employee 360 overview and gated read-only Worker 360: merged [PR #804](https://github.com/erwinmehehe/payrollph/pull/804) and [PR #701](https://github.com/erwinmehehe/payrollph/pull/701).
- WFM roster, smart coverage draft and shift-to-pay source: merged [PR #683](https://github.com/erwinmehehe/payrollph/pull/683), [PR #677](https://github.com/erwinmehehe/payrollph/pull/677) and the five-fictional-worker test [PR #960](https://github.com/erwinmehehe/payrollph/pull/960).
- Gusto-inspired seven-step inline first-payroll setup (opt-in/default-off) and source-connected nine-stage synthetic flow: merged [PR #915](https://github.com/erwinmehehe/payrollph/pull/915) and [PR #834](https://github.com/erwinmehehe/payrollph/pull/834).
- Nine-stage and HRIS CI-trigger protection plus the independent operator runbook: merged [PR #990](https://github.com/erwinmehehe/payrollph/pull/990).
- Governed candidate hire and compensation review: merged [PR #606](https://github.com/erwinmehehe/payrollph/pull/606), [PR #608](https://github.com/erwinmehehe/payrollph/pull/608) and compensation budget preview [PR #839](https://github.com/erwinmehehe/payrollph/pull/839).
- HCM Action Center: merged [PR #786](https://github.com/erwinmehehe/payrollph/pull/786).

Do not infer live feature enrollment, actual user comprehension, real payroll certification, supported physical-device acceptance, official agency acceptance or live payment authorization from merged PRs or green synthetic CI.

---

## P0 — Cross-product proof, security and payroll confidence

- [ ] Independently observe all nine stages for one fictional worker: Hire → Onboard → Schedule → Clock In → Approve Time → Run Payroll → Review → Release **records only** → Draft Filing Evidence.
- [ ] Separately prove the *governed* candidate → independent Hire BP → authoritative employee route. The current synthetic nine-stage test's direct employee creation is **not** proof of candidate conversion.
- [ ] Use two fictional employers and disjoint employee IDs, with separate HR, manager, employee, payroll officer, checker, owner and independent observer roles.
- [ ] Independently observe desktop and **physical phone** use, including A → B → A employer switching, retry after interruption, no stale pay or personnel state, and wrong-tenant API denial.
- [ ] Complete novice HR admin UAT with two **actual untrained users**, with paths, elapsed times, mistakes, assistance requests, private evidence IDs and independent review.
- [ ] Complete all 14 WFM scenarios with genuine operator observations; where physical hardware is unavailable, mark WFM-14 NOT_RUN_EXTERNAL and exclude unsupported hardware from pilot claims.
- [ ] Resolve critical and high-severity payroll, tenancy, privacy, workflow or accessibility defects and rerun their exact-SHA tests.
- [ ] Verify production MFA/secrets, encryption of bank and government identifiers, appropriate audit-chain/DB roles, transactional email, and role/tenant isolation before any real-person data enters testing.
- [ ] Complete protected database backup/restore impact and source-history review, including incident [#899](https://github.com/erwinmehehe/payrollph/issues/899) and migration ownership; **no live database repair or swap is authorized by this checklist**.
- [ ] For one consenting real employer, run a completed period in an access-controlled **no-money parallel payroll** and obtain independent worker-by-worker gross, premiums, deductions, net, GL and bank-file dry-run reconciliation.
- [ ] Require **zero unexplained differences greater than PHP 0.01 per employee/component**, plus independently reviewed exceptions, source references and owner decision.
- [ ] Complete later bank/provider and government portal acceptance **separately** before claiming production-certified payouts or filings.

**Definition of done:** Exact-commit CI is green **and** independently observed human evidence and applicable environment controls pass. The controlled no-money employer test is not the same as money movement or broad launch.

**Issues:** [#853](https://github.com/erwinmehehe/payrollph/issues/853), [#852](https://github.com/erwinmehehe/payrollph/issues/852), [#691](https://github.com/erwinmehehe/payrollph/issues/691), [#579](https://github.com/erwinmehehe/payrollph/issues/579), [#112](https://github.com/erwinmehehe/payrollph/issues/112), [#899](https://github.com/erwinmehehe/payrollph/issues/899).  
**Operator runbook:** [First Employer Journey Execution](qa/first-employer-journey-execution.md) and [Independent #853 Evidence](qa/independent-journey-853.md).

## P0 — Guided First Payroll vs. Gusto

- [ ] Present the existing seven steps as one clear employer journey, with owner/HR/payroll/checker responsibility, readiness state, blockers and resumed progress.
- [ ] Show missing legal-employer details, Philippine registration requirements, pay schedules, worker master data, statutory identifiers and pay profiles without leaking sensitive fields.
- [ ] Make first-worker creation, import review and onboarding reconciliation usable by a new employer without developer direction.
- [ ] Correctly handle prior payroll, effective start dates and year-to-date statutory context when a customer migrates midyear.
- [ ] Replace the simple-pay-only preview limitation with a **read-only projection that uses the canonical payroll input assembly/calculator**; do not duplicate payroll rules or authorize writes.
- [ ] Support **approved, complete** relevant cutoff sources: time punches, daily/hourly pay, night differential, overtime, leave, rest/holiday work, approved loans, benefits and recurring pay.
- [ ] Report worker-and-period-specific incomplete source evidence as **actionable blockers**. Never invent a net figure to make the guide appear ready.
- [ ] Show source-linked gross → statutory deductions → other deductions → net results to authorized roles before a separately confirmed draft action.
- [ ] Preserve maker/checker/owner duties, payroll cutoff locking, exception review, records-only release and the hard boundary against payout instructions.
- [ ] Trace payslip/register/bank-file dry-run/draft government worksheets to the same approved payroll-run and source data, with hashes for drafts.
- [ ] Human-test the guide for both a simple fixed-salary tenant and a more complex attendance-based tenant; include 375px/390px mobile and employer switching.

**Definition of done:** A novice employer completes safe first-payroll preparation and authorized record release with no missing wages, unexplained statutory variances or hidden cross-module dependency. **No actual funds move.**

**Issues:** [#993](https://github.com/erwinmehehe/payrollph/issues/993), [#853](https://github.com/erwinmehehe/payrollph/issues/853), [#579](https://github.com/erwinmehehe/payrollph/issues/579).

## P1 — Everyday HRIS vs. BambooHR / PeoplesHR

- [ ] Validate role-aware Everyday HR home priorities: Find Employee, Hire & Onboard, Manage Leave, My Team, Assigned Approvals; collapse secondary settings.
- [ ] Test candidate/requisition → governed Hire BP → employee profile → onboarding without duplicated worker identity or bypass.
- [ ] Show employee-specific missing documents, onboarding tasks, owners, due states and completion evidence in one easy flow.
- [ ] Test employee self-service for profile, leave balances, requests, payslips and controlled sensitive-field changes.
- [ ] Reconcile leave approval, remaining balance, supported accrual/carryover policies and subsequent payroll treatment.
- [ ] Simplify employee quick search, imports, required fields, validation and user-facing blocked/error/retry messages.
- [ ] Verify manager vs HR vs payroll vs Core/Enterprise navigation and **server-side** permissions; direct URLs/APIs cannot bypass entitlements.
- [ ] Independently test five novice-admin tasks on desktop and a real phone, including focus, keyboard, reload/resume and employer switching.
- [ ] Provide reliable, authorized everyday summaries: workforce headcount, recent hires, separations, leave and pending work; never imply a partial list is complete.

**Definition of done:** Two novice administrators complete the assigned five daily HR tasks without developer assistance; zero wrong-employer or unauthorized writes; severe UX defects closed with retest.

**Issues:** [#848](https://github.com/erwinmehehe/payrollph/issues/848), [#851](https://github.com/erwinmehehe/payrollph/issues/851), [#852](https://github.com/erwinmehehe/payrollph/issues/852).

## P1 — WFM vs. Deputy / Rippling

- [ ] Observe a manager completing weekly roster → shift assignment → rules preview → publish → swap/open-shift coverage in the actual app.
- [ ] Improve mobile roster/task navigation, templates, bulk edits, explicit preview and reversion only where witnessed friction justifies changes.
- [ ] Validate availability, approved leave, qualifications, site/worksite, scheduled rest and cross-midnight constraints before shift publish.
- [ ] Test Live Floor truthfulness for on-shift, late, absent, clocked-out, on-leave and staffing-exception states.
- [ ] Consolidate manager attention around missing punches, shift claims, uncovered shifts, corrections, overtime and overdue timecards.
- [ ] Exercise notifications with opt-in and deduplication, privacy-safe delivery receipts and failure recovery; do not silently automate employee discipline.
- [ ] Demonstrate **same worker / same cutoff** schedule → authenticated IN/OUT → correction → independent timesheet approval → canonical payroll premium/source trace.
- [ ] Review separately the five-worker WFM scenarios: ordinary shift; cross-midnight/night pay; independently approved OT; missing clock-out correction; rest-day premium.
- [ ] Test real supported biometric/kiosk/offline hardware before claiming certification; verify clock drift, replay, duplicate punches, conflicts and privacy notice.
- [ ] Rehearse a 50–200-person multi-site fictional workforce for paging, manager usability, shift conflicts and failure handling, with authenticated roles.

**Definition of done:** Actual manager/worker/payroll roles complete the shift-to-pay flow without spreadsheet bypass; wage premiums and lock/approval behavior independently reconcile.

**Issues:** [#678](https://github.com/erwinmehehe/payrollph/issues/678), [#691](https://github.com/erwinmehehe/payrollph/issues/691).

## P1 — Unified Worker Profile vs. Deel

- [ ] Consolidate entry points to Employee 360 and gated Worker 360; retain **one authoritative worker master** and source-owned actions.
- [ ] Organize authorized worker context around Overview, Job & Organization, Compensation, Leave, Documents, Performance and History.
- [ ] Show verified legal employer, current job/position, manager, worksite and employment status, with provenance and truthful as-of context.
- [ ] Show employment events, transfers, pay-change metadata and separations using actual effective-dated records, not inferred history.
- [ ] Display assigned onboarding, review and employee-action items from existing sources without cloning writable tasks.
- [ ] Test employee, line manager, HR, payroll and Finance views independently; do not expose bank, IDs, salary or sensitive notes to unauthorized roles.
- [ ] Test mobile navigation, event pagination, selected employee identity preservation, cross-tenant denial and truthful incomplete-source states.

**Definition of done:** An authorized HR user can understand the worker and reach the source-owned action/history from one view without duplicated data or loss of permissions.

**Issues:** [#700](https://github.com/erwinmehehe/payrollph/issues/700), [#692](https://github.com/erwinmehehe/payrollph/issues/692).

## P1 — Compensation vs. HiBob

- [ ] Make compensation **cycle** the starting point: approved pool, committed changes, pending proposals and genuinely available budget.
- [ ] Provide a scoped manager worksheet: current compensation, salary band, compa-ratio, proposed raise/percentage, new salary and budget effect.
- [ ] Clearly distinguish pending/proposed amounts from approved/committed spend using centavo-safe projections.
- [ ] Give HR/Finance assigned independent reviews, statuses and reason/evidence views without leaking pay data outside scope.
- [ ] Flag out-of-range compensation, budget overruns, stale bands, duplicated proposals and conflicting concurrent decisions.
- [ ] Offer read-only allocation scenarios before submitting a canonical governed compensation proposal.
- [ ] Validate independent maker/checker, send-back/cancel where supported, effective dates, payroll locks, retroactive adjustments and audit history.
- [ ] Only apply approved pay changes to the authoritative pay timeline after the server authorizes them.
- [ ] Test private equity/compensation analytics with appropriate visibility thresholds and permissions.

**Definition of done:** Manager → HR/Finance → independently approved effective-dated pay change is usable, budget-correct, auditable and reflected in payroll without a parallel wage master.

**Issue:** [#601](https://github.com/erwinmehehe/payrollph/issues/601).

## P2 — Advanced WFM vs. UKG

- [ ] Score prospective demand forecasts against **complete actual future demand**, including accuracy/bias by site, role and planning window.
- [ ] Keep automatic staffing recommendations as explainable **drafts** requiring authorized manager confirmation and payroll-safe rule checks.
- [ ] Report coverage gaps, overtime, absences, schedule instability and hours allocation from permission-safe authoritative data.
- [ ] Prove performance and fairness under multiple sites, large rosters, overnight/split shifts and qualified-position constraints.
- [ ] Validate operational demand/POS feeds only when provenance, consent, source completeness and integration ownership are established.
- [ ] Add vertical-specific packs (BPO, healthcare, hospitality, retail, manufacturing) only from real employer requirements and validated Philippine policies.

**Definition of done:** Forecasts and staffing scenarios are measured, explainable, no-autopublish and useful at actual target employer sizes.

**Issues:** [#678](https://github.com/erwinmehehe/payrollph/issues/678), [#194](https://github.com/erwinmehehe/payrollph/issues/194).

## P2 — Enterprise HCM vs. Workday

- [ ] Connect approved Hire, Job Change, Position Change, Compensation Change and Termination processes in a unified role-aware Action Center.
- [ ] Complete governed send-back, correction, rescind and delegation with append-only auditable decisions and source-process reconciliation.
- [ ] Validate routing, due/deadline behavior, missing approver ownership, duplicate submissions, stale requests and concurrent approvals.
- [ ] Trace approved workforce plan → position budget/execution → requisition → offer → candidate hire → employee/position assignment.
- [ ] Test legal employer, supervisory hierarchy, org unit, maker/checker, pay/PII and direct-route authorization under Enterprise gating.
- [ ] Prove identity provisioning and revocation against actual OIDC/SAML/SCIM providers before claiming certified interoperability.
- [ ] Deliver effective-dated, source-linked headcount/FTE, vacancy, turnover, time-to-fill, compensation budget and approved labor-cost analytics.
- [ ] Validate analytics privacy, permission checks, complete vs partial coverage and accessible drill-downs.
- [ ] Keep broad LMS, succession, surveys, AI decision automation and marketplace expansion deferred until core users and customers show validated demand.

**Definition of done:** Governed HR lifecycle changes survive independent role/tenant/race tests, remain auditable and show correct history and payroll consequences.

**Issues:** [#601](https://github.com/erwinmehehe/payrollph/issues/601), [#692](https://github.com/erwinmehehe/payrollph/issues/692).

---

## Delivery sequence — execute in this order

| Step | Work package | Evidence required |
| --- | --- | --- |
| 1 | Independent first-payroll and novice HR acceptance | Real operator/witness observations, physical phone, zero critical defects |
| 2 | WFM 14-scenario acceptance | Human manager/HR/worker/payroll cases, device scope explicitly bounded |
| 3 | Production safeguards and no-money parallel employer payroll | Authorized safe environment, independent centavo reconciliation |
| 4 | Gusto-style first-payroll preview and readiness improvements | Approved complex-input canonical dry-run and browser acceptance |
| 5 | BambooHR-style daily HR simplification | Observed lower friction, reliable leave/onboarding/approval |
| 6 | Deel-style Employee 360 consolidation | Scoped one-profile workflow, no second master |
| 7 | HiBob-style compensation worksheet | Budgeted, governed, payroll-effective review |
| 8 | UKG / Workday operational depth | Tested forecasting, performance, identity and process governance |

## Acceptance gates — do not conflate these

### Gate A — Internal development and usability testing

- [ ] Exact-SHA core workflows, payroll golden calculations, CodeQL/security, migration integrity and relevant UI tests pass.
- [ ] Genuine users/witnesses execute fictional employer tasks on real desktop and phone.
- [ ] All critical usability/authorization defects corrected and independently retested.
- [ ] Retain private evidence and a recorded scope decision. **No money; no real employee PII required.**

### Gate B — Controlled real-employer no-money pilot

- [ ] Real employer consent, authorized scope, secure isolated runtime/data access, encryption, DBA and recovery requirements satisfied.
- [ ] Independent payroll officer and checker reconcile one historical completed period worker-by-worker, with no unexplained difference greater than PHP 0.01.
- [ ] Owner reviews actual evidence and explicitly approves the restricted pilot.
- [ ] Bank and agency transfers/submissions remain **disabled** unless separately approved for later testing.

### Gate C — Broader commercial launch

- [ ] Multiple independently reconciled parallel payroll periods meet the agreed acceptance criteria.
- [ ] Required actual bank-file/provider, BIR, SSS, PhilHealth and Pag-IBIG workflow evidence is retained with exact-version receipts.
- [ ] Production audit, recovery, data governance, email, billing, support and security requirements are satisfied.
- [ ] Authorized release owner signs off the exact production build and supported-feature scope.

## Maintenance instructions

1. Keep **closed implementation** separate from **closed operational acceptance**. Reference PRs and exact SHAs, but do not check a human or agency acceptance item based on source merge.
2. For each unchecked item, attach its owner, issue link, exact tested build, expected/observed outcome, PASS/NEEDS_FIX/NOT_RUN and sanitized evidence reference to the appropriate linked issue.
3. Mark a box complete only with accepted proof; record the decision date and scope in its issue. Keep salaries, personally identifying information, bank data, credentials, raw screenshots and private reviewer evidence **out of GitHub**.
4. Reassess priority after each pilot milestone; avoid large simultaneous rewrites or new financial-action paths.
5. Competitor names identify useful experience benchmarks. This document does not claim feature-for-feature equivalence or copy proprietary UI.

**Related repository references:** [Enterprise Payroll/WFM/HCM Roadmap](https://github.com/erwinmehehe/payrollph/issues/194), [HCM parity roadmap](HCM_PARITY_ROADMAP.md), [WFM competitor gap audit](wfm-rippling-deputy-ukg-gap-audit.md), [First employer acceptance](qa/first-employer-journey-execution.md), [Release/DBA master tracker](https://github.com/erwinmehehe/payrollph/issues/744).
