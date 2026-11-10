# Tenant isolation — Automation Studio quarantine, triage, retry and replay (2026-11-10)

**Review candidate, fictional PG16 only. ZERO additional API-method credits. No production or tenant-wide acceptance.**

## Distinct evidence scope

Merged #1906 proves Studio draft creation and template writes. Separate #1907 tests publish, rollback and active-state changes. This independent follow-up tests the remaining non-model execution-recovery paths of the same `POST /api/automation-studio` route without changing that route or any shared manifest.

The dedicated [execution proof runner](../../scripts/qa/tenant-studio-execution-http.mjs) starts with an empty disposable PostgreSQL 16 `app_db` and real signed-in sessions for two fictional employers (A and B), seven distinct filler employers and a higher-ID victim. Each owns a genuine via-HTTP rule and synthetic, persisted failed execution snapshots. A and B own real quarantined cases, seven filler quarantines create a persisted ID floor, and the victim owns separate genuine failed executions and a real higher-ID dead-letter case.

### Required successful own paths

For each independently signed-in owner:

- HTTP **201** quarantine of an actual failed execution step into a real, tenant-owned dead-letter case; repeated quarantine is **200**, idempotent, and makes **no new writes**.
- A retry against an **open** dead letter fails; HTTP **200** human case acknowledgement clears that gate and stores an audit entry.
- HTTP **200** failed-step retry runs only a safe-listed `revoke_sessions` step for a fictional employee with **no linked login**, completes the same execution, and writes one own-tenant audit entry.
- HTTP **200** case resolution, followed by **200** reopen, with actual case state, audit and unchanged underlying execution.
- HTTP **201** safe stored-snapshot replay of a separate failed execution with only the same idempotent action; this creates a **new own-tenant** completed execution and one audit event.

Every positive must match persisted organization, rule, employee, case, execution and audit records, not a fabricated success response. No worker, payroll, bank, vendor or message integration is run.

### Negative and privacy checks

Each attacker submits real victim and other-attacker case/execution IDs across quarantine, case transition, retry and replay, then repeats with an actual foreign organization selector. All are denied with genuine 403, 404 or 409 statuses, **without changing any protected employer SQL or audit rows**. Malformed inputs, repeated completed retries, open-case bypass, completed-execution replay, cross-site and anonymous calls fail closed.

Both natural-language actions (`draft-from-language` and `save-language-draft`) are explicitly tested to return **403** with the language rollout gate OFF. This is **not** a positive language-proposal test and the model/credential path remains disabled.

## Safe runner configuration

The proof inherits the existing Studio draft/triage environment interlocks and additionally requires `TENANT_STUDIO_EXECUTION_PROOF=fictional-pg16-only`, `AUTOMATION_LANGUAGE_STUDIO_ENABLED=false`, and `OPENAI_AUTOMATION_DRAFT_ENABLED=false`. The route, action executor and operational-case code are exact-Git-blob pinned before application/DB import.

GitHub Actions compiles Next locally in production mode but operates only against a disposable PG16 service, synthetic keys, localhost origin and fictitious identities. Workers, scheduling, payment and external providers stay OFF. The completed run emits `TENANT_STUDIO_EXECUTION_HTTP_COMPLETE` only after exact positive/denial/immutability checks.

## Review gates

- [ ] Exact-head contract, production build and all real-HTTP execution tests pass; no skipped positive path.
- [ ] Standard CI, CodeQL, source/inventory and security checks pass at the final PR head.
- [ ] Independent identity/automation security review confirms idempotence, true own execution transitions, cross-tenant immutability and zero external egress.
- [ ] Reconcile current `main` and any overlapping PRs before maintainer approval.

**Still unproved:** successful natural-language proposal/receipt/save flows under a completely fictional, model-disabled but controlled local synthetic profile, and a whole-method combined acceptance matrix. `POST /api/automation-studio` remains **GAP / testedBy null / zero new credits**. No live credentials, customer/employer data, external calls, payroll processing, payout, production workflow activation or deployment.
