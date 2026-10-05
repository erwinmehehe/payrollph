# Linaw HCM parity roadmap

Updated: 2026-10-05

## Product direction

Linaw already has a strong Philippine payroll and workforce foundation. The goal is not to imitate another HCM screen-for-screen. The goal is to connect the worker record, organization structure, time, payroll, recruiting, talent, compensation, and planning so data moves once through the employee lifecycle.

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
- Expenses, benefits, loans, earned wage and company assets.
- Onboarding/offboarding provisioning.
- Separation/final-pay workflow.
- Multi-client bookkeeper mode, multi-branch/org-unit model and scoped RBAC.
- API keys, signed webhooks, audit trail and data-privacy workflows.
- Labor costing/cost-center allocation.
- Payroll assurance, maker-checker controls, exports and filing evidence.

## Tranche 1 — Performance foundation

Status: implemented on `feat/hcm-performance-foundation`.

- Performance cycles
- Employee goals with weight, due date, progress and status
- Formal manager reviews with 1–5 scoring and narrative
- Tenant and org-unit scoping
- Audit events
- Workspace page for HR/managers
- Migration + baseline schema + regression tests

Next improvements inside this module:
- Employee self-assessment
- Goal hierarchy / cascading company -> team -> employee
- Competency/KRA templates
- Calibration sessions
- Continuous feedback / 1:1 notes
- Review reminders and completion analytics
- Explicit separation between performance data and compensation decisions

## Tranche 2 — Job architecture and position control

Status: implemented on `feat/hcm-position-planning`.

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

Foundation implemented on `feat/hcm-compensation-management`.

Built:
- Salary bands by job profile and location/org-unit, with company-wide fallback
- Minimum / midpoint / maximum monthly PHP ranges
- Compa-ratio against band midpoint
- Compensation review cycles with effective date and annualized increase budget
- Org-unit manager budget pools that cannot exceed the parent cycle budget
- Merit, promotion, market, equity, retention and other recommendation types
- Latest completed performance score surfaced as context, never as an automatic pay rule
- Four-eyes approval: proposer cannot approve or apply their own recommendation
- Missing-band and out-of-range approvals require an explicit exception reason
- Stale-pay detection before applying an approved recommendation
- Approved changes create the existing effective-dated `employee_pay_revisions` record and update the active pay profile
- Future-dated approved changes cannot be applied early
- Historical application fails closed when released payroll would require retro reconciliation
- Audit events for bands, cycles, pools, recommendations, approval and payroll application

Remaining:
- Bonus / variable-pay pools and award types
- Bulk cycle approval and scheduled effective-date application
- Automated retro-pay reconciliation for a missed effective date
- Pay-equity analytics with minimum cohort/privacy thresholds
- Compensation statements / employee letters
- Market benchmark imports

Guardrail: performance scores may inform a cycle, but no automatic salary change happens without explicit compensation approval and payroll application.

## Tranche 5 — Learning, skills and career

- Skills catalogue and employee skill profile
- Role competency requirements
- Development plans linked to performance reviews
- Courses, sessions, enrolments and completion evidence
- Certifications with expiry reminders
- Career paths and readiness gaps
- Internal mobility candidates

## Tranche 6 — Engagement

- Pulse and lifecycle surveys
- eNPS
- Anonymous response mode
- Team-level thresholds to avoid deanonymization
- Action plans tied to survey findings
- Recognition / feedback stream

## Tranche 7 — Recruitment maturity

Position-to-requisition and candidate-to-employee handoff foundation implemented on `feat/hcm-recruiting-lifecycle`.

Built:
- Approved/open position -> requisition without re-keying title, org unit, manager, employment type, target date or salary budget
- One active requisition per planned position
- Offer amount captured before hire
- Candidate hire -> employee record + pay profile + position assignment + onboarding checklist in one transaction
- Candidate and requisition retain employee/position lineage
- Filled state cannot be reached by a cosmetic candidate-stage change

Remaining:
- Hiring stages configurable per requisition
- Interview panels, scorecards and scheduling
- Candidate source and referral tracking
- Offer approval and document generation
- Position/headcount linkage
- Hire action converts candidate -> employee without re-keying
- Talent pool and candidate deduplication
- Careers page / job board publishing integrations

## Tranche 8 — Enterprise identity and automation

- OIDC first, then SAML if customer demand requires it
- SCIM provisioning/deprovisioning
- Custom roles/permission sets
- Approval workflow builder
- Event/rule automation
- IP/session policies
- Security audit views

## Tranche 9 — Analytics and AI layer

Only after clean data models:
- Workforce KPIs and trend dashboards
- Attrition, hiring funnel and time-to-fill
- Performance distribution and goal attainment
- Span of control, manager load and position vacancy
- Labor-cost forecast vs actual
- Natural-language reporting with strict tenant/RBAC enforcement
- Explainable payroll/compliance assistant using existing payroll trace data

## Priority order

1. Performance foundation — now built
2. Job architecture + positions
3. Workforce/headcount planning
4. Recruitment-to-position handoff — implemented foundation
5. Compensation bands + review cycles — implemented foundation
6. Learning/skills/career
7. SSO/OIDC + SCIM
8. Engagement/surveys
9. Broader analytics/AI

This order creates a connected HCM data model instead of accumulating isolated modules.
