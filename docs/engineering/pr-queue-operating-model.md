# PayrollPH PR Integration Queue

Status: maintainer-operated engineering model. See `docs/engineering/change-risk-policy.md`. **No mandatory independent GitHub approval applies to every PR.**

## Goal

Stop accumulating unfinished, overlapping branches. Keep at most **three review-ready PRs**. Other real work may stay draft or be explicitly deferred. This is a *work-in-progress limit*, **not a reviewer-count requirement**. A green PR may be merged by its author/authorized maintainer when the source merge gates in the risk policy are satisfied.

The workflow is read-only and never approves, merges, applies SQL, deploys, activates workers, or authorizes payments.

## Three active merge candidates

Choose at most three candidates and one accountable maintainer for each. No second GitHub account or outside reviewer is needed *solely to merge a PR*.

1. Confirm exact source SHA and current base; inspect the incremental diff and upstream overlap.
2. Run exact-head CI and the applicable security, statutory/golden and behavior tests.
3. Identify canonical branch and predecessor/dependent PRs; keep unfinished work draft.
4. Resolve demonstrated failures, conflicts and SQL reservation collisions. Do not require a generic independent-review checkbox.
5. Record rollback and activation gates separately from **source** merge.
6. Do not claim live payroll, bank, migration, privacy, or external provider acceptance from GitHub CI alone.

`.github/workflows/pr-integration-queue-gate.yml` checks whether *more than three* non-draft PRs are open and verifies SQL prefix reservations. There is no generic second-person signoff check.

## Current source-merge ordering

| Lane | Current candidate(s) | Before source merge |
| --- | --- | --- |
| Security | #741, #742 | Current-head security and behavior checks; account for modified public routes |
| Scheduler | #740 | CI, cron authorization tests; keep activation OFF pending staging |
| Bank controls | #723 → #724 | Preserve helper and payment-snapshot dependency; exact-head protection/golden tests |
| Financial overlap | #720, #721, #739 | Reconcile payout/payroll release and bank crypto code; do not double-merge sources |
| Money calculation | #743 | Golden and assurance reconciliation; inspect changes relative to other engine PRs |
| Provider idempotency | #745 | Reserve unique migration, PostgreSQL transaction/replay and payout isolation |
| Optional HCM/WFM | Remaining feature drafts | Defer or merge individually only with relevant source testing; live pilots separate |

## SQL migration reservation

SQL filenames share one append-only sequence. Different open PRs must not reserve the same four-digit migration prefix. Inspect actual *applied* production/staging journal before authorizing any migration. Never renumber previously applied SQL or overwrite a live database merely to make a PR green.

## Merge checklist

- [ ] Current-head applicable checks green
- [ ] Incremental diff, dependencies and overlaps reviewed by maintainer
- [ ] Risk tier and changed behavior tested
- [ ] No private tenant/payroll/secrets exposed in the PR
- [ ] For payroll/WFM, golden and scenario tests/reconciliation where applicable
- [ ] For schema/PII, migration/restore and security *activation* gates documented
- [ ] For scheduler, AI, financial provider or live payments, activation flags stay OFF until separately authorized
- [ ] For money movement, distinct employer/bank authority and recovery proof exists **before executing money movement**, not as a universal PR reviewer checkbox

## Workflow safety and limitations

The queue action uses `pull_request_target` but checks out **only trusted default-branch code**, never untrusted PR-head code. Its token is read-only and it makes no API writes.

For branch protection, require appropriate automated checks without a blanket independent-review approval count. The repository owner may still request optional targeted review for particularly difficult changes; optional review must never be represented as already completed.

No PR, however well tested, authorizes production payroll, transfers, employee-data migration, or live provider activation.
