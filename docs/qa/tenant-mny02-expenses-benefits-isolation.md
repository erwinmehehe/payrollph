# MNY-02 — Expenses and de minimis tenant-isolation follow-up (draft / NOT ACCEPTED)

## Scope and decision

Six formerly GAP API methods have **provisional method-level proof only**, not global tenant acceptance:

| Method | Positive control | Foreign/forged negative |
|---|---|---|
| GET `/api/expenses` | Populated caller-employer claims, 200 | Real victim employer 403; forged victim employee selector cannot expand own results |
| POST `/api/expenses` | Persisted own employee claim, 201 | Foreign employer 403; own employer + real foreign employee 404 |
| PATCH `/api/expenses` | Independent same-employer checker rejection of created claim, 200 | Original maker denied 403; real victim claim ID 403, unchanged |
| GET `/api/de-minimis` | Populated caller-employer benefits, 200 | Real victim employer 403, victim benefit absent from owned result |
| POST `/api/de-minimis` | Persisted RR 29-2025 rice benefit, 201 | Foreign employer 403; own employer + real foreign worker 404 |
| DELETE `/api/de-minimis` | Own benefit ended, 200, persisted `active=false` | Actual higher-ID victim grant 403 and victim record unchanged |

The sole executable proof is [`scripts/qa/tenant-mny02-expenses-benefits-http.mjs`](../../scripts/qa/tenant-mny02-expenses-benefits-http.mjs), invoked directly by the existing guarded second-pass localhost production-mode server. Its source gate is [`tests/tenant-mny02-expenses-benefits-source.test.mjs`](../../tests/tenant-mny02-expenses-benefits-source.test.mjs).

## Evidence requirements

- PostgreSQL 16 `app_db`, disposable CI only; `SECURITY_SMOKE_URL=http://127.0.0.1:3000`. Require `CI=true` and `TENANT_SECOND_PASS_MODE=isolated-ci-only`.
- One fictional victim employer and **two independently authenticated attacker employers**. Both attackers first persist real owned claims and grants through successful HTTP POST. Seven victim-only claim and benefit rows are then persisted via valid HTTP and produce actual victim-only IDs greater than 6 and greater than both attackers' owned IDs.
- Two different fictional users in each attacker employer demonstrate independent expense maker/checker controls; the maker cannot reject its own claim. The same-employer checker successfully rejects and persists the result. Cross-employer and forged-employee writes must not modify the victim.
- Victim expense claims, de minimis grants, audit events and payroll runs are read from PostgreSQL before and after all denied/forged requests, with an **exact deep equality** requirement. Returned bodies and headers must not include the victim-only private expense sentinel.
- The six method-specific manifest entries link to precise positive, foreign-denial, high-victim-ID, and unchanged-DB source lines. The original 406-method frozen closure queue remains historical; this changes proof classification, not its schedule.

## Feature flags and operational boundaries

**Reviewed Spend feature-ON is NOT certified by this batch.** Expense GET/POST/PATCH are exercised under the legacy Spend flag-OFF mode only. The enhanced receipt-storage workflow, taxable category policies, independently approved reimbursement amounts, and any payout/reconciliation require their own feature-ON real-HTTP, SQL and object-storage acceptance. Do not treat this six-method proof as a release flag activation.

No live employees, bank credentials, external payout providers, payroll release, production database, statutory filing or real funds are used. An authenticated API denial or a source-only regex is never evidence of a working owned financial action by itself.

## Coverage ledger

| Metric | Prior merged main | This draft |
|---|---:|---:|
| API method inventory | 494 | 494 |
| Method-specific provisional COVERED | 149 | **155** |
| PUBLIC-BY-DESIGN | 10 | 10 |
| Remaining API GAP | 335 | **329** |
| Remaining page/action GAP | 18 | **18** |
| Confirmed live tenant leaks fixed by this PR | 0 | **0** |

**Overall tenant-isolation audit: NOT ACCEPTED.** Newly credited methods must pass exact-head Security HTTP Smoke, all mandated regressions and independent security review before merge. This document does not authorize deployment, payment or a production release.
