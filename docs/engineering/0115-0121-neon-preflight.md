# 0115–0121 catalog-only dependency gate — correct Neon project

**Status: NOT authorized to run on Neon main.** This document and the
matching `scripts/lib/pending-train-preflight.mjs` describe which
predecessor tables are present. They do not reconstruct historical SQL
execution, approve bank transfers, modify live tables, or manufacture
migration receipts.

## Verified read-only inventory — 2026-10-12

- Owner-confirmed project: `neon-almond-ridge`
  (`calm-wave-70219564`), original production default branch
  `br-lucky-sound-b79i56jw` named `main`, database `neondb`.
- 112 existing public tables; integer-ID `organizations`, `employees`,
  `payroll_runs` and `payroll_entries` present. Historical migration
  receipt/cutover journal has not been established.
- Existing parents for **proposed 0115 payout profiles**:
  `organizations`, `legal_entities`, `bank_templates`, `users`.
- Existing parents for **proposed 0116 payout ledger**:
  `organizations`, `employees`, `payroll_runs`, `payroll_entries`.
- The output tables `payout_profiles`, `payout_batches`,
  `payout_transfers`, and `payout_batch_transfers` are absent.
  Proposed 0115/0116 would CREATE them on a future reviewed target.
  Proposed 0119 Xendit ALTERs are **dependent on those earlier additions**;
  they cannot be applied directly to the present live schema.

### Historical prerequisites that still require actual adoption evidence

| Historical SQL | Required objects absent from live main | Why it matters |
| --- | --- | --- |
| 0110 provider inbox | `provider_events` | Provider events must be idempotent before any payout execution |
| 0114 staffing policy | `workforce_demand_staffing_policies` | Source train cannot assume preceding WFM state is present |
| 0022 job architecture | `job_profiles`, `positions`, `position_assignments` | Required parents for actual worker-history data |
| 0050 worker employment history | `worker_employment_events` | Required by sensitive proposed 0121 multi-entity backfill |

A `CREATE TABLE` in GitHub does not establish whether that SQL ran.
Replaying all earlier source migrations or creating empty placeholder
history can hide historical attribution errors. Do not do either.

## How to reproduce the read-only catalog check

Execute only the following statement through an approved SELECT-only
database role, on the separately verified intended branch:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

Supply the returned list to
`assessTrainPrerequisites(tableNames, approvedReceipts)`. The assessment
projects the **hypothetical source outputs** of 0115 and 0116 only after
their own preconditions are satisfied, identifies later steps dependent
on these hypothetical outputs, and reports unresolved 0022/0050 and
0110/0114 history. It always returns `safeToApply: false`, including
when catalog entries and receipts are claimed complete.

CI uses synthetic lists rather than Neon data or a production URL. The
new dependency tests run in the existing disposable PostgreSQL workflow.

## Safeguards and incident

The on-project snapshot quota rejected a second manual snapshot
(`HTTP 422 snapshots limit exceeded`). In an earlier test, the Neon
snapshot restore API's default `finalize:true` unexpectedly swapped
the default branch and production connection endpoint. This was
reversed and the original branch/default/endpoint reverified.
A request/write impact review remains **OPEN in issue #899**.
Do **not** use the default restore behavior again. Require an explicit
`finalize:false`, isolated-branch verification and independent
cutover approval for any future rehearsal. No production restore
operation is authorized by this document.

## Release acceptance still required

1. Obtain authentic per-file source SHA-256 and database/application
   runtime-DDL evidence for all historical SQL; do not infer receipts.
2. Design additive, reversible forward repairs for absent 0110/0114
   and the 0022/0050 job-history dependencies, with real data mapping
   and payroll centavo reconciliation for 0121.
3. Prove restore RPO/RTO, branch isolation and endpoint continuity on a
   permitted nonproduction target without swapping production default.
4. Rehearse exact SHA migration plan and app test suite against an
   isolated Postgres 18 branch; verify tenant permissions and RLS
   separately. CI PostgreSQL16 green does **not** establish Neon 18
   operational acceptance.
5. Maintain provider payout, bank-file delivery, payroll release and
   sensitive HCM/WFM feature gates **OFF** until separately accepted.

**Never invoke a production migration directly from this preflight.**
