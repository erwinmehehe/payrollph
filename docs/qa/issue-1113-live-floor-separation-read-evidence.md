# Issue #1113 — authenticated Live Floor and separation read evidence

**Status: PR candidate, not yet accepted.** This file describes a **new** disposable-PostgreSQL/localhost automated acceptance slice. It does not prove a signed-in user visited the hosted app or that the deployed app is connected to the repaired development Neon database.

## Current evidence boundary

- [Issue #1113](https://github.com/erwinmehehe/payrollph/issues/1113) records that the fictional default Neon catalog now has 10 worksite-assignment columns including `decision` and 38 separation-record columns. Its latest source repair is merged in #1177. These are **schema receipts only**, not proof of authenticated browser access or release approval.
- On 2026-10-27, the Vercel **READY production-target** deployment `dpl_xp6ccdoz4S9uaKPRiHPDQfK3h5fZ` reported Git source `8c2b1c5216eeb46fa652455c0ddbb50fe5b6cc70`, matching `main` when checked. Deployment metadata does **not** verify the connection identity of the running database or provide authenticated UI evidence.
- **No customer data or production application database** may be used for this test. The existing `WFM Five-Worker Development Acceptance (No Money)` workflow uses `127.0.0.1:5432/app_db`, disposable PostgreSQL 16, five fictional workers, separate fictional users/tenants and a production-mode app at `127.0.0.1:3000`. It already has environmental guards; maintain them.

## Proposed exact-head synthetic HTTP assertions

The targeted #1113 block runs **after** the no-release WFM payroll journey, so the new draft separation fixture cannot change its payroll calculation. It creates one fictional allowed worksite assignment, a draft separation in each of two employers, and issues actual signed-session HTTP GETs.

| Surface | Allowed evidence | Denied and negative evidence |
|---|---|---|
| `GET /api/workforce/live-floor` | A owner gets five current-worker records in the bounded company-page count; A unit manager sees only their unit; B owner sees its distinct one-worker count. The full worksite assignment schema, including `decision`, must load. | A ↔ B employer switches 403; employee and payroll-only roles 403; no session 401; invalid page 400; revoked HR session 403; no other-tenant worker marker. |
| `GET /api/separation` | HR sees the genuine **draft**, un-released A separation through the full 38-column read; B owner sees only its own draft; foreign worker filters never reveal the B row. | A ↔ B employer switches 403; manager and employee 403; no session 401; revoked HR session 403; no foreign marker. |

For both APIs, the full synthetic separation and worksite-assignment rows must be unchanged **after** the GET and denial matrix. No financial mutation, final-pay compute, checker approval, salary change, payout, filing or SQL migration is performed. QA report deliberately retains `independentHumanUat: NOT_RUN` and `deployedAppUat: NOT_RUN`.

**CI entrypoint:** `.github/workflows/wfm-five-worker-dev-acceptance.yml`, step `npx tsx scripts/qa/wfm-five-worker-dev-acceptance.ts`; automated report path `qa-artifacts/wfm-five-worker-dev-report.json`. Wait for the exact PR head’s workflow to complete before describing tests as PASSED. This PR only extends the synthetic acceptance and does not add a production flag or deploy.

## Remaining actual deployed-UI and release gates — still OPEN

1. An authorized operator verifies the **running deployed SHA and its actual DB branch/endpoint identity**, through protected access without copying secrets or assuming the hosted alias targets the repaired fictional branch.
2. A consenting authenticated HR or Owner tester confirms Live Floor and separation UI load and absence of missing-column/500 errors in the intended isolated environment. Observe legitimate nonempty results and the correct selected employer.
3. Independently test anonymous, employee, manager/payroll-only where applicable, other-employer, revoked membership and employer-switch access at the **same deployed SHA**, checking that no worker/separation information leaks. Preserve sanitized timestamps, roles, status codes and screenshots privately.
4. Review the still-separate migration journal, DBA/production authorization and financial release gates. No historic SQL replay, protected schema apply, flag activation or live payroll in this PR.

**Disposition:** Do not close #1113 based on disposable synthetic tests or READY deployment metadata alone. Record exact-head CI receipts on the PR and keep this issue open until genuinely authenticated deployed acceptance and any independently required release evidence are attached.
