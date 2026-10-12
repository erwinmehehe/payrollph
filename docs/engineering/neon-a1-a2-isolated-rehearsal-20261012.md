# A-1/A-2 isolated Neon migration rehearsal — October 12, 2026

**Status: successful isolated schema and behavior rehearsal; NOT authorized for production.** No bank data, individual payroll amounts, employer-identifying values or credentials were read. No transfers or provider calls occurred.

## Target and source

Production project: neon-almond-ridge (calm-wave-70219564), main branch br-lucky-sound-b79i56jw, database neondb. The repo's main SHA at start was a8f512fc78b7a8139bce0479d20722ca09a431bd.

Created separate child branch payrollph-a1-a2-ledger-rehearsal-20261012 (br-silent-field-b7w29djy), parent LSN 0/22ED1130, scheduled to expire 2026-10-19T05:00:00Z. The clone contains private employer data and must not be publicly exposed.

Source 1: drizzle/0110_provider_events_inbox.sql (Git blob b82682917fd1984283fdfd1580bff2449b1178f0). Source 2: docs/sql/pending-payout-ledger.sql, originally unnumbered DRAFT at Git blob d5687891859f606d9cde9b75a9924a8a703604c0. The original payout draft was applied before this PR's tenant guards, which were subsequently applied in an isolated second transaction.

## Operations on isolated branch only

Preflight found all four target tables absent on both parent and child. One transaction applied the three effective source statements from 0110. A separate transaction applied 17 statements from the original payout draft (three payout tables, indexes and immutability triggers). Another transaction applied the six tenant-lineage guard statements appended by this PR.

After staging, provider_events, payout_batches, payout_transfers and payout_batch_transfers exist with the expected unique indexes and triggers, each holding zero records.

## Synthetic PostgreSQL behavior

Replayed provider event, duplicate provider batch key and duplicate payroll-entry transfer were all rejected. Updates to frozen payout amounts were rejected. Before the tenant-lineage fix, a payout transfer could carry an organization ID from a different tenant while referencing a valid payroll entry. After the fix, four cross-organization/cross-run negative fixtures were rejected and a correct batch/transfer link was accepted. Every fixture was rolled back.

A deliberate failing DDL transaction (CREATE TABLE followed by division by zero) was rolled back: the test table did not exist afterward. Three pre-existing payroll runs and 18 payroll entries remained present on the clone. Separate metadata checks confirmed the production main branch still had none of the four new tables.

The full Neon schema diff endpoint returned HTTP 413 (schema too large); targeted PostgreSQL catalog inspection was used to confirm the added tables, keys, indexes, triggers, and row counts.

## Production blockers

- Pending ledger remains **unnumbered**. PR #865 already reserves migration numbers 0115–0119, and 0117 Xendit assumes this foundation; resolve sequencing before any release.
- The actual production branch has 112 public tables but no migration/cutover receipt journal. Historical adoption and release ordering need evidence; never invent receipts, replay the folder, or use production db:push.
- No automatic snapshots or scheduled snapshots were listed; six-hour history is not a witnessed encrypted restore with recorded RPO/RTO.
- RLS is disabled on all 112 application tables. Insert-time tenant guards do not substitute for tenant-scoped authorization or upstream-identity immutability; composite foreign keys remain a longer-term hardening consideration.
- No independent bank UAT, payroll reconciliation, provider-transfer replay, or production feature activation has occurred.

## Repeatable CI

The dedicated payout-ledger-tenant-rehearsal.yml workflow runs tests/payout-ledger-tenant-guard-postgres.test.mjs against disposable PostgreSQL 16 with synthetic data only. This tests the exact checked-in 0110 migration and revised pending ledger source. The CI results are pending; do not declare production readiness based on staging tests alone.
