# PayrollPH #853 — independent witness handoff (fictional, no money)

This offline companion is **not** a replacement for the existing product-owner self-UAT tool in `docs/qa/local-owner-wfm-journey-uat.md`. It records structured *references to observations* for privately independent witnesses, not the observations themselves. No operator or witness is authenticated by this script. **Even COMPLETE (UNVERIFIED) does not mean accepted or certified.**

## Freeze the test

Confirm a protected fictional development app, an exact **deployed** app SHA matching a clean Git checkout, test fixtures with two fictional employers A/B, PostgreSQL isolation, migrations, flags, rollback and private QA vault. A SHA in GitHub alone is not evidence of what the browser served. Never migrate or reset a shared Neon/dev database to perform QA. A new Vercel staging project is not automatically required for development testing.

Disable real payouts, provider/agency submission and notification flags. Test actual physical phones with real HR, WFM manager, employee, Payroll Officer, independent Checker, Owner and an observer different from every operator. Record actual names, consent, device/browser, expected/actual, timestamps, legal scope, screenshots, any defect and signature **privately**. Do not post those details, credentials, bank files, salaries or employee IDs on GitHub.

## Witness the same fictional worker through nine stages

| ID | Role | Required observation |
| --- | --- | --- |
| JOURNEY-01 | HR | Create fictional worker, preserve one ID. Direct HRIS creation is **not** an approved candidate-to-Hire-BP conversion. |
| JOURNEY-02 | HR | Onboard the identical worker and inspect the task outcomes without developer assistance. |
| JOURNEY-03 | Manager | Approve/publish governed roster; confirm effective worksite and worker visibility. |
| JOURNEY-04 | Employee | Generate real permitted in/out clock events for the **tested pay cutoff**; seeded historical entries are not proof. |
| JOURNEY-05 | Manager | Approve the matching attendance version; reject stale correction/cutoff edits. |
| JOURNEY-06 | Payroll | Calculate the same period and review wage, premium, deduction and statutory source trace. |
| JOURNEY-07 | Checker | A separate human independently reviews the submitted payroll and exceptions. |
| JOURNEY-08 | Owner | Release immutable **payroll records only**, never pay, transfer or payout instructions. |
| JOURNEY-09 | Payroll | Retain byte hashes of four **draft** filing worksheets; they are not official portal acceptance. |

Also observe all ten cross-cutting checks: owner and payroll officer on **physical** phones; both roles switch A → B → A without stale data; one worker ID; one tested clock-to-pay period; no developer driving; correction/cutoff reapproval; records-not-funds; separate hash-bound worksheet downloads.

## Offline capture — Node 22

From a **clean checkout** of the exact tested SHA:

```sh
node --test tests/independent-journey-853.test.mjs
node scripts/qa/independent-journey-853.mjs init
```

The private `qa-artifacts/independent-journey-853/manifest.json` starts with all 19 rows `NOT_RUN` and no deployed build evidence. It is Git-ignored and initialization refuses overwrite. Archive the old session in the protected private vault when the SHA changes; **never relabel previous PASS evidence**.

Fill the `runtime.deployedSha` only after observing the exact running build. Add *distinct* opaque `UAT-...` private evidence IDs for `appBuildEvidence`, `fixtureEvidence`, `flagEvidence`, `deviceEvidence`, and `databaseIsolationEvidence`. Each performed stage/check gets a unique private `UAT-...` reference plus an opaque `PERSON-...` operator and a different real `PERSON-...` witness. Use a constant operator alias for repeated roles. The manifest is **not a place for names, descriptions, salaries, signatures or screenshots**.

Sample observation row (replace only with a genuinely observed private evidence reference):

```json
{"status":"PASS","operatorRef":"PERSON-HR01","witnessRef":"PERSON-QA01","evidenceRef":"UAT-JOURNEY0101","defectRef":null,"blockerCode":null}
```

Use `NEEDS_FIX` with a unique `BUG-...` ID; use `BLOCKED` with a blockerCode of DEVICE, ENVIRONMENT, ROLE, DATA, REVIEWER or OTHER and null proof/actor fields; leave unexecuted rows `NOT_RUN`. Do not invent pass results. All safety fields must stay false.

```sh
node scripts/qa/independent-journey-853.mjs check
node scripts/qa/independent-journey-853.mjs report
```

The offline validator only checks structure, exact SHA matching, role alias separation, unique proof references, mobile/employer-switch status and no-money assertions. It **does not authenticate** reviewers, view private artifacts, run any browser steps or attest signatures. An incomplete check exits 2; a completed report still states **independent acceptance NOT ESTABLISHED** and **pilot NO-GO**. Keep the full evidence in an approved private vault; publish only sanitized status counts and opaque defect references to #853.

**Other gates remain separate:** #691 14 independently witnessed WFM scenarios (WFM-14 real hardware or NOT_RUN_EXTERNAL), #579 consenting employer payroll and zero unexplained > ₱0.01 variances with independent checker, #112/#744 production/privacy/DB controls, and genuine bank/agency acceptance. None is satisfied by synthetic or local manifest QA.
