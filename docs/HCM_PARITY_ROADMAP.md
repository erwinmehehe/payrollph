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

Next improvements inside this module:
- Competency libraries linked more deeply to job-profile skill requirements
- Calibration distribution outlier flags and configurable review-distribution policies
- Employee contribution to upcoming 1:1 agendas

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

Foundation implemented with planning windows, plan budgets, position-level budgets, statuses, and effective-dated incumbents. Remaining:

- Annual/quarterly workforce plan versioning
- Requested vs approved vs filled headcount
- Scenario planning
- Fully loaded cost forecast using Linaw payroll/benefit data
- Approval workflow across HR + Finance + hiring manager
- Convert approved position into recruitment requisition
- Budget variance by org unit and cost center
- Attrition/backfill planning

This should become a differentiator because Linaw can use actual Philippine payroll burden and employer contribution data instead of generic salary-only planning.

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
