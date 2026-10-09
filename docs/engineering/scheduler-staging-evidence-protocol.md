# PayrollPH scheduler OFF -> ON -> OFF acceptance evidence

## Scope

This is a **read-only, offline structure validator** for evidence gathered after the three approved manual staging health checks in PR #643, tracked under issue #637. It does not execute a scheduler tick, deploy anything, query GitHub, change environment settings, reconcile payroll, or assert independent approval.

The script does **not** verify the authenticity of claimed GitHub run results, the genuine runtime environment, the reviewer's identity, or the correct operation of a real two-worker service. The operations and security reviewers must verify all these separately. Never use this manifest alone to authorize payment, migration, production scheduler activation, or employment changes.

## Procedure

1. Complete independent security review of the exact PR #643 code and stage only the independently approved PR #632 backend with synthetic data.
2. An authorized operator runs the protected GitHub Actions workflow **Payroll Scheduler Staging Health (Manual)** three separate times: expected **disabled**, expected **enabled** (after a separate authorized stage-only switch and real worker/cron run), then expected **disabled** again after switching off without erasing completion history.
3. Copy `scheduler-staging-evidence-template.json` to a **private operator evidence register**. Fill in the verified staging deployment SHA, actual three GitHub Actions run URLs, UTC observation timestamps, deployment environment, and observed status/state values. No tokens, hostnames, salary data, employee records, bank details, IP addresses, or credentials belong in this file.
4. Run from the repository root using Node 22+:

   `node scripts/validate-scheduler-staging-evidence.mjs /private/path/scheduler-evidence.json`

5. Verify the three GitHub Actions run pages **independently**, checking run branch, protected environment approval, completed outcome, exact job type, deployed SHA, step timestamps, worker flag changes, and actual staged backend. Have an independent operations/security reviewer sign off via the approved private process. Archive the real run IDs and any approvals privately.
6. The gate remains **OPEN** until genuine independent two-worker staging and idempotency evidence exists, plus all payroll/security/DBA/privacy gates in #637, #630, #112 and #579. Do not merge or enable production scheduling merely because this validation passes.

## Rejected evidence

The validator rejects any unexpected field, malformed or duplicated GitHub Actions link, remote/non-staging environment, missing or mismatching SHA, missing/off-order observation, failed run, incorrect HTTP/state combination, malformed or out-of-order UTC timestamps, observations spanning over 24 hours, non-regular file, oversized JSON, and symlink to an external evidence file. It prints only fixed result codes; it never logs manifest contents.

## Local test

`node --test tests/scheduler-staging-evidence.test.mjs`

The template deliberately contains placeholders and will **not** validate until actual independently witnessed observations are recorded. Do not replace placeholders with invented evidence.
