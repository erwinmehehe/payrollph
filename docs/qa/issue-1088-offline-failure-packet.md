# Issue #1088 — operator-only offline synthetic failure packet

**Status:** partial Phase 3 engineering slice; advisory only. This is not AI patch generation, a security approval, production UAT, or a completed #1088.

## What it reuses

Run the existing manual [Exact-SHA QA Overview](../../.github/workflows/exact-sha-qa-overview.yml) on the exact 40-character commit you want to investigate. Download `exact-sha-qa-triage` and use its `qa-triage.json` as the *untrusted local input* to this validator. Do not substitute stale/current-branch CI, a guessed run ID, a queued job, or an independently manufactured PASS.

## Explicit operator steps (fictional/sanitized input only)

1. Confirm a reproducible **synthetic** CI failure and the exact reviewed source SHA. Keep the full failed run and failed job links. The operator must separately establish whether the purported failure reproduces; the tool does **not** execute the command.
2. Select one `FAILED` workflow entry with a matching, nonempty `jobUrl` from the generated exact-SHA triage JSON.
3. Write a local `failure-case.json` with **exactly** the eight allowlisted fields below. Replace the illustrative tokens with the actual *sanitized* values from the run. The workflow name must appear in the original `CHECKS` list; test files must be top-level `tests/*.test.mjs` or `tests/*.test.ts`.

```json
{
  "sourceSha": "<exact-lowercase-40-character-commit-sha>",
  "workflow": "CI",
  "runUrl": "https://github.com/erwinmehehe/payrollph/actions/runs/<actual-run-id>",
  "jobUrl": "https://github.com/erwinmehehe/payrollph/actions/runs/<actual-run-id>/job/<actual-job-id>",
  "testPath": "tests/exact-sha-triage.test.mjs",
  "reproduction": "node --test tests/exact-sha-triage.test.mjs",
  "errorCode": "ASSERTION_MISMATCH",
  "evidenceBoundary": "fictional-only-sanitized"
}
```

4. From a local clone with Node 22, run `node scripts/qa/issue-1088-offline-failure-packet.mjs path/to/qa-triage.json path/to/failure-case.json`. On success, it writes `qa-artifacts/qa-failure-packet.json` (private file mode when supported) and prints only `QA_FAILURE_PACKET_WRITTEN_OFFLINE`. On refusal it prints only `QA_FAILURE_PACKET_REJECTED` without echoing input.
5. A qualified operator can now manually execute the exact displayed reproduction command against an **isolated fictional test environment** and record observed before/after outcomes privately. No command is executed by the packet generator.

Allowed `errorCode` categories: `ASSERTION_MISMATCH`, `HTTP_STATUS_MISMATCH`, `DATABASE_FIXTURE_MISSING`, `ENVIRONMENT_UNAVAILABLE`, `SOURCE_SCHEMA_MISMATCH`, `UNKNOWN`. These yield only **suspected** test/setup classifications or **cause unverified**. They never establish root cause. For TypeScript files, the exact command must be `npx --no-install tsx --test tests/<name>.test.ts`.

## Guardrails and remaining work

- Refuses unknown fields (including pasted raw logs), wrong/queued/stale SHA, success/absent jobs, nonallowlisted paths or commands, external URLs, and nonfictional evidence boundaries.
- Reads only operator-supplied local JSON; does not call GitHub, any LLM, payroll APIs or databases. Does not execute the reproduction command, create branches/PRs, or access credentials. Passing local JSON alone does not independently prove a GitHub run occurred.
- Emits explicit `rootCause: UNVERIFIED`, `reproductionObserved: NOT_RUN`, `proposedPatch: NONE`, `modelCalled: false`, `branchMutation: false`, and `releaseAuthorization: NO_GO_NOT_EVALUATED`.
- Before any future opt-in model/patch phase, design separate credential/data-sharing approvals, reproducible failing-before / passing-after tests, source diff review, an explicitly authorized **draft-only** PR, current-head CI, and independent review. No auto-merge, auto-deploy, issue close, model call or real employee data.

Test locally with `node --test tests/issue-1088-offline-failure-packet.test.mjs`. Existing full CI will also exercise this `.test.mjs`; only an exact-head CI run, not this document, establishes repository validation.
