# HCM SLA escalation — independent tenant/outbox boundary family

**DRAFT / NOT ACCEPTED / ZERO COVERAGE CREDITS.** Independent fictional-only security regression for POST /api/hcm/work-items/escalate. This scheduler intentionally processes due work items across multiple employers, so the tested boundary is scheduler authentication, tenant-specific event/outbox attribution, recipient filtering, and idempotency — not employer-user permissions.

## Five exclusive new paths

- .github/workflows/tenant-hcm-sla-escalation-http.yml
- scripts/qa/tenant-hcm-sla-escalation-contract.mjs
- scripts/qa/tenant-hcm-sla-escalation-http.mjs
- tests/tenant-hcm-sla-escalation-contract.test.mjs
- docs/qa/tenant-hcm-sla-escalation.md

No production API route, scheduler, migration, schema, payroll engine, provider flag, coverage manifest, shared ledger, or other PR's code is modified. The existing route's reviewed Git blob is b432d1331dac5c3da0c6a8bbc2b4c7ebe95ceb9a; a change requires explicit source re-review.

Distinct from currently active enterprise, email-account, document-vault, payroll and tax, workforce-planning scenarios, billing subscription, and marketing report PRs. The five added paths are exclusive.

## Expected real-HTTP and PostgreSQL 16 proof

- Two independently persisted fictional employers A and B, each with one overdue HR operational case; third employer with genuinely higher ID and a future/ineligible case.
- Authorized scheduler POST escalates exactly two due work items, each with an employer-correct persisted event and one queued notification to that company's active, company-wide owner.
- Inactive and unit-scoped HR members receive no notifications; neither employer's email/event contains the other employer's marker.
- Anonymous/mismatched bearer token receives 401 without a write or marker leak.
- Same authorized request repeated is idempotent: zero further case updates, events or outbox rows.
- Victim employee, payroll, pay-profile and audit snapshots remain identical. Other non-due, resolved, and future cases remain unchanged.
- The CI artifact is aggregate and synthetic only. Source assertions without a passing actual PG16/HTTP run do not constitute acceptance.

## Mandatory safety boundaries

CI-only fresh PostgreSQL 16 app_db on 127.0.0.1:5432, Next on 127.0.0.1:3000, fictional @example.invalid mailboxes and ephemeral generated cron token. No Neon/hosted or production SQL, real employers, messages, credentials, payout, payroll release, provider integrations, bank details, workers, scheduler, or deployment. Outbox is *queued*, never sent.

## Review and release gates

- [ ] Exact-final-head dedicated HTTP/PG16 workflow succeeds and produces a genuine receipt.
- [ ] All standard CI, typecheck and applicable security checks pass.
- [ ] Independent HR/security/privacy review verifies database and outbox attribution.
- [ ] Reconcile current main and verify no overlap with remaining open PRs.
- [ ] Retain zero coverage credits and no tenant-wide or production certification.

**Out of scope, not tested:** simultaneous cron calls, forced transactional rollback, 100-case batch-limit behavior, real external notifications, production scheduler behavior, and real-employer approvals. Those require separate accepted evidence.
