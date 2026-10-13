# PayrollPH PR integration queue and human review

**Status:** maintain no more than **three review-ready pull requests**. The
queue protects review capacity but does not independently authorize a code
merge, a deployment, a payroll run or money movement.

## Three review-ready candidates maximum

`.github/workflows/pr-integration-queue-gate.yml` and
`scripts/pr-queue-policy.mjs` inspect the full set of open PRs and
numbered SQL claims. More than three non-draft PRs blocks the queue check.
Keep additional/overlapping changes in draft, especially financial ledger,
migration, payroll-money, bank-payout, and provider-inbox work. Never
renumber SQL already applied in a live database to resolve a draft collision.

For each review-ready candidate, record its exact head SHA, the dependent
PRs, risk tier, tests/CI result, rollback plan, and **human reviewer** for
sensitive money-related changes. Changes to the head invalidate previous
approval. Do not rely on cached passing checks from an older commit.

## Required independent source review for T2/T3

The P0-3 gate `Independent Payroll Change Review Gate (P0-3)` requires
one **named human other than the author** who is permitted to review
the repository and actually approved the latest SHA. It covers money,
payroll, final pay, approval routes, bank/payout, scheduler, migration,
identity and related security changes. A green queue check does not
replace a current-head approval. Low-risk T0/T1 docs/UI can still use
ordinary maintainer review.

The named reviewer allowlist and required GitHub branch protection must
be configured by the repo administrator. The GitHub `Protect main`
ruleset was **disabled** when inspected on October 12, 2026; even a
passing read-only review check is not a hard merge gate until the
ruleset is enabled with required reviews and status checks. See
[Independent Review Gate](independent-review-gate.md) and
[Change-risk policy](change-risk-policy.md). Never claim independent
approval while the role remains unassigned.

## Pilot freeze, then source merge

Optional HCM/WFM branches (talent, compensation, performance, Worker 360,
planning, coverage and similar advanced operations) stay on hold
**until a real first-pilot start has written committee approval**.
The new policy guard detects affected files, including scripts, tests
and relevant SQL. Do not flip the pilot variable just to make a PR green.
Core People, Time, Payroll, Leave, Payslip, Approval, Export, Audit and
Compliance remediation can continue with tests and review.

## Required work before any real payroll release

- Complete and reconcile the employer first-payroll journey, including
  current statutory calculations, approvals and employee-by-employee
  centavo accuracy under an independent checker.
- Confirm bank-data encryption/backfill and SQL migrations on the
  actual environment, with witnessed restore and acceptable filing/bank
  evidence. Never equate code presence with production migration.
- Keep provider payouts, self-serve billing, AI automation and optional
  modules disabled until separately authorized.
- Record reviewer and release committee decision; prohibit self-approval
  of live payroll and any bank/payout execution.

## Scope of the two checks

The PR Queue Gate and independent reviewer gate operate only on
**GitHub metadata**. Neither job has write permission, merges PRs,
grants repository roles, configures protection, runs SQL, deploys code,
triggers a cron/worker, decrypts data or moves money. Configure GitHub
ruleset and production environment protection separately.
