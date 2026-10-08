# Compensation staging release — schema and migration gate

**Status: engineering preflight only.** These checks are not payroll certification,
government acceptance, live employer approval, or permission to run a salary
activation, external automation or payout.

## Why this exists

The compensation notification outbox must be present **before** salary/component
writers or scheduler workers rely on it. A partial migration is more dangerous
than a missing table: the pay transaction requires correct tenant foreign keys,
an event-key deduplication constraint, status restrictions and due/retry indexes.
The application uses Drizzle `db:push` for fresh CI instances; the repository
does not have an ordered Drizzle migration journal. A successful push or
`CREATE TABLE IF NOT EXISTS` alone cannot prove that a real staging database
has the intended constraints.

The main branch also contains `0099_talent_role_requisition_skills.sql`.
The outbox's separate retained migration is therefore numbered
`0100_compensation_automation_intents.sql`, avoiding competing `0099`
labels during manual change review. **Do not** apply numbered SQL migrations
as a blind automated sequence; historical migration numbers are not unique.

## Controlled engineering verification

CI uses a disposable PostgreSQL service and runs both checks **after**
`db:push` and before any payroll tests:

1. `npm run compensation:release:schema:check`: performs a catalog-only
   inspection inside a PostgreSQL `REPEATABLE READ, READ ONLY` transaction.
   Fails closed on missing/wrong outbox column types, lengths, nullability or
   defaults; incorrect/absent FKs and ON DELETE CASCADE; missing primary key,
   allowed-status check, unique event-key index or retry/source indexes.
2. `npm run compensation:release:migration:rehearse`: **refuses to run**
   without `CI=true`, `COMPENSATION_MIGRATION_REHEARSAL_MODE=isolated-ci-only`
   and a local PostgreSQL `/app_db` connection. It executes the retained
   migration twice in its own randomly named transaction-local schema, inspects
   the resulting constraints and rolls the transaction back. The schema must
   not remain afterward.
3. PostgreSQL unit/integration tests cover deliberate schema/constraint
   tampering **in memory**, proving that a partially compatible schema fails
   validation without touching live tables.

This is not a witnessed staging restore, a dry-run of a real tenant migration,
or proof that the employer's database permissions allow production DDL.

## Staging process (human-controlled)

1. Confirm the approved candidate SHA, reviewed SQL file, employer scope and
   actual staging origin. Verify that PRs #615 → #617 → #620 → #623 and this
   release gate have been reconciled with `main`; rerun tests on the final
   candidate SHA. **Do not treat stacked draft PR checks as final main CI.**
2. Confirm an encrypted, independently verified staging backup and recovery
   point, and get DPO/SRE sign-off for migration/rollback. Take and record a
   pre-deployment schema snapshot outside the repository. Do not commit real
   employer datasets, database URLs, credentials, backups or raw schema dumps.
3. Using an explicitly approved staging change account and governed migration
   procedure, apply `drizzle/0100_compensation_automation_intents.sql` or the
   DBA-approved equivalent. Do not run a general `db:push` against live
   production or trust `IF NOT EXISTS` as a completed migration.
4. Switch to a **SELECT-only** reporting credential for the exact staging
   database and run:

   ```bash
   npm run compensation:release:schema:check
   ```

   Exit `0`: technically compatible; exit `1`: schema incompatible and
   **workers must stay disabled**; exit `2`: error/unknown, also fail closed.
   The output intentionally contains only catalog issue codes, not credentials,
   employee names, pay, banks or automation context. Capture the reviewed
   command output, exact SHA, date and tester in private change-control.
5. Use **synthetic employer data only** to test authorized scheduled salary,
   recurring-component activation, rollback on injected audit/outbox failures,
   and durable notification retries. Separately exercise ambiguous lease
   quarantine and human-governed Automation Studio execution recovery.
6. Run tenant-specific read-only salary evidence and automation-intent audits
   across **all** paginated records; reconcile any historical missing evidence
   through original signed records, not invented or backdated events.
7. Enable scheduler dispatch only after the table/constraints pass the gate,
   with an operator watching needs-review, queue age, and signed notifications.
   If the schema is incompatible, disable *new compensation writes and
   workers* pending controlled remediation, rather than retrying salary
   approval or losing financial evidence.
8. Independent payroll and security reviewers must verify existing controlled
   GA requirements: two real employer months (10+ real workers each), agency
   acceptance, bank positive/negative/reversal UAT, observed encrypted
   staging restore and out-of-band employer-specific sign-off. This engineering
   gate supplies **none** of those external proofs.

## Fail-safe status

A green schema preflight means only that the PostgreSQL structures the
compensation workflow needs exist in a compatible shape. It cannot establish
worker job timing, user permissions, delivery to external providers, data
integrity of historical applied salaries, migration change approvals, actual
statutory acceptance or authorization to release pay. A failed check must not
auto-migrate, auto-backfill financial events or release payroll.
