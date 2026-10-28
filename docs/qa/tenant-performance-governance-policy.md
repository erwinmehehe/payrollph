# Performance Governance tenant-isolation evidence

Status: Draft, provisional, zero new coverage credits. Do not merge without independent review.

Target: PATCH /api/performance/follow-through-governance (currently GAP).
Covered here: action_reminder_policy and evidence_policy only. The remaining four actions are unproven.

The independent test uses fictional employers A, B and a higher-ID victim C in disposable PostgreSQL 16.
It exercises real localhost HTTP, positive owner writes, nonadministrator denials, foreign-employer denials,
stale-version conflicts, cross-employer cycle ID rejection, and unchanged victim/peer snapshots.
The GET response is checked as a populated positive control but does not receive new coverage credit.

Every successful policy change must persist the correct version, actor, policy-event snapshot and audit.
Payroll, employee, performance-cycle and other tenant records must remain unchanged.

Safety: no production application route, schema, migration, feature flag, payment operation,
coverage manifest or reservation ledger is changed. Workers and schedulers remain disabled.

Acceptance requires a passing exact-head disposable PostgreSQL/HTTP job, full CI/security checks
and independent maintainer review. Other policy actions need their own evidence before method credit.