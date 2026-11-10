# Approval flows tenant boundary proof

`PATCH approvals/[id]` decides many kinds of approval through one handler. Three proofs already cover part of it:

| Proof | Families |
| --- | --- |
| `tenant-approval-task-http.mjs` | Plain tasks with no source |
| `tenant-approval-sources-http.mjs` | Leave requests and generic approval-chain steps |
| `tenant-money-lifecycle-http.mjs` | Payroll-run approvals |

This proof (`scripts/qa/tenant-approval-flows-http.mjs`, workflow `.github/workflows/tenant-approval-flows-http.yml`) adds the four families none of them reach:

| Family | How the fixture is made | Own decisions proven |
| --- | --- | --- |
| HCM business process | The real `startHcmBusinessProcessTx` (two-step default policy) | HR approves step 1, a second owner approves (attacker A) or declines (attacker B) step 2 |
| Workforce staffing scenario | A submitted scenario and a real chain instance of type `workforce_plan_scenario` | Approve (A) and reject (B); the scenario row and its audit follow |
| Governed roster-claim handoff | A real open shift and pending claim, fingerprinted by `loadGovernedHandoffSource` | Approve (A) and decline (B) |
| Automation approval gate | An execution waiting on an approval task | Declining fails only the deciding employer's own execution |

## What it runs

Production-mode Next on localhost against a fresh disposable PostgreSQL 16, every provider and worker off. Two attacker employers, seven filler bundles, then a victim created last, so every victim task, scenario, claim and execution ID exceeds both attackers' IDs and six. In each employer the owner initiates every flow, and a separate HR member and second owner decide.

1. **Victim positives.** The victim decides its own control row in every family, proving each path is reachable.
2. **Foreign task IDs.** Each attacker's owner, HR member and second owner are refused (404) on the victim's task in all four families, with and without a forged `organizationId`.
3. **Forged pointers on the attacker's own tasks.** An HCM process naming the victim's worker, a scenario chain naming the victim's scenario, and handoff evidence naming the victim's real roster claim (with its true fingerprint) are each refused with 409 for the exact expected reason, and the task stays pending.
4. **Maker-checker.** The initiating owner cannot decide the own HCM process, scenario or handoff (403).
5. **Own decisions**, each carrying forged body selectors that name the victim. Each result must name the deciding employer's own task, actor and flow.
6. **Replays** are 409 and change nothing.

Before and after each group, every employer's rows in all organization-scoped approval, leave, payroll, audit, HCM, workforce, automation, employee, webhook, open-shift, shift and worksite tables are compared row by row. After both attacker journeys the victim is identical to the moment after its own control decisions.

## Mutation evidence

Four employer-scoping rules of the real application were each removed, the app rebuilt and the proof run, then the file restored. Every one was caught by the assertion meant to catch it:

| Rule removed | Caught as |
| --- | --- |
| Membership join and membership check on the task lookup | A foreign task answered 403 instead of the uniform 404 |
| Employer filter on the HCM worker lookup | A process naming the victim's worker was decided (200, expected 409) |
| Employer filter on the scenario lookup | The refusal came from a different guard than the expected "not linked" one |
| Employer filters in the roster-claim source loader | A handoff naming the victim's claim was decided (200, expected 409) |

The last one first survived: a forged approval carried a fingerprint that bound the victim's employer, so the loader's own check rejected it anyway. The fixture now carries the fingerprint the loader would compute under the attacker's employer, so only the employer filter stands in the way, and the restated fingerprint recipe is asserted equal to the real loader's. The unmutated run passes from an empty database.

## What it does not prove

- It is a proof, not a credit: `coverageCredits: 0`. The ledger keeps `PATCH approvals/[id]` as GAP.
- **Not exercised:** Dynamic Group routing, approver delegation, the multi-entity group-HR refusal, separation-readiness handoffs (only roster claims), HCM processes with a real source (compensation proposal, effective change, position), an approved automation gate that continues a workflow, and concurrent decisions.
- **Hardening note, not closed here.** `resumeAutomationExecutionFromApproval` finds the waiting execution by approval-task ID only, with no employer filter. Task IDs are globally unique and the engine only ever stores its own employer's task ID, so no HTTP request reaches another employer's execution; the function should still take the employer ID.
- Independent security review stays PENDING.

## Running it locally

Needs a disposable PostgreSQL 16 on `127.0.0.1:5432` with the reviewed baseline applied (`node scripts/qa/local-tenant-proof-db.mjs --reset`), a production build, and the environment the workflow exports. The workflow is the reference.
