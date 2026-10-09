# SQL migration review and release protocol

Historic migrations have several duplicate numeric prefixes. Leave files unchanged until a qualified DBA reconciles actual applied database history; renaming an applied file is not safe.

The advisory SQL Migration History Guard only checks repository diffs. It rejects changed/deleted historical SQL and new duplicate/out-of-order prefixes, with unit tests. It NEVER connects to a database or applies DDL.

Production migration release requires: (1) record target DB applied receipts and SHA-256 checksums in a controlled journal; (2) verify database identifier, expected app SHA, table/index compatibility and absence of drift; (3) back up and witness rollback/restore on isolated staging with synthetic employer data; (4) use an approved, ordered SQL application procedure under an authorized DBA; (5) deploy code needing new schema only AFTER schema compatibility passes; (6) obtain separate security/privacy and employer payroll authorization; (7) monitor and document change outcome privately.

The repository CI db:push is appropriate ONLY on its ephemeral isolated CI database, not an instruction to use drizzle-kit push to reconcile production.

Mark the GitHub advisory migration guard as a required branch check only after code review and branch protection configuration. This guard itself does not make production migrations safe, provide real applied checksums, or close issue #630.

## Append-only sequencing rule

New numbered migration files must be **contiguous** after the greatest existing number in the current `main` history. A branch adding `0101_*.sql` without `0100_*.sql` already in `main` (or included in the same reviewed branch) is rejected; a branch jumping from `0100` to `0102` is rejected. Within a single PR multiple new migrations may be in arbitrary diff order, but their numbers must form a consecutive series.

As of October 9, 2026, the current baseline ends at `0099` and pending migration candidates include compensation `0100` (#626), historical underpayments `0101` (#642), and final-pay maker-checker `0102` (#644). **Do not merge #642 or #644 until all previous migration numbers have been reviewed and merged safely.** This check validates only file numbering, not whether a live DB has applied the SQL or whether payroll release approvals are complete.
