# WRK-01 approved staffing policy GET — fictional cross-employer HTTP proof

**Status:** DRAFT / SOURCE + EXECUTABLE QA ONLY / ZERO NEW CREDITS. No production, employer, payroll or workforce activation. The overall tenant-isolation coverage inventory remains **NOT ACCEPTED**.

## Scope and exact method

`GET /api/workforce/demand-staffing/policies` with `mode=approved` is still a **GAP** in the live shared manifest. The earlier [draft-policy proof](../../scripts/qa/tenant-demand-governance-recovery-http.mjs) checks `mode=manage` and confirms that unapproved policies do **not** appear in default approved results; it does not demonstrate a populated, independently approved GET response. This addition targets **only that missing positive**. It does not credit this method and does not test the POST/PATCH policy handlers as real HTTP.

## Genuine disposable proof

The existing [guarded three-employer CI job](../../.github/workflows/tenant-demand-governance-recovery-http.yml) starts a production-mode **localhost** Next server on disposable PostgreSQL 16. The [new runner](../../scripts/qa/tenant-demand-approved-policy-get-http.mjs) refuses hosted targets, remote databases, real provider secrets, workers and money flags before application imports. It reuses the private 0600 fictional session fixture and independently seeds a real, higher-ID and **feature-allowlisted victim**.

For each employer, the runner creates an active Philippine worksite, a separate job profile, a fictional policy proposer and an independently distinct fictional checker. It executes the **application's actual draft, submit and approve lifecycle on synthetic rows**, producing a persisted approved-policy row, events and cryptographic receipt. The two attackers then independently GET their own populated approved policy, with a precise match to their own SQL policy ID, scope, source hash, checker receipt and non-cacheable HTTP response. Cross-employer source substitution cannot satisfy the proof. The victim's own authenticated GET is also a genuine success.

Each attacker receives exact 403 for (1) the victim's **real enabled organization**, (2) the real higher-ID victim worksite passed with the attacker's organization and (3) the real victim job profile passed with an otherwise valid own site. A forged victim `policyId` parameter cannot replace own results; anonymous requests receive 401, the non-allowlisted fourth employer 404 and invalid worksite selector 400. Denial bodies and headers are checked for victim markers. All four employers' policy, event, worksite, job-profile, membership, employee, pay-profile, schedule, audit and payroll-run rows are snapshotted after fixture setup and compared after the HTTP tests.

The [pure contract regressions](../../tests/tenant-demand-approved-policy-get-contract.test.mjs) deliberately alter policy identity, worksite, status, approval integrity, hashes, receipt, dates, response shape, caching, and denied responses to prove a misleading result fails the check.

## Evidence and decision boundary

- New exact-head workflow: **Workforce demand GET GAP recovery (fictional PG16 and localhost HTTP)**. The original draft-mode proof remains unchanged and runs first, with the new real approved-mode proof as a separate later step.
- No code change to `src/app/`, production API handlers, schema/migrations, payroll or policy approval permissions. No Neon queries or deployments.
- No shared coverage manifest change or automatic promotion. **0 new COVERED credits**, **0 certified batch closures**.
- Only after an **exact PR-head** successful localhost/PG16 job, required shared CI/security results, and independent security/coverage-owner verification should a separate reconciliation consider the exact `GET` method for provisional credit. The human operator/pilot/release acceptance gates remain outstanding.

**Do not merge or enable any real employer policy based on this QA.**
