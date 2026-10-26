# Compliance Evidence — local-only tenant proof

Base: main `2f90cd458c65a0902332837e579ac7196b0ab5b9`, merged before acceptance.
Separate worktree/branch; no overlap with #1402, #1409, #1418–#1421 or #1423.
All fixtures are fictional. No agency, email, provider or money action is invoked.

| Method | Bounded operation and persisted evidence |
| --- | --- |
| POST compliance/validate | Audit a local filing preflight. Exact employer name/worker marker, populated employee counts, five checks and actor-bound audit. The response and audit must say portalValidated=false. |
| POST compliance/filing-validations | Record generated BIR 1601-C draft evidence from an owned synthetic final-cutoff register. Independently expected CSV bytes/hash, run/entity/count/amount identity and exact audit; no submission or agency acknowledgement. |
| POST compliance/labor-inspection/drills | Persist a report with its own missing-pay-profile worker finding, exact snapshot hash/summary/section counts and audit. A blocked drill is a successful report creation, not compliance certification. |

The shared runner retains two independent attackers, genuine higher-ID victims,
exact own success, victim 403, a forged victim run under the own employer returning
404, independent persisted-state discrimination and unchanged victim DB/audit.
Per-row snapshots preserve source workers, payroll runs/entries, remediations,
other evidence and all existing audit business fields. The fixture's Released
register is direct fictional seed data; no payroll is calculated, released or paid.

The supplied seven-candidate probe ran first on unchanged application source at
main `f5aa4afa4`: 168 writes inventoried; 1 works, 3 needs fixture, 3 validation
errors, 161 manual-review holds, 0 unavailable, 0 credits. Its seven candidates
already had implementation owners, so none was duplicated. These three methods
are manual-review discovery candidates, not falsely claimed automatic probe wins.

## Explicit family isolation

`TENANT_TABLE_FAMILY=compliance-evidence` runs all and only these three source-catalogued
rows. Missing/invalid/unknown families or runtime/source row mismatches fail closed.
Without the variable, CI still runs the complete existing table. Existing cited
HTTP assertion text and line numbers remain unchanged. The success receipt labels
the family; it never claims the rest of the catalog executed locally.

Generate credits only after a strict fresh-database run:

`node scripts/qa/tenant-table-credit.mjs --family compliance-evidence --run-label "<actual local receipt>"`

The family selector prevents unrelated pending GAP rows from receiving credits.
Existing curated evidence retains its owner/scope/receipt. `--check` is read-only;
`--refresh-links` still grants no new credits. Review the resulting three method
changes and computed inventory totals before pushing.

## Execution and acceptance

Initial strict HTTP run passed: 3 rows, 6 own/foreign pairs, 3 discrimination proofs,
2 forged-reference proofs and unchanged victim DB. The first filing attempt exposed
quoted CSV cells in the exact-byte expectation; the fixture was corrected without
loosening its hash check. The drill fixture explicitly omits a fictional worker's
pay profile so the report contains a deterministic, truthful own-worker finding.

Mutation check actually replaced the first row's expectation with a no-op: the
runner failed with `expect accepts another employer's data`. That mutation was
removed before acceptance; no mutation-mode result earns credit.

The post-sync fresh-DB strict run on executable source
`49d5b9ed3d848711c5fd49cbd295b4fbc8058d55` passed all three rows,
six own/victim pairs, three discrimination checks, two forged-reference checks,
and unchanged victim DB/audit. Receipt: local `outputs/compliance-fresh-http.log`.
Only this family's three credits were generated with `--family compliance-evidence`;
unrelated pending methods retain GAP and prior proof ownership is preserved.
The final reviewed-head repeat and exact commit are recorded in the draft PR
and local outputs. CI is **not yet run** until a real exact-head result exists.
All coverage is provisional and bounded to Owner/default profile, BIR draft
generation and inspection/preflight reporting. Other principals, agency formats,
portal acceptance, statutory correctness and production are not certified.

No production SQL, Neon/Vercel operations, real credentials, provider calls,
feature/money flags, runtime guards or already-cited proof-line text change.
Keep this PR a draft; do not merge or mark ready without owner instruction.
