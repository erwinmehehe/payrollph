# Web Bundy lifecycle: bounded fictional HTTP/PostgreSQL proof

This main-based batch proposes five distinct method credits, without changing
runtime handlers, schema, flags, existing family rows or cited shared proof lines:

| Method | Executed positive scope |
| --- | --- |
| POST web-bundy | Legacy clock-in, break-start, break-end and clock-out; duplicate actions refused |
| POST web-bundy/consent | First acceptance, unchanged replay, withdrawal/purge, first refusal; reacceptance blocked |
| POST web-bundy/evidence | All four staged punch actions and same-identity replay; conflicting identity refused |
| GET web-bundy/review | Nonempty scoped queue and real decryptable synthetic JPEG bytes with audit, no-store, same-origin and nosniff |
| POST web-bundy/review | Independent approval of all four actions into attendance, rejection, immutable decisions, maker/MFA/cutoff refusals |

## Evidence and boundaries

Native disposable PostgreSQL 16.14 on localhost 5435, production-mode Next.js
on localhost 3015. Bootstrap creates actual employers and employee/owner sessions
before server startup. Two legacy attackers and their victim are excluded from
the enhanced allowlist. A separate pair of enhanced attackers and genuine victim
are explicitly allowlisted. No wildcard or invented employer is used.

The source-bound [sanitized receipt](tenant-clock-receipt.json) records:

- 36 successful owned operations;
- 36 genuine victim-employer denials, 30 forged/ignored-selector checks;
- 40 additional negative cases and 18 cross-attacker discrimination checks;
- nonempty higher-ID victim employer/worker/submission fixtures;
- unchanged victim attendance, evidence, consent, photo, timesheet, exception,
  payroll/profile and business-audit rows after every positive and denial;
- actual attendance promotion after distinct-user approval; requester cannot
  review even when given a temporary fictional reviewer grant and valid MFA;
- missing MFA blocks photo access and review; payroll cutoffs block submission
  and approval, while rejecting evidence remains possible;
- consent withdrawal removes non-held encrypted image bytes and preserves held
  fixture bytes; subsequent retrieval of purged bytes is refused;
- own-byte image verification uses actual locally generated one-pixel JPEGs,
  not human images or a content-type-only success;
- a temporary no-op persisted-state verifier makes the live run fail with
  `proof accepts another employer's data`; restored proof passes.

Photos are **seeded fictional encrypted fixtures**, not uploads. Photo capture
policy remains OFF. Optional/required photo ingestion, a real malware scanner,
geofencing, overnight edge cases, device attestation and production operation
are NOT certified by this proof. No external scanner or provider is contacted.
All four staged punch actions are now executed; the historical DL-02 receipt
which only submitted clock-in is retained and cannot grant these new credits.

The runner issues zero credits. Generate only these five provisional entries:

```text
node scripts/qa/tenant-table-credit.mjs --clock --run-label "<executed receipt label>"
```

Starting main `e09ac116b` has 358 COVERED / 130 GAP / 10 PUBLIC of 498 methods.
This branch proposes 363 / 125 / 10, preserving every other method's provenance.
The frozen DL-02 method queue consequently has zero remaining method gaps; its
status is **PROVISIONAL — NOT ACCEPTED**, not production or security sign-off.
The global tenant-isolation ledger and remaining scoped-page gaps stay NOT ACCEPTED.

## Reproduction and CI

Local verification: 1,003 tenant tests passed / 7 skipped / zero failures;
67 existing clock-domain regressions passed / 1 CI-only migration case skipped;
32 focused receipt/inventory tests passed. Full lint has zero errors and 10
existing warnings; TypeScript, YAML, source-size and proof-pin checks pass.
Repin reports 1,737 unchanged citations, 25 new, zero repinned/requiring review.
An existing mainline repin test referred to the obsolete `victimUnchangedAt`
field; it now verifies the canonical `victimUnchangedLine` against the same
companion file and actual assertion, without changing historical receipts.

The dedicated `tenant-clock-lifecycle.yml` provisions fresh PG16, generates
ephemeral keys, bootstraps fictional employers, exports only their allowlist IDs,
builds and starts one localhost server, then executes the proof. It publishes
only `outputs/clock-run.json`. The private fixture contains ephemeral synthetic
sessions and is never an artifact or tracked file.

Local setup used a new task-owned cluster, never an existing developer database.
The local runner intentionally does not pretend to be GitHub Actions to bypass
the existing baseline guard. Only existing source-export/baseline fixture SQL is
applied to the fresh local database. There are no migrations or production SQL.

Fresh exact-head CI and independent review remain required. The existing
CI-owned app_db-only payout-export integration is NOT_RUN locally and is not
weakened. All source pins and counts are generated before review; no new entry
may borrow historical proof or be promoted merely because another job is green.
No merge, deployment, provider call, live flag change, payroll release or money
movement is authorized. Keep this PR draft until reviewed.
