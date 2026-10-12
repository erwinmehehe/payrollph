# Proposed SQL release train: 0115-0119 (source only)

**Status: DRAFT; DO NOT RUN ON NEON.** This is a coordination branch for five mutually incompatible migration reservations in open feature PRs. It changes no running database, secrets, Neon branch, deployment or activation flag. Merge and apply are distinct decisions.

| Migration | Source feature | Activation/review boundary |
| --- | --- | --- |
| `0115_inline_first_payroll_journey.sql` | #858 | First-payroll progress; verify enrollment, tenant/role access and rollback |
| `0116_wfm_roster_scale_rules.sql` | #859 | WFM manager policy; review daily/weekly hours and worksite indexes |
| `0117_xendit_payout_provider.sql` | #813 | **Money-related.** No money-out keys/flags, no live payouts; independent finance/DBA approval |
| `0118_wfm_punch_evidence.sql` | #856 | **Sensitive evidence.** Privacy/retention/device acceptance and encryption review |
| `0119_multi_entity_v2_scope_transfer.sql` | #860 | **Includes updates/backfills to payroll-related tables.** No production apply without reconciled legal-entity history, tested clone rollback and written DBA/HR/payroll authorization |

## Source-of-truth rules

- Historical duplicate filenames `0021`, `0024`, etc. are intentionally unchanged. They cannot be renamed: source file SHA-256 and legacy database history must be adopted first.
- The last `main` SQL number at creation was `0114`. New numbers `0115` through `0119` are consecutive and unique in this train.
- **No auto executor:** the repo has no proven live SQL migration journal; `drizzle-kit migrate` and replaying the numbered folder are not supported. Do not run `npm run db:push` against Neon production.
- Run the existing SQL migration history guard on this **entire train**, and the scoped train regression. Review the actual dependencies/DDL of *each* proposed file before a source merge; SQL tests passing do not mean it is safe to apply.
- Read `docs/engineering/production-migration-receipt-runbook.md`. DBA must first identify the actual Neon project/branch/database, validate the applied per-file SHA-256 receipt inventory under read-only access, and rehearse schema compatibility on a **disposable Neon branch or sanitized restored copy**.
- For each approved feature, record the exact source SHA, affected objects, dry-run/restore outcomes, privacy/payroll approvals and a separate controlled application receipt. Do not apply all five merely because all five source files exist.
- No activation of payroll payout, photo collection, automatic roster publishing or multi-entity transfers is approved by this train.

## Branch dependency / cleanup

- Feature PRs #858, #859, #813, #856 and #860 must depend on this train as a Git parent and remove any duplicate feature-local numbered migration. Their app/schema changes remain in the feature PR, but numbered SQL belongs only to this release train.
- #859's unnumbered SQL proposal is retained as historical design input and is NOT an executor. The canonical numbered SQL is `0116` here.
- Recheck PR diffs and exact-head CI after migration integration. Apply no live SQL and keep production feature flags OFF.

## Operational blockers

Real Neon project discovery, journal adoption, 13 groups of historical source duplicate prefixes, runtime DDL in `src/lib/core-schema-compat.ts`, encrypted bank backfills, human independent payroll reconciliation and production launch remain open under #744, #735, #737, #579 and #112.
