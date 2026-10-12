# Consolidated proposed SQL release train: 0115-0121

**DRAFT / DO NOT RUN ON NEON MAIN.** This is the canonical source-only
train in PR #865, not an approved historical migration replay. The last numbered
historical SQL on GitHub main is 0114. Old duplicate prefix groups remain
unchanged; an evidence-backed historical receipt journal with exact
source path and SHA-256 has NOT been adopted on Neon main.

## Canonical dependency order (all seven are newly numbered DRAFT files)

| Sequence | File | Source / dependency | Release boundary |
| --- | --- | --- | --- |
| **0115** | `0115_payout_profiles_foundation.sql` | Reconstitutes only the missing payout-profile CREATE TABLE/index statements from legacy 0074; adds a legal-entity tenant guard | Does NOT attest 0074 applied; default inactive bank-file profile |
| **0116** | `0116_payout_ledger_foundation.sql` | Carries exact guarded A-2 PayMongo batch, transfer and link schema from PR #893; follows 0115 | No money-out / provider authorization; no historical payout backfill |
| **0117** | `0117_inline_first_payroll_journey.sql` | Renumbered former #858/0115 | First-payroll workflow, authorization and migration test required |
| **0118** | `0118_wfm_roster_scale_rules.sql` | Renumbered former #859/0116 | Separate WFM manager/privacy acceptance |
| **0119** | `0119_xendit_payout_provider.sql` | Renumbered former #813/0117; now AFTER 0115-0116 | Xendit remains default-OFF; no provider keys or bank transfers |
| **0120** | `0120_wfm_punch_evidence.sql` | Renumbered former #856/0118 | Sensitive photo/location/device data, retention and security checks |
| **0121** | `0121_multi_entity_v2_scope_transfer.sql` | Renumbered former #860/0119 | Historical pay/employee backfills. Explicit BEGIN/COMMIT removed because the reviewed runner must own the full transaction |

The only renumbered files are the **five unmerged draft migration files
from PR #865**. No migration that has already been merged to main, included
in historical records, or applied in any actual database is renamed.

### Source handoff and PR dependencies

- Canonical branch: PR #865 itself. Old 0115-0119 unmerged draft
  reservations are retired on this branch; do not replay or cherry-pick
  them separately into main.
- PR #893 contains the original strengthened **unnumbered** A-2 payout
  candidate and standalone disposable PostgreSQL checks. Its guarded SQL
  has been copied verbatim into the new proposed 0116 after its comment
  header; its tests must be kept. Do not independently apply both versions.
  Resolve duplicate source paths before any merge.
- The original #894 source-only prerequisite work is superseded here.
  `scripts/lib/pending-train-preflight.mjs` now inventories the canonical
  0115-0121 steps, projects dependent CREATE outputs without treating them
  as applied receipts, and **never** authorizes database migration. Its
  source tests and a full-transaction PostgreSQL16 rollback rehearsal are
  included on this branch.
- Feature PRs #858, #859, #813, #856 and #860 must remove overlapping
  numbered SQL and depend on the canonical order; do not merge and apply
  standalone feature-local versions.
- Run the source history/SQL-prefix checks, focused payroll golden tests
  and dedicated disposable database rehearsal on the exact candidate SHA.

## What correct Neon MAIN currently proves — and does NOT prove

Correct project `calm-wave-70219564` / `neon-almond-ridge`,
original default branch `br-lucky-sound-b79i56jw` named `main`,
database `neondb`, PostgreSQL 18. This main branch has **112 public
tables**, including integer-ID core payroll; it is not the legacy UUID
database `ddbb`.

- On main `bank_templates` already has adapter metadata matching parts
  of 0074, but `payout_profiles` is **absent**. This is partial schema
  adoption, NOT evidence the whole 0074 ran. The new 0115 is proposed as
  a separately reviewed forward repair; it must not invent a receipt
  for 0074 or silently replay all its ALTERs.
- On main `provider_events` (historical 0110), `payout_batches`,
  `payout_transfers`, `payout_batch_transfers` (new 0116),
  `worker_employment_events` (required by sensitive 0121), and
  `workforce_demand_staffing_policies` (historical 0114) are absent.
  A successful 0115/0116 disposable test alone cannot prove main is
  ready for 0115–0121.
- `payrollph_release_migration_receipts`,
  `payrollph_schema_migrations`, and
  `payrollph_migration_cutover` are missing; historical application
  order/checksums are UNKNOWN. A historical receipt must be independently\n  adopted and verified by the DBA before a forward migration is authorized.\n  Do not mark any historical file
  `applied` from table names alone.
- Source declarations are more numerous than live objects and runtime
  compatibility DDL still exists in `src/lib/core-schema-compat.ts`.
  Do NOT run `npm run db:push` on production or replay the entire
  `drizzle/` folder in prefix order. An audited, restored-clone
  reconstruction and a forward-only execution journal are required.

## Restore rehearsal caveat / incident (2026-10-12)

A project snapshot `snap-red-sound-b798wnli` exists; its manual restore
operation defaulted to **finalize=true**, unexpectedly promoting a
new snapshot branch as the default `main` and reassigning the existing
production endpoint. The original branch, default flag and endpoint
were put back, and verified:

- Default branch `br-lucky-sound-b79i56jw`, name `main`.
- Original endpoint `ep-cool-hat-b7e7gpoo` points to that branch.
- Counts: 112 public tables, 8 employees, 3 payroll runs, 18 entries.
- Restored snapshot isolated as
  `br-jolly-term-b7mzd0n2`, expiring 2026-10-13T06:00:00Z.

**There may have been a brief connection interruption or writes routed to
the snapshot during the 05:30–05:32 UTC switch.** App and DB write logs
require a restricted incident reconciliation. The database restoration
did NOT produce an approved zero-loss production RPO/RTO or restore
acceptance. Do not use `restore_snapshot` on the default branch without
a dedicated protected playbook that sets `finalize=false`, records the
original branch ID and endpoint IDs, verifies branch status before any
cutover, and receives explicit operator approval. In particular,
restoring a snapshot with a new name **without finalize=false can
swap production identities by default**.

## Safe operator rollout sequence (blocked at every unresolved gate)

1. Reconcile **each historical numbered source path + SHA-256** and
   runtime DDL into a signed DBA adoption/cutover record. Audit app
   and DB activity during the restore incident.
2. Verify a non-production snapshot/branch restore procedure that cannot
   change the default branch or production connection host. Establish
   durable backup/restore acceptance, separate from disposable CI.
3. Reconcile historical 0110/0114 and their prerequisites before
   considering any forward 0115. Missing `worker_employment_events`
   and the sensitive 0121 backfill must be independently corrected, not
   worked around with a fake table or receipt.
4. Rehearse 0115/0116/0119 in a **disposable PostgreSQL CI service**
   with synthetic data using
   `tests/consolidated-migration-dependency-postgres.test.mjs`.
   Separately run `tests/complete-pending-train-postgres.test.mjs`
   against another disposable PG16 service initialized with Drizzle:
   execute the entire proposed 0115-0121 train inside a transaction,
   verify scope/replay invariants and roll back to its original catalog
   and payroll row counts.
   A real Neon staging clone additionally requires application/tenant
   security, rollback and schema parity evidence.
5. Do not activate PayMongo/Xendit, employee bank file exports,
   payouts, automated transfers, HCM/WFM optional modules or real
   money movement from passing SQL tests alone. Separate employer
   authorization, payroll reconciliation and security gates remain.

**Production migration and release authorization: FALSE.**
