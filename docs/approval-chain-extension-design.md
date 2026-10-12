# Configurable approval chains: implementation plan for review

Status: DESIGN FOR REVIEW. No implementation, migration or production activation is authorized by this document. Baseline: main `4d816361` (12 October 2026).

The requested review gate is in the attached PayrollPH AI Build Prompts: “For multi-entity, approval chains and Fix C, ask for a written plan first and review it before any code.” Existing policies, instances, instance steps and delegation records must be reused. This proposal extends existing chains; it does not replace existing maker-checker authority.

## Current implementation and gap

`src/lib/approval-chains.ts`, `/api/approval-chains`, `src/components/approval-chain-admin.tsx` and `approval_chain_policies`, `approval_chain_instances`, `approval_chain_instance_steps` already implement ordered, amount-threshold steps, named/role approvers and frozen dynamic-group routing. `approval_delegations` already exists. Due labels are presentation text; they are not an executable escalation clock. Existing behavior and independent payroll release must be preserved.

## Proposed changes, one isolated feature PR after review

Add default-off `APPROVAL_CHAIN_EXTENSIONS_ENABLED` in the release registry. Reuse all existing tables. Add versioned policy configuration for supported sources: leave, overtime, expenses, payroll release and final pay. Resolve sources and amounts from tenant-scoped server records, not request JSON. Reject unknown source types and unsupported policy versions.

Store numeric escalation days, an authorized escalation principal, activation/due timestamps and an escalation receipt keyed by instance, step and stage. Never infer elapsed time from dueLabel. The scheduler advances notification/escalation routing only; it never decides an approval. Idempotency keys prevent repeated notifications. A disabled or expired destination creates an explicit blocked state for an administrator.

Snapshot policy version, source amount and maker identity when the request starts. Policy edits affect future requests only. An approval step must remain pending until all earlier applicable steps finish. A rejection ends the instance; withdrawal cancels remaining tasks and preserves evidence. Threshold comparison uses integer centavos.

Reuse expiring delegations, validate tenant membership, active role and delegated authority at decision time, and reject cycles or delegation to the maker. Store actual human actor, represented principal, delegation ID and reason. A maker cannot approve their own source by acting as a delegate. One human cannot satisfy both payroll maker and checker or replace the existing independent release guard. Configuring one step does not reduce the financial minimum floor; zero-step financial policies are invalid.

Mutations lock the source and active step before decisions, then update task, instance and source together. Audit actor IDs and policy versions without secrets or personal identifiers. Use existing audit-chain sealing. Fail closed on stale/changed membership or withdrawn authority. No entity changes are bundled here; preserve tenant and existing org-unit scope.

## UI and roles

Extend the existing Approval chains admin screen for company-wide authorized admins with source picker, ordered steps, named/role picker, amount threshold, delegation expiry and escalation settings. Show empty policy state, validated edit state, loading/save state and actionable API errors. Existing Approvals inbox gains current step, due time, escalation and delegation evidence; employees see only their own requests and never internal routing secrets. Managers/checkers see only assigned scopes. Phone layout stacks steps and uses accessible move-up/move-down buttons.

Record before/after screenshots of admin builder and role-scoped inbox at desktop and 390px, including flag-off parity. Do not add a provider integration or send notifications during development.

## Migration, rollout and rollback

Use an additive idempotent migration with old rows represented as legacy policies. Rehearse on a sanitized isolated restore. Keep existing policy parser and task fields compatible. When the flag is off, do not add UI or initiate new extension instances. If turned off with extension instances active, fail closed on their decisions and expose a read-only recovery inventory; do not silently interpret them as legacy. A reviewed recovery operation may cancel and reissue pending requests. Do not drop evidence columns/tables during rollback.

## Behavioral acceptance

Execute route/service behavior on disposable PostgreSQL: maker delegates to checker then attempts decision; checker delegates back to maker; same actor attempts both financial steps; expired/cross-tenant delegation; stale group authority; threshold boundaries; out-of-order and concurrent decisions; edited policy while in flight; escalation retry and expired destination; flag-off existing policy golden behavior. Every invalid path must prove unchanged source and approval state. Test payroll release still requires two distinct humans through the existing release endpoint.

Full Manila-timezone suite, tsc, warning-debt lint and all four golden payroll suites must pass. No source-grep tests qualify. No deployment or flag enablement is part of the implementation PR.

## Review decisions requested

Approve reuse of existing policy/delegation tables and frozen version semantics; approve escalation as routing/notification only; approve the fail-closed rollback of in-flight extension instances; confirm named/role routing and source-specific minimum approval floors. Implementation waits for this review.
