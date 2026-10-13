# A-6: tenant database isolation plan — awaiting owner review

No migration, role grant or production change is included. Source inspection found no RLS policies in src/drizzle; this is not a live catalog assertion. Inventory actual constraints, ownership, policies, connection roles and tenantless/global tables before rollout.

## Proposed boundary

Prefer one restricted runtime role with RLS over one role per tenant. Per-tenant roles complicate provisioning, pooling, credentials, shared-user access and background workers; they still require tenant-consistent foreign keys. Keep existing HTTP authorization and maker/checker controls. Use a separate migration owner; runtime must be non-owner, non-superuser and without BYPASSRLS. FORCE ROW LEVEL SECURITY on protected tables where appropriate.

Each authorized request opens a transaction and sets `app.tenant_id` with parameterized `set_config('app.tenant_id', tenantId, true)` (SET LOCAL semantics). Resolve membership before setting context, and never trust a raw caller-supplied tenant. Execute all ORM reads/writes through that transaction. Missing/invalid context denies access. Define both USING and WITH CHECK. Pool reuse must never leak context; test success, rollback, cancellation and errors across tenants on the same pooled connection. Entity/department authorization remains an additional application boundary.

## Initial waves

1. Employees and tenant-owned bank configuration/change requests.
2. Payroll runs/entries, payslips and payout ledger, deriving tenant through parent runs where a child lacks organization_id; measure whether adding tenant keys/composite constraints is preferable to policy joins.
3. Separation records and final-pay evidence.

First resolve missing/cross-tenant parents and nullable historic attribution. Do not infer historic employer ownership from current employee data. Global pricing, statutory references and identity/membership tables need explicit separate policies, not an indiscriminate tenant filter.

## Workers and webhooks

The scheduler claims work through a narrowly privileged service function/role, then processes each tenant in its own transaction with local context and existing lease fencing. Provider webhooks verify signatures and resolve the stored provider/event mapping before assigning tenant context. Do not accept organization IDs from unsigned payloads. Cross-tenant reporting requires explicitly reviewed aggregate queries, not enabling BYPASSRLS on the ordinary application role.

## Verification and rollout

Behind a new default-off critical release flag, migrate to a separate RLS-capable runtime role and transaction wrapper. Do not enable RLS on tables while flag-off requests still use that same role without tenant context: that would break existing behavior. Rehearse an isolated restored database, direct SQL negative writes, two-tenant HTTP/worker/webhook tests, membership changes and maker/checker flows. Compare EXPLAIN ANALYZE/BUFFERS and latency for high-volume payroll and roster queries; index organization/parent keys and measure policy joins. No acceptance threshold should be invented without baseline measurements.

Canary one synthetic tenant, then an explicitly approved employer cohort. Capture denied-query counts and pool/request latency without PII. Rollback switches to the previously reviewed runtime role/path only after verifying equivalent tenant filters; retain additive schema and policies. Never give runtime superuser privileges or automatically disable all isolation to recover service. Use maintenance mode if the previous path cannot safely enforce isolation.

Review required: role choice, initial table set, privileged claim-function boundary, rollout thresholds and rollback. Implementation waits for owner review.
