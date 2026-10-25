# Statutory remittance action legal-employer isolation — draft evidence

**Status: NOT ACCEPTED for production until exact-head PG16 ON/OFF tests and independent security-owner review.**

This change addresses two method-level gaps in the complete 493-method tenant-isolation inventory:

- GET /api/compliance/remittance-actions
- POST /api/compliance/remittance-actions, including sync, assign and acknowledge.

## Boundary

The route already requires an authenticated company-wide payroll operator and a valid organization membership. Under the separately gated MULTI_ENTITY_ENABLED=true mode, that membership is **not** a grant to every legal employer inside the organization. The new route policy selects one legal employer through resolveMultiEntityContext, then:

- Restricts GET tasks to source keys belonging to the selected employer, and hides unattributed legacy tasks.
- Restricts the returned list of eligible assignees to active payroll operators with an explicit legal-employer grant.
- Restricts POST task-ID lookup, assignment, acknowledgment and the final guarded UPDATE to the task's source-key employer. Assignments to an ungranted recipient are refused.
- Passes the selected legal employer to statutory task synchronization. The sync and escalation runner must not process another employer's task or outbox.
- Allows escalation notices only to active company-wide payroll operators explicitly granted the task's legal employer. Legacy unattributed tasks cannot send notifications in multi-entity mode.
- Preserves existing company-wide queue, legacy tasks and grant-independent behavior when MULTI_ENTITY_ENABLED=false. No production flag changes.

There is no migration here. Task attribution uses the canonical source-key prefix legal-entity:<ID>:. Malformed, missing and ambiguous prefixes are denied for employer-specific operations; a future explicit source-schema migration would require separate DBA review.

## Executed acceptance contract

A dedicated disposable PostgreSQL 16 matrix runs the production-mode Next app against HTTP loopback on port 3019 for MULTI_ENTITY_ENABLED=false and true. The script refuses non-GitHub Actions execution, non-app_db targets, non-loopback addresses, live payment credentials or email delivery credentials.

The fictional fixture includes one two-legal-employer group, two unrelated attacker organizations, real authenticated company-wide owner sessions, explicit legal-employer grants and a real victim task with ID greater than 6. Tests require:

- Owned real GET 200 with a nonempty queue and owned POST 200 with persisted state changes.
- Both outsider sessions GET and POST 403 for the actual victim organization, with unchanged victim task/audit/outbox/payroll rows.
- Multi-entity ON: separate owner B can read/change its own task; owner A cannot read or mutate B's task, impersonate B in a query or header, assign work to an ungranted actor, or read a legacy unattributed task.
- Multi-entity ON: a selected-employer sync cannot rewrite the other employer's queue or create outbox messages for it.
- Multi-entity ON: outbox escalation for employer B reaches only its current grantee. Email providers remain disabled and rows must remain queued, not sent.
- Explicit employer grant revocation denies the same signed-in actor's subsequent GET and sync.
- Multi-entity OFF: the prior company-wide visibility, assignment availability and all-employer sync remain operational.

**Scope exclusions:** this batch does not certify unrelated compliance routes, payroll money movement, agency filing, public launch, historical data migration or global tenant isolation.

## Source evidence

- API route: src/app/api/compliance/remittance-actions/route.ts
- Source-key contract: src/lib/statutory-remittance-task-scope.ts
- Escalations: src/lib/statutory-remittance-escalations.ts
- Sync: src/lib/statutory-remittance-actions.ts
- HTTP/PG16 proof: scripts/qa/remittance-action-entity-http.mjs
- Unit and regression source checks: tests/statutory-remittance-task-scope.test.ts
- Isolated CI workflow: .github/workflows/remittance-action-tenant-isolation.yml

**Provisional coverage ledger after this change (relative to current main):** 150 covered, 10 public-by-design, 333 gaps among 493 methods. These credits are not security approval; independently review and reconcile any concurrent PR changes to the same ledger before merging.
