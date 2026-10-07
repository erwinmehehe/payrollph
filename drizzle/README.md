# Database schema

Nothing in the app creates its own tables, so a fresh database needs the schema
applied before the first request. There are three files here and they are not a
single ordered sequence, so read this before running anything.

## A fresh database

```
DATABASE_URL="postgresql://..." npm run db:push
```

`db:push` reads `src/db/schema.ts` and creates everything it finds there, which
is the whole current schema. **Check that it actually created tables**: push has
been seen to report success and create nothing against a non-standard Postgres.
Expect 167 tables. If it creates nothing, apply `baseline.sql` instead, which is
the same schema as plain SQL and can be pasted into the Neon or Supabase SQL
editor without any tooling.

## The files

- `baseline.sql` is the complete current schema, 167 tables, generated from
  `src/db/schema.ts`. It is deliberately unnumbered: it is a starting point for
  an empty database, not the next step in the numbered sequence below.
- `0001_payroll_periods_rbac.sql` and `0002_final_pay_reconciliation.sql` are
  historical increments from before the baseline existed. Their changes are
  already folded into `baseline.sql`, so applying them on top of it will fail on
  objects that already exist. They are kept for the history of a database that
  was migrated step by step.

There is no `meta/_journal.json`, so `drizzle-kit migrate` is not the workflow
here. Use `db:push` for schema changes, and `npm run db:generate` if you want to
review the SQL a schema change would produce before applying it.

## First account

Once the schema exists, visit `/setup` to create the owner account. That route
only works while the instance has no users; `POST /api/setup` returns 409 after
the first one, so it closes itself.

- `0021_performance_management.sql` adds the HCM performance foundation: cycles, employee goals, and formal reviews.

- `0022_job_architecture_positions.sql` adds job profiles, workforce plans, positions, and effective-dated position assignments.


- `0043_recruitment_position_handoff.sql` connects approved positions to requisitions and records the employee created by a governed hire conversion. `0024` is reserved by the compensation-governance tranche.

- `0042_compensation_governance.sql` adds salary bands, compensation review cycles and governed pay-change proposals.

- `0045_multi_legal_entities.sql` adds parent-workspace legal employers, entity registrations/payout policy, and legal-entity ownership on employees and payroll runs.

- `0046_wfm_staffing_scenarios.sql` adds immutable WFM staffing scenario snapshots with scoped manager submission/approval evidence.

- `0047_overtime_budget_controls.sql` adds monthly department/manager OT-minute budgets with advisory or blocking authorization controls.

- `0049_automation_studio_v2.sql` adds durable Automation Studio workflow state for resumable waits, approval gates and scheduler-driven continuation.

- `0049_wfm_role_demand.sql` adds optional job-profile demand to staffing requirements and open shifts, enabling role-specific coverage, labor variance, and staffing scenarios.

- `0050_hcm_core_worker_history.sql` adds legal-employer ownership on positions, primary/secondary assignment semantics with FTE, and an immutable worker employment-event timeline for hires, moves, promotions and separation lifecycle evidence.

- `0051_hcm_org_job_architecture.sql` normalizes job families, levels and grades; enriches organization units with legal-employer, cost-center and effective-date context; and links positions to supervisory organizations and cost centers.

- `0052_hcm_effective_dated_changes.sql` adds maker-checker governed, scheduled employment changes with future-date application, guarded retroactive corrections, position reservation, failure evidence, and immutable worker-history linkage.

- `0053_hcm_capability_wfm_eligibility.sql` adds normalized skills, verified employee proficiencies, job-profile skill requirements, and job-profile credential links backed by the existing document compliance/expiry system for WFM eligibility.

- `0054_hcm_compensation_architecture.sql` upgrades compensation bands with grade/legal-employer/effective-date scope, adds governed recurring compensation components, schedules approved pay changes without mutating current pay early, and records compensation history evidence.

- `0055_hcm_worksite_arrangements.sql` adds effective-dated work arrangements and per-employee secondary-site authorization for WFM eligibility.

- `0056_hcm_employment_terms.sql` adds maker-checker employment terms, lifecycle review/end dates, scheduled activation, and immutable worker-history linkage without automatic regularization or separation.

- `0057_hcm_employment_term_decisions.sql` adds maker-checker probation/renewal/conversion/non-renewal decisions, successor-term lineage, and explicit separation handoff evidence without automatic regularization or separation.

- `0058_hcm_worksite_authorization_decisions.sql` adds explicit effective-dated allow/deny decisions to worksite eligibility while preserving existing authorizations as allows.

- `0059_hcm_term_separation_linkage.sql` makes non-renewal handoff state authoritative to the real Separation/final-pay lifecycle, linking a decision to exactly one separation package and completing the handoff only on final-pay release.

- `0060_hcm_lifecycle_notifications.sql` adds durable employment-lifecycle notification tasks and immutable events for ownership, acknowledgement, snooze, milestone dedupe, and escalation without changing employment state automatically.

- `0061_hcm_precise_leave_intervals.sql` adds immutable revisioned full-day, half-day and timed leave evidence for schedule-aware WFM capacity without changing legacy payroll treatment.

- `0062_hcm_employment_decision_evidence.sql` adds sealed employment-decision evidence packets with immutable review notes, hashed supporting documents, approval/lifecycle event history, and a SHA-256 snapshot sealed at approval.

- `0063_hcm_lifecycle_policy.sql` adds organization-specific lifecycle action windows, reminder/escalation cadence, optional decision-evidence requirements, optimistic versioning, and immutable policy-change snapshots.

- `0065_hcm_manager_attestation.sql` adds append-only manager attestations bound to the worker’s active reporting line and versions sealed employment-decision evidence so historical v1 hashes remain verifiable while new approvals seal v2 packets.

- `0066_hcm_probation_review_acknowledgment.sql` adds structured probation reviews, immutable submitted-review evidence, employee receipt-only acknowledgments, and review lifecycle events without granting automatic employment-status authority.

- `0067_attendance_exception_events.sql` persists idempotent attendance-exception lifecycle evidence so newly detected exceptions can emit the live Automation Studio `attendance.exception_created` trigger without duplicate workflow runs.

- `0068_automation_rule_version_governance.sql` adds Automation Studio draft/publish/rollback governance with immutable version history while preserving the current published rule row as the runtime snapshot.

- `0069_automation_generated_document_provenance.sql` distinguishes generated employee documents from uploads, records stable generation provenance, and enforces organization-scoped idempotency for Automation Studio document creation.

- `0070_configurable_approval_chains.sql` adds versioned, ordered approval-chain definitions and immutable per-request chain snapshots around the existing approval task queue.

- `0071_amount_based_approval_limits.sql` adds immutable amount/routing evidence so configurable approval chains can require higher approval levels only after governed monetary thresholds are crossed.

- `0072_treasury_separation.sql` adds opt-in enterprise treasury separation with stable-user payout operators and release-vs-disbursement actor separation.

- `0073_payout_destination_dual_control.sql` adds maker-checker requests for employee payout destination changes when treasury separation is enabled, preserving encrypted proposed bank data and immutable request evidence.

- `0075_saml_enterprise_identity_foundation.sql` adds protocol-specific SAML provider metadata and replay-resistant SAML login-state persistence while keeping SAML authentication fail-closed until signed XML verification is available.


- `0074_company_payout_profiles.sql` adds legal-employer payout profiles and explicit bank-adapter lifecycle metadata so bank configuration can progress from draft/spec/mapping/UAT to portal-validated without changing payroll computation.

- `0076_performance_structure_controls.sql` adds cascading company/team/employee goals, competency/KRA templates, structured review items, and governed performance-cycle completion controls.
