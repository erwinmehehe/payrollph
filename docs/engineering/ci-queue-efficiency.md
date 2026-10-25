# PR queue efficiency

The required CI workflow previously included the PR head SHA in its concurrency
group. Different commits therefore never shared a group, so `cancel-in-progress`
could not supersede an older head. It now uses one stable workflow/PR group.
Main commits remain keyed by SHA and are not cancelled by subsequent merges.

The explicit policy in `.github/ci-queue-policy.json` also adds cancellation to
59 CI-only workflows that previously had no concurrency block. Their non-PR
events use independent run IDs, so manual dispatches, scheduled runs and main
pushes cannot cancel one another. Ten privileged/live/staging/deployment
exceptions retain their existing behavior. Production environment and migration
approval gates are unchanged. Synthetic localhost migration rehearsals remain
ordinary PR test jobs; cancelling an obsolete PR test does not cancel a protected
production migration.

## Required checks and prose-only changes

The active main ruleset was inspected read-only during preparation. Its required
statuses are `check`, `security-http-smoke`, `payout-payroll-isolation` and
`Analyze JavaScript and TypeScript`. Their workflows have no new path filters;
the regression and audit matrices and fail-closed aggregate remain intact.
No repository settings were changed.

Eight optional integrations now skip ordinary Markdown/MDX prose-only PRs.
The filters continue to select all non-prose files, including SQL, JSON/CSV
evidence, schema, authorization, payroll, packages and build configuration.
Markdown/MDX under source, scripts, tests, public assets or `.github` is explicitly
re-included because it may be executable content or a fixture. Existing main
push and manual-dispatch triggers remain unchanged. Risk classification and SQL
history policy checks still run on every PR.

## Shared intake build

The PG16 and PG18 public-intake jobs have identical build-time configuration.
One dedicated job builds against a disposable PG16 schema, then uploads only a
tar of `.next` (excluding `.next/cache`) with a name keyed to `github.sha` and
one-day retention. Consumers download from the same workflow run; there is no
cross-run build cache. Both database versions retain independent services,
schemas, runtime test keys, careers tests and real HTTP acceptance.

This removes one duplicate build but adds an artifact/preparation job. Actual
elapsed-time improvement must be measured in CI; no timing or cost saving is
claimed from source tests alone. Tenant profiles, money flags and other
build-time-dependent matrices keep separate builds.

## Queue cleanup and validation

During preparation, 41 obsolete PR workflow runs from earlier #1384/#1385 heads
were cancelled after checking the displayed commit and pull-request event.
Latest PR heads, main, schedule and manual runs were not selected. Cancellation
of these older runs does not satisfy any latest-head check.

The queue-policy tests parse every workflow, exercise ordered path-filter cases,
check explicit exceptions, preserve all required gates and validate the exact-run
build handoff. Existing concurrency, required-check, shard-completeness and
isolated-baseline tests remain required. The PR's own fresh CI must still pass,
especially both public-intake database jobs, before merge.

For future fixes, batch related edits before pushing. Do not repeatedly re-run
the entire suite when only one failed job needs a retry, and never cancel a
current-head required check simply to make a merge appear ready.
