# Linaw / Payroll PH: Philippine People Operating System

Status: Product north star and sequencing proposal — 2026-10-09.
This document establishes strategic direction, **not a claim that every capability is production-ready**.
Code-complete, CI-proven, pilot-proven and externally accepted remain separate states.

## Positioning

**All-in-one Payroll, HRIS, Workforce Management and HCM automation built for the Philippines.**

Our benchmark is the connected employee-data and workflow experience of an enterprise people platform such as Rippling, not a screen-by-screen imitation. Philippine payroll and labor rules are the primary differentiator.

## Four first-class pillars

| Pillar | Authoritative responsibilities | Outcomes |
| --- | --- | --- |
| Payroll | Pay policy and effective dates, statutory contributions/tax, 13th month, final pay, release, payout, remittance reconciliation | Correct and provable pay |
| HRIS | Person/worker master record, employment lifecycle, organization/manager relationships, leave, documents, permissions, self-service | One employee source of truth |
| WFM | Demand, assignments, eligibility, schedules, attendance, overtime, exceptions, timesheets, coverage, labor cost | Governed work-to-pay evidence |
| HCM | Jobs, positions, skills, performance, headcount plans, recruitment-to-position, compensation budgets and cycles | Governed people development and planning |

Each pillar must work independently for its authorized user but share the same employee and organization references, effective dates, approvals, and audit trail.

## One employee, one connected lifecycle

1. **Hire approved** → create the governed HRIS identity, job and position assignment, manager/worksite eligibility, initial pay setup and onboarding checklist; do not create bank instructions or activate payroll silently.
2. **Roster assigned** → verify employment state, site authorization, capabilities, rest/leave conflicts and budget policy. Keep the assigned schedule immutable as historical evidence through effective dating.
3. **Time captured** → preserve raw device/app punches, integrity evidence and clock source; derive exceptions, premium context and the appropriate manager review.
4. **Leave or OT approved** → update coverage projections and payroll treatment through explicit handoffs; actual performed work is never erased merely because authorization was missing.
5. **Payroll prepared** → reconcile approved timesheet snapshots, historical pay terms, taxes/statutory obligations, attendance exceptions and employer-loaded cost; checker and release are separate powers.
6. **Promotion, transfer or compensation change** → preview downstream HRIS/WFM/payroll/position impacts, approve with correct maker-checker controls, apply as effective-dated revisions and preserve prior releases.
7. **Separation** → govern final pay, revoke access, recover assets and settle open work through evidence-backed workflows; no automatic irreversible transfer.

## Shared operating system services

- **Identity**: OIDC first, SAML/SCIM on enterprise demand; MFA for sensitive access; device and session policy.
- **Automation**: Events and policy rules; reliable outbox and retries; deduplication; no hidden mutation of monetary results.
- **Approvals**: Named actor, role, delegation, scope, policy version, explicit consent/acknowledgement where required and escalation.
- **Evidence**: Audit trail, immutable snapshots, replayable calculations, sourced analytics and protected export.
- **Self-service**: Mobile-friendly schedule, shift swap, leave, attendance correction, employee profile, reviews and payslip.
- **IT lifecycle**: Identity provisioning/deprovisioning, role groups, app access and employee asset assignment linked to HRIS lifecycle. Full IT endpoint-management/RMM is *not* required for early parity.
- **Integration**: Versioned webhooks and API, external biometric attendance adapters and bank/government acceptance with external evidence.

## Build sequencing and merge constraints

### P0 — Accuracy and platform safety
- Independently reconcile at least 50 Philippine payroll golden cases and statutory boundary versions.
- Preserve WFM break, overnight, premium and rest-day evidence without silent rounding or inferred attendance.
- Harden permission scopes, historical locks, replay, release receipts and failures/retries.
- Keep PRs #675, #676, #677 and #681 independently reviewed before integration; overlapping work requires an explicit integration plan.
- Do not claim hardware, bank or government acceptance without real external certification.

### P1 — Integrated manager operations
- Paginated weekly multi-employee roster, employee search and safe governed day changes (team-roster PR).
- Consolidate coverage gaps, no-shows, replacement recommendations and payroll cut-off readiness into a manager worklist.
- Make open shifts, swap approvals and schedule publishing a consistent lifecycle with status and notifications.
- Enhance reusable templates, bulk preview, fair rotation, skills/availability checks, cost-aware scheduling and employee mobile flows.

### P2 — HRIS workflow excellence
- One employee profile and effective-dated job, manager, worksite and pay changes.
- Employee and manager self-service for leave, documents, correction requests, tasks and notifications.
- Reliable onboarding/offboarding with scoped provisioning and revocation evidence.
- Dynamic groups backed by explicit authorization/approval binding and explainable change impact.

### P3 — HCM and workforce planning
- Position-based headcount ledger, forecast scenarios and approved requisition handoffs.
- Performance cycles, calibrated reviews, governed development plans and role skills.
- Compensation bands, merit cycles, pay-equity/privacy reporting and approval-to-effective-dated-pay changes.
- Continuous reconciliation of approved headcount, actual labor cost, vacancy and payroll forecast.
- Learning workflows only when they demonstrably support governed skills/capability outcomes, not a generic course marketplace.

### P4 — Enterprise trust and connected automation
- SSO/SCIM, granular permission sets, controlled approval builder and governed cross-pillar automation.
- First-party mobile-quality workflows and certified attendance/bank integrations where economically justified.
- Accessibility, Philippine mobile network conditions, large-tenant performance, incident response, backup/restore and compliance evidence.
- Broader IT integrations as lifecycle automation; avoid a disconnected competing IT RMM product.

## Quality bar

- Payroll: zero unresolved critical calculation/release defects, independently reconciled representative runs and signed-off pilot evidence.
- Security: zero successful cross-tenant access in authorization tests; role-specific positive and negative cases.
- WFM: a manager can resolve a staffing gap and trace the result to time, timesheet, and payroll review without manual re-keying.
- HRIS: worker lifecycle events propagate only through approved, effective-dated, auditable downstream actions.
- HCM: a compensation recommendation never changes pay without a correctly authorized decision.
- Reliability: replay, idempotency, rollback, provider-failure recovery and provenance all demonstrated before launch claims.
- Experience: mobile-usable critical tasks; accessibility, bounded pagination and explainable alerts.
- Performance: operational load testing against realistic synthetic Philippine multi-site organizations.

## Immediate engineering delivery

The first slice is a read-only, scoped team roster with optional, explicitly acknowledged day changes that reuse the existing secured override endpoint. It is deliberately **not** auto-publishing, auto-approving pay, or pretending the absence of a schedule means an employee rests.

This creates a reliable surface on which to place multi-day draft publishing, coverage recovery, swap decisions, labor-cost previews and manager triage after the related open WFM branches complete their independent reviews.

## Proof vocabulary

- **Implemented**: source code and tests exist.
- **Verified**: exact-head checks and reviewed scenarios pass.
- **Pilot-ready**: staged representative workflows, security and rollback proven.
- **Production-proven**: real authorized employer pilot, independently reconciled payroll, accepted integrations and operational sign-offs completed.
- **Generally available**: repeatable onboarding/support and release discipline demonstrated for the advertised capability.

No marketing claim should collapse these distinctions.
