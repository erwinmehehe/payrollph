# PayrollPH scheduler OFF -> ON -> OFF acceptance evidence

## Scope

This is a read-only, offline **structure** validator for evidence gathered after three approved manual staging health checks through the protected Payroll Scheduler Staging Health workflow, tracked under issue #637. The validator does not deploy, call GitHub or Vercel, execute a scheduler tick, change a feature flag, reconcile payroll, or certify anything.

A structurally valid manifest does NOT prove that the referenced GitHub Actions runs exist or belong to the correct workflow, that their reported outcome is genuine, that a real worker was healthy, or that an independent reviewer approved activation. These facts require separate human verification using GitHub and the private operations evidence register. Never treat this script's PASS result as permission to merge a high-impact PR, enable real payroll, migrate live employee data, or release a payout.

## Three witnessed staging observations

1. Independently review the exact backend code and monitor-workflow commit, using synthetic data in a controlled staging environment only. Confirm required staging reviewers, credentials, deployment identity and the separate central scheduler activation flag. The scheduler must be OFF initially.
2. From protected main, an authorized operator runs the manually dispatched health workflow with expected_scheduler_state = disabled. Confirm the independently inspected deployment SHA matches the actual staged backend and the authenticated status GET returns HTTP 503 with scheduler-disabled. Record the real run URL and UTC timestamp privately.
3. Only after separate staging approval, the operator changes CENTRAL_SCHEDULER_ENABLED to true on the isolated scheduler runtime and starts the approved worker or cron. Run the same protected workflow with expected_scheduler_state = enabled. Confirm HTTP 200 plus an internally consistent fresh completed-tick receipt and recognized lease status. Record the actual run and time.
4. Turn the scheduler OFF again WITHOUT deleting the previous completion history. Repeat the protected monitor workflow with expected_scheduler_state = disabled. Confirm HTTP 503 and scheduler-disabled despite that prior healthy receipt. Record a third distinct real run and time.
5. Copy scheduler-staging-evidence-template.json into a **private** evidence folder, replace every placeholder with inspected values, and run the validator locally. No authentication tokens, staging hostnames, IP addresses, employee names, payroll amounts, bank details or raw HTTP response bodies belong in this JSON.
6. A separate authorized reviewer must independently inspect all three real GitHub Actions runs, their protected environment approvals, successful branch and workflow identity, deployment metadata, selected modes, runtime configuration and timestamps. Witness actual multi-worker restart, idempotency and alert delivery independently and retain approval evidence in the private process.

## Command

From the repository root with Node.js 22 or later:

    node scripts/validate-scheduler-staging-evidence.mjs /private/path/staging-observations.json

The script reads one bounded regular file (maximum 16 KiB), does not follow final symlinks, refuses unexpected fields and prints only fixed pass/fail codes. The JSON template intentionally contains placeholders and MUST fail validation until genuine witnessed runs exist.

Standalone unit tests:

    node --test tests/scheduler-staging-evidence.test.mjs

The dedicated GitHub PR test workflow runs these unit tests OFFLINE only; it never receives the protected monitoring token or reads a filled private evidence manifest.

## Validation boundaries

The strict schema requires exactly three distinct GitHub Actions run URLs for erwinmehehe/payrollph, all successful by the operator's recorded assertion, timestamps in increasing UTC order within 24 hours, the same exact 40-character deployed SHA, a consistent preview or staging environment, and the corresponding OFF (503/scheduler-disabled), ON (200/healthy), OFF (503/scheduler-disabled) outcome. It rejects foreign run links, extra fields, unexpected production environments, timestamp anomalies, and oversized, invalid, symlinked or non-regular files.

A valid JSON manifest is **not** authenticated by the script. GitHub run IDs, results and exact deployed commit must be checked separately. Do not store real evidence as a committed repository file or upload it as a CI artifact.

## Open release gates

The full gate in issue #637 remains OPEN until actual isolated staged worker/cron operation, independent two-worker failover and restart observation, task idempotency, watchdog alerting and real employer payroll evidence where required. Compensation, database, security, bank, privacy and payroll-specific approvals (#630, #112 and #579) remain independent and cannot be replaced with a structured file or synthetic CI check.
