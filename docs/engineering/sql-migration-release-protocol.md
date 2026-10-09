# SQL migration review and release protocol

Historic migrations have several duplicate numeric prefixes. Leave files unchanged until a qualified DBA reconciles actual applied database history; renaming an applied file is not safe.

The advisory SQL Migration History Guard only checks repository diffs. It rejects changed/deleted historical SQL and new duplicate/out-of-order prefixes, with unit tests. It NEVER connects to a database or applies DDL.

Production migration release requires: (1) record target DB applied receipts and SHA-256 checksums in a controlled journal; (2) verify database identifier, expected app SHA, table/index compatibility and absence of drift; (3) back up and witness rollback/restore on isolated staging with synthetic employer data; (4) use an approved, ordered SQL application procedure under an authorized DBA; (5) deploy code needing new schema only AFTER schema compatibility passes; (6) obtain separate security/privacy and employer payroll authorization; (7) monitor and document change outcome privately.

The repository CI db:push is appropriate ONLY on its ephemeral isolated CI database, not an instruction to use drizzle-kit push to reconcile production.

Mark the GitHub advisory migration guard as a required branch check only after code review and branch protection configuration. This guard itself does not make production migrations safe, provide real applied checksums, or close issue #630.
