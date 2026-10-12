# WFM SQL contract: disposable PostgreSQL 16 rehearsal

This is a **source/CI-only** check for canonical migration files
\`0117_inline_first_payroll_journey.sql\`,
\`0118_wfm_roster_scale_rules.sql\`, and
\`0120_wfm_punch_evidence.sql\`.

The workflow refuses anything other than GitHub Actions with localhost
PostgreSQL 16, database \`app_db\`, an empty public schema, and synthetic
employees at two fictitious employers. It reads the **exact reviewed SQL**
on the PR, replays migrations twice, exercises FK/unique/CHECK constraints,
confirms offline entries default to pending without creating a time punch,
then rolls back the entire transaction. A separate job step forces a
PostgreSQL FK error after DDL and asserts rollback. It never connects to Neon
or real payroll rows.

It is not evidence that Neon 18.6 DDL succeeds on a production-copy branch.
Nor does this establish cross-tenant application access security, statutory
payroll approval, user consent, photo retention processing, or production
migration release. Enabling flags, applying Xendit 0119 or sensitive 0121, or deploying 0117/0118/0120
requires independent DBA, HR, DPO, and security acceptance.

**Live Neon rehearsal at the time of writing:** the temporary
\`payrollph-pr865-rehearsal-20261012\` branch previously rehearsed the *older source file* named 0115_inline_first_payroll_journey.sql (now proposed 0117) and did not rehearse the new 0115/0116 payout foundations. This is NOT proof the new numbered train ran on Neon. Direct 0116 execution was blocked by tool safety checks.
Do not try to bypass the block by repointing this CI workflow at Neon.

## PostgreSQL 18 version-parity validation

The source rehearsal now runs in a GitHub Actions PostgreSQL **16 and 18** matrix. The runner checks that its declared `WFM_REHEARSAL_PG_MAJOR` matches the disposable server's actual major version, verifies the exact SQL constraints and idempotent replay on both versions, and rolls back the whole transaction. The consolidated payout/first-payroll/WFM/multi-entity train also runs on 16 and 18 with synthetic fixtures. CI credentials may only target `127.0.0.1:5432/app_db`, not Neon.

PG18 green is a **syntax/transactional compatibility** check, not evidence that the SQL was actually applied to an isolated Neon branch containing employer data. Neon branch capacity and migration preparation permissions must be addressed separately; do not reassign production endpoints or promote migration without independent DBA acceptance.
