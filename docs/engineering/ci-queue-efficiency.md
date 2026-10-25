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

## Clean/restore CI repair

The first synchronized head passed the shared intake build and both PG16/PG18
HTTP acceptance jobs, but all four clean/restore control shards failed. That
workflow installed 0109 without the reviewed migration-only schema supplement.
It now applies the existing disposable-only baseline wrapper before dumping the
source database, so both clean and restored runs start from the complete baseline.
No SQL source, live database or baseline guard is changed.

The shard runner's spec output also hid failure names from TAP-only receipt
collectors. Human-facing CI keeps spec output; clean/restore and clean PG18
collectors explicitly request TAP through a validated reporter option. The
regression test executes a real deliberately failing fictional test through the
Node CLI and actual receipt parser: clean-only, restore-only and shared failures
remain failures, and private assertion diagnostics stay out of uploaded receipts.
Both workflows now track their runner and receipt-test dependencies.

This correction requires fresh real PostgreSQL CI; the earlier generic
`nonzero_exit_without_TAP_failure` receipts cannot establish which individual
assertions failed. Do not represent the source repair as a completed green run.

## October 25, 2026 — workflow retirement inventory (owner decision required)

**Status: no YAML deleted.** This is a cautious triage update, not a completed retirement or CI queue reduction. The repository had **148** workflow YAML files at inspected main `802c2dd1099dc2aa16b73771637fec5b89a35cb5`. The 15 explicitly protected workflows and the two clean-baseline-cutover workflows are excluded from candidate consideration entirely.

### Safe to remove

**None verified.** Do not remove any workflow from this register until **all** deletion criteria are evidenced, including issue/PR closure without reopened follow-up, zero references across full tracked source/docs/tests/workflows, not a required status context and a full workflow-run failure review. A closed GitHub issue alone does not authorize deleting its tests.

### Needs owner judgment — issue/PR-numbered (19)

| Workflow | Evidence / reason retained |
| --- | --- |
| `draft-1302-tenant-read-proof.yml` | CLOSED, explicitly partial security sweep; no independent follow-up clearance verified |
| `issue-0129-fk-name-reconcile-ci.yml` | Mismatch: 0129 is a SQL migration number, not the GitHub #129 overtime issue; recent failed checks |
| `issue-1019-stable-two-push-proof.yml` | CLOSED, 2nd-push regression proof may still be load-bearing |
| `issue-1031-full-schema-diff.yml` | CLOSED issue, but ongoing schema reconciliation and observed workflow failure |
| `issue-1031-review-only-candidate-parity.yml` | CLOSED issue, but ongoing schema reconciliation and observed workflow failure |
| `issue-1031-schema-diff-ci.yml` | CLOSED issue, but ongoing schema reconciliation and observed workflow failure |
| `issue-1031-schema-only-hr-cases-rehearsal.yml` | CLOSED issue, but ongoing schema reconciliation and observed workflow failure |
| `issue-1031-schema-only-it-assets-rehearsal.yml` | CLOSED issue, but ongoing schema reconciliation and observed workflow failure |
| `issue-1031-source-shape-analysis.yml` | CLOSED issue, but ongoing schema reconciliation and observed workflow failure |
| `issue-1054-forward-schema-rehearsal.yml` | OPEN/reopened; forward migration gate |
| `issue-1061-compensation-forward-schema-rehearsal.yml` | OPEN; compensation schema blocker |
| `issue-1102-header-rehearsal.yml` | OPEN/reopened; fictional header parity |
| `issue-1113-worksite-forward-qa.yml` | OPEN; worksite and separation schema blocker |
| `issue-1154-payout-check-contracts.yml` | CLOSED, payout boundary acceptance not proven redundant |
| `issue-1198-wfm-demand-forward-recovery.yml` | CLOSED evidence checkpoint but production DBA NO-GO persists |
| `issue-910-0121-review.yml` | CLOSED source checkpoint, historical SQL/DBA acceptance not closed |
| `issue-910-0123-numbered-rehearsal.yml` | CLOSED source checkpoint, historical SQL/DBA acceptance not closed |
| `issue-993-pg18-preview-parity.yml` | OPEN; canonical preview acceptance pending, recent failed runs |
| `issue1113-review-candidate-acceptance.yml` | OPEN; worksite and separation schema blocker |

### Needs owner judgment — one-off-style, source, QA, and rehearsal workflows (61)

| Workflow | Evidence / reason retained |
| --- | --- |
| `a4-a5-source-inventory.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `a5-private-object-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `a5-vault-migration-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `a6-clearance-migration-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `audit-0109-pg16-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `audit-role-isolation-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `audit-runtime-identity.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `automation-language-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `bank-envelope-audit-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `bir-1604c-candidate-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `catalog-auditor-privilege-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `competitive-100-worker-app-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `core-modules-browser-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `employee-import-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `employee-import-browser-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `employee-vault-profile-browser-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `ess-profile-browser-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `exact-sha-qa-overview.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `filing-remittance-forward-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `hcm-gaps-focused.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `hcm-people-home-browser-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `hcm-process-monitor-browser-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `hris-journey-browser-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `independent-journey-853-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `isolated-release-schema-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `manual-owner-uat-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `money-closes-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `multi-entity-browser-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `native-windows-test-portability.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `nine-stage-connected-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `offline-claims-development-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `p0-4-backup-reader-pg18-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `p0-acceptance-evidence-contract.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `payout-ledger-tenant-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `pg18-schema-repeat-proof.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `pilot-payroll-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `post-cutover-real-role-smoke.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `pr-integration-queue-gate.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `preview-browser-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `production-schema-inventory.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `recovered-neon-schema-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `repair-security-pr-candidate.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `reviewed-migration-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `runtime-schema-cutover-catalog.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `salary-correction-cases-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `scheduler-postgres-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `scheduler-scheduled-run-observer.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `tenant-dl02-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `tenant-table-proof.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `tenant-write-discovery.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `unattended-scheduler-payroll-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-demand-staffing-policy-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-demand-staffing-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-five-worker-dev-acceptance.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-historical-demand-outlook-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-issued-demand-prospective-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-loyverse-pos-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-migration-contract-rehearsal.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-operational-demand-observations-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-sprint-candidate-source-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |
| `wfm-square-sandbox-qa.yml` | No issue/PR closure + absence-of-references + full 90-day failure-history chain simultaneously verified; may be a reusable QA, approval, or regression gate |

### Reproducible observations and missing verification

- The active `Protect main` ruleset `24862793` requires status contexts `check`, `security-http-smoke`, `payout-payroll-isolation`, and `Analyze JavaScript and TypeScript` as of this read. Required workflows were not edited.
- Actual GitHub issues inspected: #129 CLOSED (unrelated overtime calculation), #1019 CLOSED, #1031 CLOSED, #1054 OPEN/reopened, #1061 OPEN, #1102 OPEN/reopened, #1113 OPEN, #1154 CLOSED, #1198 CLOSED evidence-only/DBA NO-GO, #910 CLOSED source-only, #993 OPEN, #1302 CLOSED partial.
- Recent real failed runs in the global GitHub Actions history include `issue-0129-fk-name-reconcile-ci.yml` (Oct 21–25; e.g. [run 40165126365](https://github.com/erwinmehehe/payrollph/actions/runs/40165126365)), `issue-993-pg18-preview-parity.yml` ([run 40164007105](https://github.com/erwinmehehe/payrollph/actions/runs/40164007105)), `issue-1031-source-shape-analysis.yml` ([run 39613007499](https://github.com/erwinmehehe/payrollph/actions/runs/39613007499)), and `bir-1604c-candidate-qa.yml` ([run 40097104239](https://github.com/erwinmehehe/payrollph/actions/runs/40097104239)). Failures are not proof of valid catching, but they block unreviewed deletion.
- `wfm-sprint-candidate-source-qa.yml` still targets branches corresponding to merged PRs #822 and #823; the branches still exist and the workflow is available for manual dispatch. Owner must decide whether it remains a reusable template; no automatic retirement.
- **Evidence gap:** The connected repository is **not code-search indexed**; connector code-search returns no results even for known files. The per-workflow `actions/workflows/{id}/runs` API is blocked by the available read connector. The global run listing was sampled but cannot prove 90-day inactivity or absence of meaningful earlier failures for every file. The shell `git fetch` could not resolve GitHub in the available container. A separate isolated QA sandbox full clone was denied by the account's usage limit. Therefore **full-repository filename-reference proof and complete per-workflow 90-day receipts are unavailable**; do not interpret unsearched files as unreferenced.
- No production, Neon, SQL, secrets, payout, agency submission, deployment, protected YAML, or runtime flags were accessed or modified. The only proposed repository change is this existing engineering documentation, so the owner can decide which candidate merits a future evidence-complete deletion PR.

### Required follow-up before deleting a single file

On a runner with a complete clone and `gh` access: `git fetch origin main`, check out the exact reviewed main commit, run `git grep -n -F '<workflow-filename>' -- .` including tests/docs/scripts/workflows, then use `gh api` for the referenced issue/PR, branch ruleset and all 90-day workflow runs; inspect failure details and any reopened follow-up. Submit a separate YAML-deletion PR only when every gate is evidenced. Manual-dispatch-only workflows should not be removed as a queue optimization without an independent value assessment.

## October 25 follow-up — dependency-proven holds (no YAML deletion)

The requested second-pass cleanup did **not** identify a file meeting all four removal criteria. These specific checks supersede any assumption that closure of an issue/PR alone makes its workflow dead:

| Candidate | Direct evidence | Disposition |
| --- | --- | --- |
| `repair-security-pr-candidate.yml` | Its job hard-gates on PR #1302 or #1303, both **merged**, but `.github/ci-queue-policy.json` still names this workflow under `protectedExceptions`. That JSON is not documentation and may not be edited in this YAML/deletion-only cleanup. | **Do not delete**: active repo reference |
| `issue-1031-schema-only-hr-cases-rehearsal.yml` | `tests/issue-1031-schema-only-hr-cases.test.mjs` reads this exact YAML pathname. | **Do not delete**: existing test would break |
| `issue-1031-schema-only-it-assets-rehearsal.yml` | `tests/issue-1031-schema-only-it-assets.test.mjs` reads this exact YAML pathname. | **Do not delete**: existing test would break |
| `a4-a5-source-inventory.yml` | `tests/a4-a5-source-inventory.test.mjs` loads the YAML directly to verify SHA/PR-base safeguards. | **Do not delete**: test dependency |
| `wfm-sprint-candidate-source-qa.yml` | Push triggers are hardcoded to two source branches associated with merged PRs #822 and #823; the branches still exist, and manual dispatch remains available. PR #822 documents an initial source QA lint failure before green. | **Owner judgment**: cannot conclude the historical failure is disposable or the workflow is no longer a template |
| `issue-1019-stable-two-push-proof.yml` | #1019 is closed, but this workflow verifies a real pinned Drizzle second-push regression and cross-tenant schema/catalog protection. | **Owner judgment**: substantive ongoing regression value |

**Required status gate (ruleset 24862793):** `check`, `security-http-smoke`, `payout-payroll-isolation`, `Analyze JavaScript and TypeScript`. These required gates and all 15 explicitly excluded workflows plus both clean-baseline-cutover workflows remain untouched.

**Unresolved evidence limits:** The repository's connected code index does not return reliable results (even for known references), local Git cannot resolve GitHub, and the available GitHub API reader does not allow the specific per-workflow runs endpoint. Consequently, a trustworthy complete `git grep` reference absence proof and full ~90-day per-workflow failure/run history cannot be certified here. The GitHub repository was created on September 27, 2026; a full check from that date would cover all history. A candidate without these proofs is **not** a safe deletion. Do not claim any queue savings from this documentation-only update.

