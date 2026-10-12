# P0-4 — Historical prerequisite recovery and incident reconciliation

**Date:** October 12, 2026. **Production release: BLOCKED.**
This is a source-backed structural rehearsal and an evidence inventory.
Do not infer historical applied-status receipts from a successful test.

## Correct target identity (independently read back)

- Neon project: `neon-almond-ridge` / `calm-wave-70219564`.
- Production default branch: `br-lucky-sound-b79i56jw`, name `main`,
  `default=true`.
- Production endpoint: `ep-cool-hat-b7e7gpoo`, still targeting that exact
  branch ID, database `neondb`, PostgreSQL 18.
- Branch `main`: 112 public tables; core `organizations`, `employees`,
  `payroll_runs` and `payroll_entries` exist.
- There is **no verified numbered applied-SHA journal** to establish
  historical migration execution. Never fabricate `applied` or
  `baseline-included` receipts from object names alone.

## Historical missing-object plan

The current source contains numbered SQL **already merged in GitHub**.
The correct live Neon target lacks their intended objects:

| Source file | Live object gaps | Disposition |
| --- | --- | --- |
| `0022_job_architecture_positions.sql` | `job_profiles`, `positions`, `position_assignments` (but `workforce_plans` exists) | Partial structural adoption; reconstruct against restored clone |
| `0050_hcm_core_worker_history.sql` | `worker_employment_events` and associated position/assignment evolution | Must follow 0022; cannot backfill unrecorded history by creating empty table |
| `0110_provider_events_inbox.sql` | `provider_events` | Source present, DB absent; unique replay and tenant acceptance required |
| `0112_wfm_operational_demand_observations.sql` | Import batches and observation revisions | Source present, DB absent |
| `0113_wfm_issued_demand_forecasts.sql` | Forecast issues and scores | Must follow 0112 |
| `0114_wfm_demand_staffing_policies.sql` | Staffing policies and policy events | Depends on job profile foundation from 0022 |

The exact-source reconstruction sequence is **0022 → 0050 → 0110 →
0112 → 0113 → 0114**. This is an *isolated rehearsal ordering only*,
not permission to replay six historically numbered files against a live
database. Direct production replay would both violate adopted-history
policy and fail to establish historical human/employer data.

An existing nondefault Neon lab branch `br-aged-mouse-b7tipaw5` had
124 public tables: 0022 job profiles and positions, 0110 provider
inbox and 0112–0114 WFM objects were present. `worker_employment_events`
from 0050 remained absent. Its source tables for positions and
position assignments contained **zero** rows at inspection. No new
writes were performed to that lab during this evidence pass.

The new `tests/historical-prerequisite-reconstruction-postgres.test.mjs`
executes the **exact six existing SQL source files** against local
disposable PostgreSQL16 and PostgreSQL18, inside a transaction on a
Drizzle-generated synthetic baseline, including a missing-job-architecture
failure test and full rollback of catalog/payroll row counts. It never
connects to Neon and does not record an applied receipt. The focused CI
workflow provides no production database URL or credentials.

## Production incident #899 — stronger write-state evidence

An earlier snapshot restore briefly reassigned the project's default
branch and original endpoint at about 05:30–05:32 UTC. These identities
were immediately restored and separately verified.

To investigate persisted writes without copying confidential values,
an **isolated read-only endpoint** `ep-late-glitter-b7yjzv6z` was
attached only to restored branch `br-jolly-term-b7mzd0n2`. Production
default and original endpoint were verified unchanged before/after
creating that endpoint.

Compared **all 112 public relations** on restored snapshot and original
production `main` using *server-side* row digests and exact row counts:
**112/112 matched, covering 2,034 total rows**; no original data values,
bank details or employee records were returned. Also checked all **112
sequence last-value states** and metadata digests for column definitions,
constraints and indexes; all matched. Both sides had 8 employees, three
payroll runs, 18 payroll entries, three audit events, 16 time punches,
six organization memberships and no job queue records.

This establishes **no persistent row/sequence/catalog divergence at the
time of inspection**. It does **not** prove zero failed HTTP requests,
brief connection timeouts, rolled-back writes or acceptable RTO/RPO.
Operational incident #899 must remain open until request/worker-side
logs and retries can be independently reconciled. The restored branch
expires 2026-10-13T06:00:00Z.

## Backup/retention capacity remains an external release blocker

Neon's project currently reports Free `free_v3`, **10 / 10 branches**,
a single retained manual snapshot and **no automatic snapshot
schedule**. A second snapshot request previously failed
`HTTP 422 snapshots limit exceeded`. Available history retention is
`21600` seconds (six hours). Do not delete the only retained snapshot
or a data-bearing branch simply to make a readiness test pass. Upgrade
or explicitly review quota/retention and an approved off-platform
encrypted backup before claiming production restore readiness.

### Safe release gates (none are waived by this PR)

1. Reconcile the original Drizzle SQL path+SHA manifest, live object
   definitions, partial runtime compatibility DDL and actual change
   records with an independent DBA. A recovered schema is not an
   applied-history receipt.
2. Build a separately reviewed **forward-only repair** for the missing
   structures after establishing an evidence-backed database baseline.
   Reconcile positions, employment changes and legal entity attribution
   rather than fabricating a worker-history row set.
3. Verify live payroll centavo balances employee by employee, tenant
   boundaries, bank encryption and the source of any historical
   employment/legal-entity changes. If an assignment cannot be proven,
   fail closed; do not infer a primary employer.
4. Prove independent encrypted restore and controlled RPO/RTO on a
   nonproduction target using a `finalize:false` process that can
   never swap Neon main (PR #901).
5. Rebase canonical P0-4 proposed 0115–0121 train (PR #865) only after
   predecessor repairs and strict journal adoption, and require exact
   current-head CI and independent payroll/business acceptance.

**No production migration, payroll payout, bank account modification,
or approval bypass was performed as part of this work.**
