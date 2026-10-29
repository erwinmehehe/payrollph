# Payroll draft creation intent and lost-response recovery

This change extends the worker audit recovery work from #1548 to creation of the payroll run itself. No payment, role, statutory or release gate is waived.

## Request contract

`POST /api/payroll-runs` accepts an optional `Idempotency-Key` of 16–128 bounded ASCII characters. The receipt key is hashed and namespaced by authenticated actor and organization. Its payload fingerprint binds the resolved legal employer, effective org-unit scope, exact cutoff/pay date and process-now mode. The receipt stores the run ID and hash, not a cached financial response.

Both existing creation screens preserve an uncertain attempt key in session storage before sending the POST. Reload and retry of the same details reuse it. A verified success retires only that key; an older response cannot erase a newer attempt. Unreadable/unavailable storage fails before another uncertain write. Existing keys are never rotated automatically just because a request timed out.

## Database serialization and audit

A transaction-scoped organization advisory lock serializes the receipt lookup, **second** period-overlap check, draft insertion, timesheet expectations, draft audit and receipt insertion. The early overlap check remains a fast path only. This also blocks overlapping concurrent drafts from legacy clients with no key or callers using different keys. Non-overlapping populations keep the existing legal-employer/unit rules.

All session, organization role, subscription, unit and legal-employer authorization/confirmation gates still execute before returning an existing run. The same key with different normalized details returns HTTP 409. A missing or mismatched saved run fails closed. Replays return HTTP 200 with the current authorized run and `idempotentReplay: true`; creation returns HTTP 201.

A committed process-now draft whose calculation handoff was interrupted is returned with `recoveryRequired: true` while Draft/Failed. Replay does not enqueue, calculate, repeat automation or grant approval. The operator resumes the existing run through its normal calculation controls. This does not implement killed-worker lease recovery.

## Executed evidence and boundaries

- Six focused tests pass, including a real local PostgreSQL 18 route-handler test against a new task-owned fictional database. The session adapter is controlled; membership, employer scope, overlap queries, transactions, audit triggers and receipts use real application code and PostgreSQL. This is not real-login HTTP certification.
- Two independent fictional callers and a populated higher-ID victim: genuine own creation/replay, actual victim employer refusal, stolen legal employer refusal, unchanged victim snapshots, same-key concurrency, changed-payload conflict and revoked membership.
- Concurrent different keys for one cutoff produce one creation and one conflict. An audit INSERT veto rolls back draft/audit/receipt; the same key succeeds after removing the fictional veto. A synthetic interrupted create is recovered without any calculation job or changed business snapshot.
- Negative control: restoring the original route made concurrent same-key requests return **201 + 201**, failing the regression. The fixed route returns **200 + 201** with one run/receipt/audit.
- Existing Chromium component harness passes at 1280px and 390px after aborting the first draft response, reloading the actual component, previewing again and proving identical retry headers plus recovered-draft feedback. Requests are mocked; these browser checks do not claim database or authentication proof.

The existing first-payroll PG16/PG18 workflow now executes these new tests and browser checks. New-head CI and the existing real-HTTP payroll/tenant workflows remain required before merge. The inventory changes only the modified route blob/declaration positions; existing proof provenance and method counts are preserved with **zero new credits**.

No migration, production SQL, existing development database reset, provider call, live secret, money flag, deployment or real-employer acceptance is part of this PR.
