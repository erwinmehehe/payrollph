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

Foundation implemented on `feat/hcm-learning-skills-career`.

Built:
- Organization skill catalog with categories and descriptions
- Five-level proficiency model
- Job-profile competency requirements with critical-skill flags
- Verified employee skill profiles with evidence source and verifier
- Development plans optionally linked to the employee's completed performance review
- Development activities for training, mentoring, projects, coaching, certifications and reading
- Learning course catalog with provider and delivery mode
- Course-to-skill mapping with verified proficiency awarded only after recorded completion
- Learning assignments that can link back to a development-plan activity
- Course completion can automatically close its development activity and completed plans
- Certificate-generating courses with validity/expiry dates
- External certification recording and expiry tracking
- Internal-mobility readiness calculated from verified proficiency against target job-profile requirements
- Critical requirements receive additional readiness weight and are surfaced as explicit gaps
- Tenant/org-unit RBAC and audit events across talent-development mutations

Remaining:
- Employee self-assessment with manager verification queue
- Learning sessions, attendance, instructors and cohort capacity
- Content/LMS integrations and SCORM/xAPI support
- Formal career-path sequences between job profiles
- Mentorship matching and recurring 1:1 development check-ins
- Certification renewal workflows and reminder automation
- Skills inference from work history only with explicit human verification
- Internal opportunity marketplace / talent marketplace

## Tranche 6 — Engagement

Foundation implemented on `feat/hcm-engagement-listening`.

Built:
- Pulse, eNPS, onboarding, exit, lifecycle and custom survey types
- Draft -> open -> closed survey lifecycle
- Company-wide or org-unit audiences
- Anonymous or explicitly identified response mode
- Anonymous respondent deduplication through a keyed HMAC token; user/employee IDs are not stored with anonymous responses
- Minimum privacy threshold of 5, configurable upward to 50
- Anonymous surveys cannot open when the eligible audience is smaller than the privacy threshold
- Analytics suppress scores, optional-answer counts and comments until the threshold is met
- Raw anonymous comments are never returned by the management analytics endpoint
- Team/org-unit breakdowns are individually threshold-gated
- eNPS promoter/passive/detractor classification and score
- Employee self-service "My voice" survey experience
- Engagement action plans tied to survey or question findings with owner, org unit, due date and status
- Peer recognition feed available from employee self-service
- Manager continuous feedback stream kept separate from formal performance scoring
- Tenant/org-unit RBAC and audit events for survey administration, action planning, feedback and recognition
- Anonymous survey submissions intentionally do not create actor/timestamp audit records that could weaken anonymity

Remaining:
- Recurring survey schedules and automated invitations/reminders
- Benchmarking across historical survey waves
- Employee-visible action-plan follow-through / "you said, we did"
- Survey templates and question library
- Recognition values taxonomy and moderation controls
- Feedback requests / 360 feedback with recipient workflow
- Privacy-safe demographic slicing with k-anonymity across multiple dimensions
- Sentiment/theme summarization only after privacy thresholds and with no raw anonymous identity inference

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

Foundation implemented on `feat/hcm-enterprise-identity-automation`.

Built:
- OIDC authorization-code sign-in with PKCE, nonce/state replay protection and RS256/JWKS signature verification
- SSRF-safe OIDC discovery, token exchange and JWKS retrieval with DNS validation and pinned public IPs
- Encrypted OIDC client secrets and login code verifiers via `ENTERPRISE_IDENTITY_ENCRYPTION_KEY`
- Verified company email domains using one-time DNS TXT proof
- Existing-account-only SSO linking; no unsafe just-in-time privilege creation
- SSO-required workspace mode with administrator lockout protection
- Optional organization MFA policy; OIDC MFA must be explicitly asserted by the upstream provider
- Session idle timeout, absolute lifetime and concurrent-session controls applied to existing and new sessions
- SCIM 2.0-style Users list/provision/update/deactivate endpoints with hashed bearer tokens
- SCIM deprovisioning disables only the target workspace membership, preserving multi-company access
- Safe SCIM role allowlist that cannot provision owner/admin/bookkeeper privileges
- Custom permission sets as deny-only overlays on existing role gates; they never elevate the base role
- Joiner/mover/leaver automation rules with org-unit/employment/title conditions
- Idempotent lifecycle execution history and failure isolation
- Supported actions: create provisioning task, assign course, send webhook, and revoke sessions on separation
- Joiner automation connected to recruited and manually created employees
- Mover automation connected to governed effective-dated position transfers
- Leaver automation connected to final-pay release and employee separation
- Enterprise workspace for security policy, OIDC, SCIM, permission restrictions and lifecycle rules
- Audit events across identity, provisioning, permission and automation administration

Remaining:
- SAML 2.0 if customer demand justifies it
- OIDC algorithms/providers beyond the current RS256 foundation
- SCIM Groups / group-to-permission-set mapping
- More complete SCIM PATCH filter/value-path coverage
- Scheduled future-dated position transfers and mover actions
- General no-code approval workflow builder beyond lifecycle rules
- IP allowlists / trusted-network policy
- Security event dashboards and anomaly detection
- Break-glass recovery identities and formal access-review campaigns

## Tranche 9 — Advanced HCM analytics

Foundation implemented on `feat/hcm-advanced-analytics`.

Built:
- Connected executive HCM metrics across headcount, recruiting, positions, performance, compensation, mobility, payroll cost and engagement
- Reconstructed 12-month headcount trend from employee start dates and released separation records
- YTD hires, released separations, net growth and turnover using average opening/current reconstructed headcount
- Recruiting funnel and average/median time-to-fill from requisition creation to recorded hire timestamp
- Position-status mix, open vacancy rate and manager span-of-control distribution
- Completed performance score distribution and cycle trends with minimum cohort suppression
- Salary-band coverage, average compa-ratio and below/in/above-band aggregates with independent small-bucket suppression
- Evidence-based internal mobility readiness reused from the Learning & Career calculation; 80%+ readiness still requires no critical skill gaps
- Verified-skill coverage and privacy-safe target-role readiness counts
- Released payroll actuals with employer statutory cost read from immutable payroll trace
- Annualized loaded payroll forecast plus current employer-benefit run rate
- Position salary-budget comparison and active workforce-plan context
- Privacy-safe engagement trend using the survey-specific anonymity threshold; no raw anonymous comments
- Org-unit scoped analytics for managers/HR while legacy payroll CSV reports remain company-wide
- Bookkeeper access deliberately excluded from talent/listening analytics
- Shared calculation primitives and regression coverage for privacy, cost trace and career-readiness consistency

Remaining:
- Effective-dated org-unit snapshots on payroll entries so historical unit cost survives employee transfers
- Goal-attainment trend and calibration analytics
- Recruiting source/referral attribution and stage-duration analytics
- Fully versioned workforce scenarios and forecast-vs-actual headcount
- Pay-equity analytics once protected demographic dimensions and legal/privacy policy are explicitly defined
- Scheduled analytics snapshots for longitudinal benchmarking at very large scale
- Natural-language HCM reporting only after the aggregate metric layer is stable and permission-aware
- Predictive attrition or other ML only with documented model governance, explainability and human review

Guardrail: analytics do not manufacture missing history. Where Linaw lacks a historical snapshot (for example org-unit ownership on old payroll entries), the UI states the limitation rather than presenting an inferred fact as authoritative.

## Priority order

1. Performance foundation — now built
2. Job architecture + positions
3. Workforce/headcount planning
4. Recruitment-to-position handoff — implemented foundation
5. Compensation bands + review cycles — implemented foundation
6. Learning/skills/career — implemented foundation
7. SSO/OIDC + SCIM — implemented foundation
8. Engagement/surveys — implemented foundation
9. Advanced HCM analytics — implemented foundation

This order creates a connected HCM data model instead of accumulating isolated modules.
