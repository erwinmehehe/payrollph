# Linaw HCM parity roadmap

Updated: 2026-10-07

## Product direction

Linaw already has a strong Philippine payroll and workforce foundation. The goal is not to imitate another HCM suite screen-for-screen. The product direction is enterprise Philippine payroll, workforce control, compliance evidence, compensation, identity and decision-grade analytics. New modules must strengthen that core instead of widening the product into unrelated HR categories.

Public product research used for the roadmap:
- Frappe HR: recruitment/staffing plans, employee lifecycle, goals and appraisal cycles.
- Deel: connected worker profile, workforce planning -> ATS -> onboarding, performance/goals/learning/surveys, compensation bands/review cycles, device lifecycle and access management.
- HiBob: job/level/site compensation bands, budgeted compensation cycles and connected HCM planning.
- Open-source implementation references inspected: frappe/hrms, orangehrm/orangehrm, horilla/horilla-hr. Their code is reference-only; Linaw implementation remains original.

## Current Linaw strengths

- Philippine payroll engine: SSS, PhilHealth, Pag-IBIG, TRAIN, MWE, holiday/rest-day/night differential.
- Effective-dated pay and schedules.
- Workforce scheduling, schedule swaps, overtime approval and attendance exceptions.
- Leave policies and payroll treatment.
- Recruitment requisitions and candidate pipeline.
- Expenses, benefits, loans, existing earned-wage functionality and company assets. Existing earned-wage functionality is maintenance scope, not a roadmap expansion area.
- Onboarding/offboarding provisioning.
- Separation/final-pay workflow.
- Multi-client bookkeeper mode, multi-branch/org-unit model and scoped RBAC.
- API keys, signed webhooks, audit trail and data-privacy workflows.
- Labor costing/cost-center allocation.
- Payroll assurance, maker-checker controls, exports and filing evidence.

## Tranche 1 — Performance foundation

Status: expanded through employee self-assessment, structured performance governance and calibration.

Built:
- Performance cycles
- Employee goals with weight, due date, progress and status
- Formal manager reviews with 1–5 scoring and narrative
- Employee self-assessment and reflection in self-service
- Company -> team -> employee goal hierarchy with governed parent alignment
- Reusable competency/KRA templates with cycle-specific weighting and required-item rules
- Structured employee and manager ratings/comments per competency/KRA
- Review-completion controls for required self-assessment, manager narrative and structured evidence
- Review-structure freeze after the first completed review
- Company-wide People-admin calibration sessions after manager review completion
- Written rationale required for changed calibrated ratings
- Optional required calibration before cycle closure
- Finalized calibration updates only the performance final rating
- Performance data remains explicitly separated from compensation actions
- Tenant and org-unit scoping
- Audit events
- Workspace page for HR/managers plus employee self-service
- Migration + baseline schema + regression tests

Additional performance capabilities built:
- Continuous manager 1:1 records with employee-shared agenda/summary and separately restricted manager-private notes
- Append-only praise, coaching, development and general feedback with explicit employee-shared vs manager-private visibility
- Optional linkage of continuous feedback to governed company/team/employee goals
- Scheduler-backed self-assessment and manager-review reminders at 7/3/1-day, due and overdue stages
- Durable reminder tasks/events with deduplicated email delivery, automatic resolution, and People-admin fallback when ownership is missing
- Completion analytics by manager and org unit
- Rating distribution, goal-attainment, 1:1 coverage, reminder backlog and calibration-change analytics
- Employee self-service history for shared 1:1 and feedback evidence

Additional job-architecture and calibration governance built:
- Performance competency templates can map directly to governed HCM skills
- Job profiles define mandatory/optional skills and expected proficiency from 1–5
- Review opening validates mandatory job-skill coverage against the selected cycle
- Job-profile-specific templates apply only to employees in that profile; reusable skill competencies can remain global
- Review items snapshot job profile, skill, expected proficiency, required status and weight so later architecture edits do not rewrite historical review evidence
- Manager and employee review views surface role proficiency expectations and scored gaps
- Analytics surface job-linked competency items below role expectation
- Versioned calibration-distribution policy with configurable minimum sample, manager-mean deviation, high/low rating concentration and large-score-change thresholds
- Calibration sessions freeze the policy version/snapshot used when the session opened
- Durable manager-distribution and large-score-change flags require explicit resolution/acceptance when policy requires it
- Closed large-score-change flags reopen if the underlying calibration delta materially changes
- Calibration flag backlog and resolution status are included in performance analytics

Additional continuity, inheritance, and trend capabilities built:
- Employees can contribute append-only agenda items to their own scheduled 1:1s from self-service
- Employee agenda contributions remain separate from the manager-authored agenda and manager-private notes
- Family-, level-, and family+level competency expectation defaults reduce repeated job-profile setup
- Deterministic expectation precedence: profile override -> family+level -> level -> family
- Review items snapshot expectation source/rule provenance so later default changes do not rewrite historical review evidence
- People-admin coverage views include inherited competency counts and inherited mandatory-skill gaps
- Completed-cycle trend analytics show review completion, final/self/manager rating averages, goal attainment, and role-expectation gap rates
- Trend deltas compare each completed cycle with the previous completed cycle inside the viewer's existing authorization scope
- Performance trends remain explicitly separated from compensation and payroll mutation

Additional performance follow-through and evidence capabilities built:
- Governed 1:1 action items with employee/manager ownership, due dates, status, employee-shared vs manager-private visibility, completion metadata and immutable event history
- Employees can progress/complete only their own employee-visible action items from self-service; managers/People admins retain governed cancel/reopen controls with written rationale
- Overdue action items are surfaced in employee and manager workspaces without silently mutating meeting or review status
- Skill-level trend analytics aggregate completed, scoped review evidence across cycles
- Persistent competency gaps are identified only when the average scored proficiency remains below the frozen role expectation for at least two consecutive completed cycles
- People admins can export an MFA-gated, rate-limited, audited employee performance evidence package for all cycles or one selected cycle
- Evidence packages include section-level SHA-256 hashes and an overall evidence hash
- Evidence exports exclude manager-private 1:1 notes, manager-private feedback, manager-private action items, compensation/payroll records and sensitive identifiers

Additional performance follow-through automation built:
- Configurable 1:1 action-item reminder policy with upcoming, due, overdue and escalated stages
- Durable action reminder tasks/events with deduplicated delivery, automatic resolution, manager notification for employee-owned commitments and company-wide People-admin escalation
- Persistent skill-gap development plans can only be opened when stored review evidence shows at least two consecutive completed cycles below the frozen role expectation
- Development plans include target proficiency, target date, milestones, manager governance, employee visibility and append-only employee progress evidence
- Employees can progress visible milestones and post development updates without access to manager-only cancel/reopen or evidence-trigger controls
- Versioned performance-evidence retention policy with configurable retention years, automatic completed-cycle sealing and post-seal amendment rules
- Completed-cycle seals freeze policy version/snapshot plus a cycle-wide manifest of privacy-scoped employee evidence hashes
- Scheduled automatic sealing runs through the existing performance scheduler path
- Seal verification recomputes current evidence and records match/mismatch status
- Legal holds preserve sealed evidence beyond ordinary retention handling
- Post-seal corrections are append-only, tamper-evident amendments chained from the original manifest hash
- Employee evidence exports report whether the selected package still matches its completed-cycle seal

Performance is now sufficiently deep for the current HCM target. Shift the next major build tranche to Workforce Planning 2.0 rather than continuing to expand performance.

Next major HCM module:
- Workforce Planning 2.0: plan versioning, requested/approved/filled headcount, scenarios, loaded labor-cost forecasts, HR/Finance approvals, approved-position to requisition handoff, variance and attrition/backfill planning

## Tranche 2 — Job architecture and position control

Status: implemented on `feat/hcm-position-planning-clean`.

Built:
- Job families, job profiles, levels/grades, skills and competencies
- Position records separate from employee records
- Position status: planned / approved / open / filled / frozen / closed
- Position budget and target start date
- Org-unit, cost-center and manager ownership
- Effective-dated employee-to-position assignments
- Vacancy created automatically when an occupied position becomes open

Why: Deel connects workforce planning to ATS; Frappe validates openings against staffing plans. Linaw currently has requisitions but no authoritative position/headcount ledger.

## Tranche 3 — Workforce and headcount planning

Status: Published Headcount Plans are implemented. Workforce Planning 2.0 remains in progress.

Built:
- Governed planning windows and plan budgets
- Position-level budgets, statuses, org-unit/cost-center ownership and effective-dated incumbents
- Requested vs approved vs filled headcount and FTE evidence
- Driver-based staffing scenarios with demand growth, vacancy-fill and employer-load assumptions
- Immutable scenario snapshots with SHA-256 evidence hashes
- Maker-checker scenario submission and approval
- Configurable multi-step workforce-plan business process using the shared approval engine
- Role-based approval routing for HR, Finance, manager/admin and owner roles while preserving named approvers and delegation
- Incremental annual labor-cost thresholds for approval escalation, with policy/version/step snapshots frozen at submission
- Final scenario approval/rejection occurs only when the shared approval chain reaches a terminal decision; no inline bypass exists
- A currently published plan remains authoritative while a replacement scenario is submitted, approved or rejected, until the replacement is explicitly published
- Fully loaded labor-cost forecasting using payroll pay profiles, employer statutory burden, employer-paid benefits and recurring compensation
- Role-demand and capacity-gap forecasting tied to WFM staffing requirements
- Plan-authorized demand handoff into WFM
- Approved/open/filled position to requisition handoff
- Company-wide approved scenario -> published headcount-plan baseline
- Versioned published baselines with publisher identity, hash, supersession history and plan status
- Continuous baseline vs live requested/approved/filled headcount, FTE, vacancy and position-budget reconciliation
- Cost redaction for workforce roles without payroll-cost permission
- Published and approved plans remain executable in downstream WFM demand handoff
- New draft forecast revisions can be seeded from the current published baseline plus current authoritative headcount/position actuals, with baseline hash/version provenance preserved and live payroll-grounded forecast recalculated
- Plan owners can set org-unit headcount and annual-budget allocations; managers can create versioned bottom-up requests within those ceilings, with maker-checker decisions and accepted-version supersession
- Published baselines reconcile named organization-unit and cost-center headcount/FTE/position-budget evidence against the live ledger, with payroll-cost redaction preserved
- Governed scenarios support annual attrition and backfill assumptions, role-level expected exits/backfills, ending headcount, capacity loss/recovery and payroll-grounded backfill cost evidence; assumptions are hashed, approved and carried into published baselines/revisions without mutating employment or positions
- Published baselines freeze exact executable position specifications; company-wide People admins can create immutable execution previews and explicitly apply only baseline-authorized create/restore/approve actions after MFA, rate limiting, live-state rehashing, lifecycle checks and database locks, without creating requisitions, incumbents or payroll changes

Remaining:

This should remain a differentiator because Linaw can use actual Philippine payroll burden and employer contribution data instead of generic salary-only planning.

## Tranche 4 — Compensation management

- Salary bands by job profile + level + location
- Compa-ratio and range penetration
- Compensation review cycles
- Merit, promotion, market adjustment and bonus recommendations
- Budget pools and manager allocations
- Approval workflow and audit trail
- Approved compensation change creates an effective-dated pay revision
- Pay-equity reporting with privacy controls

Guardrail: performance scores may inform a cycle, but no automatic salary change should happen without an explicit compensation approval.

## Tranche 5 — Recruitment handoff only

Recruitment work stays narrow and connected to approved workforce demand:

- Approved position -> requisition
- Candidate -> offer -> employee without re-keying
- Position/headcount linkage
- Interview evidence and offer approval where required for the handoff
- No broad ATS integration marketplace or standalone recruiting-suite expansion

## Explicit non-goals

Do not expand Linaw into these categories as part of the Sprout parity effort:

- Mental wellness or employee-wellness marketplace products
- Rewards/recognition platforms
- Salary advances or broader earned-wage-access expansion
- LMS/course catalogues or learning-suite expansion
- Engagement or pulse-survey products
- Broad ATS integration ecosystems
- Succession-management suites
- Generic AI HR agents
- Time-and-billing products
- Marketplace products

Existing functionality in adjacent areas may be maintained for customers, but it is not a strategic expansion priority.

## Tranche 8 — Enterprise identity and automation

- OIDC first, then SAML if customer demand requires it
- SCIM provisioning/deprovisioning
- Custom roles/permission sets
- Approval workflow builder
- Event/rule automation
- IP/session policies
- Security audit views

## Tranche 9 — Payroll and workforce intelligence

Only after clean data models:
- Workforce KPIs and trend dashboards
- Attrition, hiring funnel and time-to-fill
- Performance distribution and goal attainment
- Span of control, manager load and position vacancy
- Labor-cost forecast vs actual
- Payroll assurance, variance, release-blocker and compliance-exposure analytics grounded in stored payroll evidence
- Labor-cost, headcount, position vacancy and compensation analytics with strict tenant/RBAC enforcement
- No generic AI HR agent. Any future natural-language interface must only expose deterministic, source-grounded payroll/compliance evidence and must not become a standalone HR assistant.

## Priority order

1. Payroll compliance, remittance integrity and government-output evidence
2. Advanced workforce controls tied directly to payroll
3. Position/headcount planning
4. Governed compensation bands and review cycles
5. Recruitment-to-approved-position handoff
6. Enterprise SSO/OIDC, SCIM, MFA and permission controls
7. Payroll assurance, variance and labor-cost analytics
8. External validation: agency acceptance, bank UAT, production payroll reconciliation and security assurance
9. Customer implementation, managed-payroll operations and production proof

This order deliberately keeps Linaw focused on enterprise Philippine payroll and workforce assurance instead of accumulating disconnected HR modules.
