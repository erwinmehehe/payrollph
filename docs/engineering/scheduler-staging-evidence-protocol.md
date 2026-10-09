# PayrollPH scheduler OFF -> ON -> OFF acceptance evidence

## Scope

This package provides a **read-only offline structure validator and optional authenticated GitHub Actions metadata verifier** for evidence gathered after the three approved manual staging health checks in PR #643, tracked under issue #637. The offline validator never queries GitHub. The optional metadata verifier calls only fixed GitHub REST GET endpoints using an operator-supplied, Actions-read-only token. Neither tool triggers a scheduler, deploys anything, changes environment settings, reconciles payroll, or asserts independent approval.

The offline script cannot verify the authenticity of claimed GitHub results. The optional provenance checker confirms workflow, branch, SHA, completed jobs and liveness step outcomes from GitHub; it still cannot prove the actual selected input if GitHub does not expose it, the genuine runtime environment, independent reviewer identity, or the correct operation of a two-worker service. The operations and security reviewers must verify all these separately. Never use this manifest alone to authorize payment, migration, production scheduler activation, or employment changes.

## Procedure

1. Complete independent security review of the exact PR #643 code and stage only the independently approved PR #632 backend with synthetic data.
2. An authorized operator runs the protected GitHub Actions workflow **Payroll Scheduler Staging Health (Manual)** three separate times: expected **disabled**, expected **enabled** (after a separate authorized stage-only switch and real worker/cron run), then expected **disabled** again after switching off without erasing completion history.
3. Copy `scheduler-staging-evidence-template.json` to a **private operator evidence register**. Fill in the verified staging deployment SHA, actual three GitHub Actions run URLs, UTC observation timestamps, deployment environment, and observed status/state values. No tokens, hostnames, salary data, employee records, bank details, IP addresses, or credentials belong in this file.
4. Run from the repository root using Node 22+:

   `node scripts/validate-scheduler-staging-evidence.mjs /private/path/scheduler-evidence.json`

5. Optionally verify GitHub's real run/job metadata with a **fine-grained Actions:read-only token** supplied privately as `GH_TOKEN` from the operator's credential manager (not as a CLI argument and never in GitHub PR CI):

   `node scripts/verify-scheduler-github-runs.mjs /private/path/scheduler-evidence.json`

   The checker calls only `api.github.com/repos/erwinmehehe/payrollph/actions/...` with bounded, nonredirecting GET requests, checks completed manual runs on protected `main`, matching workflow revision and step results, and prints fixed success/failure codes without raw response data. It does not trigger any workflow. No GH_TOKEN is configured in the offline PR validation workflow.

6. Verify the three GitHub Actions run pages **independently**, checking the *actual selected dispatch input* for each phase (even if API inputs are unavailable), protected environment approval, deployed SHA, actual worker flag changes, and stage backend. The metadata checker alone does not verify protected environment policy or payroll correctness. Have an independent operations/security reviewer sign off via the approved private process. Archive the real run IDs and any approvals privately.
7. The gate remains **OPEN** until genuine independent two-worker staging and idempotency evidence exists, plus all payroll/security/DBA/privacy gates in #637, #630, #112 and #579. Do not merge or enable production scheduling merely because this validation passes.

## Rejected evidence

The validator rejects any unexpected field, malformed or duplicated GitHub Actions link, remote/non-staging environment, missing or mismatching SHA, mismatched staging/preview environment across phases, future timestamp, missing/off-order observation, failed run, incorrect HTTP/state combination, malformed or out-of-order UTC timestamps, observations spanning over 24 hours, non-regular file, oversized JSON, and symlink to an external evidence file. It prints only fixed result codes; it never logs manifest contents.

## Local test

`node --test tests/scheduler-staging-evidence.test.mjs`

The template deliberately contains placeholders and will **not** validate until actual independently witnessed observations are recorded. Do not replace placeholders with invented evidence.

## Pull request tests (no secrets)

The repository's `Scheduler Evidence Validators (Offline)` pull-request job runs both test files with **synthetic** JSON and mock GitHub HTTP responses. It does **not** set `GH_TOKEN`, query GitHub, contact staging, request production secrets, upload operator evidence, or dispatch workflows. Check its exact-head success before accepting these tools for use. Real operator manifest files and token configuration stay outside git.
