# Tenant proof scheduling, first bounded rollout

This change affects scheduling in two workflows: DL-01 closure and ESS document
reads. It awards no tenant credits, changes no
runtime flags, and leaves every HTTP proof step, profile matrix, database,
network guard and environment unchanged. The original execution jobs are
protected by reviewed SHA256 snapshots in the contract tests.

## What can avoid a repeated build

- A title/body edit or `ready_for_review` event can reuse a previous successful
  run only when GitHub Actions metadata matches the exact PR number, head SHA
  and base SHA, and every expected heavy proof job really completed with
  `success`. Skipped jobs, partial matrices, stale bases, missing history and API
  failures cannot supply that receipt. Read-only Actions access is limited to
  the fast classifier job; no token is printed or persisted.
- A ledger-only edit can skip a family whose method entries did not change.
  Derived live count/headline updates and the two tracking Markdown files are
  allowed. Shared inventory tests may change only existing SHA literals.
  Route/source pins, global policy, removed/new methods, credit downgrades,
  executable edits, malformed metrics and unknown files run the original proof.
- The global CI regression, credit-reconciliation, lint, security and policy
  workflows are unchanged. Unrelated family HTTP execution is not a substitute
  for those global guards; they remain responsible for validating new credits.

This is deliberately narrower than skipping any PR that “looks unrelated.”
For example, a promotion PR adding a new credit script still runs these proofs.
Expanding the safe file classes requires its own dependency/guard evidence.

## Failure and cancellation behavior

Only an explicit `run=false` from a successful classifier permits a skip.
Classifier failure, empty output, invalid JSON, missing Git history or an
unknown workflow falls back to the unchanged heavy job. Existing fork and
manual-run restrictions are preserved.

Metadata/readiness events have a separate concurrency namespace. They cannot
cancel the primary proof merely because a PR description was edited. Normal
head updates and base changes still supersede obsolete proof runs; manual
workflow events have their own namespace.

All original manifest/source triggers remain. Classifier, policy and classifier
test edits are added as triggers, so changing scheduling itself forces proof.
There is no cache of “green” across different head/base pairs.

## Scope and acceptance

The byte-pinned tenant-table and DL-02 workflows are left completely unchanged:
editing either would invalidate existing credits and needs a separate fresh
proof receipt. This PR does not implement shared build artifacts. Other historical workflows
remain untouched. No workflow is disabled and no repository setting changes.

Before source merge, exact-head CI must execute the modified workflows. Since
this PR changes the workflows and classifier, it must classify itself as
requiring the full proof. The first successful Linux run validates that wiring;
local source-contract tests do not claim a new PG16/HTTP execution receipt.

Later candidates are compatible-profile build reuse and more family gates.
Their savings must be measured separately; this rollout makes no percentage
or wall-clock speed guarantee.
