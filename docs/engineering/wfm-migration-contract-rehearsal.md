# WFM SQL contract: disposable PostgreSQL 16 rehearsal

This is a **source/CI-only** check for canonical migration files
\`0115_inline_first_payroll_journey.sql\`,
\`0116_wfm_roster_scale_rules.sql\`, and
\`0118_wfm_punch_evidence.sql\`.

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
migration release. Enabling flags, applying 0117/0119, or deploying 0115/0116/0118
requires independent DBA, HR, DPO, and security acceptance.

**Live Neon rehearsal at the time of writing:** the approved temporary
\`payrollph-pr865-rehearsal-20261012\` branch accepted 0115 and has not
accepted 0116/0118. Direct 0116 execution was blocked by tool safety checks.
Do not try to bypass the block by repointing this CI workflow at Neon.
