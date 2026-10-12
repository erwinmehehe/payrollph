# Proposed 0115-0119 train: catalog prerequisite evidence (2026-10-12)

## Correct target and scope
Connected Neon: neon-almond-ridge, project calm-wave-70219564, main branch br-lucky-sound-b79i56jw, database neondb. PostgreSQL 18, current app uses organizations/integer IDs. **Do not confuse this with the previously misidentified legacy-UUID Neon account.**

Read-only catalog inspection found 112 public tables and no signed migration receipt journal. The 0117 SQL uses ALTER TABLE on **four absent payout tables**: payout_batches, payout_transfers, payout_batch_transfers and payout_profiles. SQL 0119 also depends on missing payout tables and worker_employment_events; it embeds BEGIN/COMMIT and UPDATE SET constructs currently incompatible with the proposed #867 executor restrictions.

## What this PR provides
The pure module scripts/lib/pending-train-preflight.mjs describes immediate SQL target relations per numbered file and deliberately returns safeToApply=false **even when all relations exist**. Tests cover the actual missing dependencies and fail-closed complete-catalog behavior. This is a source-only guard, not an automatically invoked production gate. Catalog object existence does not prove a previous migration ran; hash-based history reconciliation remains mandatory.

## Next controlled phase
1. Keep the canonical 0115-0119 SQL train as a draft and freeze its source hashes.
2. Establish DBA reviewed full-path receipts, source hashes, prior runtime-compatibility DDL, a tested restore point and verified host identity.
3. Find original DDL of required payout and worker-employment tables; stage reviewed predecessor SQL in a separate disposable database rehearsal rather than using db:push on main.
4. Reconcile SQL 0119 transaction/backfill logic and 0117 constraints with application schema definitions (do not relax auth/payroll checks).
5. Compare schema diff and test double-run, rollback, tenant cross-isolation, historical payroll totals, audit chain, and bank encryption. Do not activate live payouts, transfers, photo evidence or employer flags.

**Rehearsal status:** Branch creation attempted via connected Neon API and returned HTTP 401. A separate migration-lab branch already exists, but it was not mutated or presumed free for destructive testing. No SQL DDL or data mutation executed anywhere in Neon through this PR.
