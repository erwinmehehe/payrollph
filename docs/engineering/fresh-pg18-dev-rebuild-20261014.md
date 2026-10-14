# Fresh PostgreSQL 18 development bootstrap and fictional payroll acceptance

**Scope:** Solo-developer, fictional-data testing using an empty GitHub-hosted
PostgreSQL 18 service. No AWS account, recurring infrastructure fee, production
Neon migration, real payroll transfer or government filing submission.

## What a green run proves

The project has no customers. The immediate engineering goal is to recreate an
EMPTY development database from current source, then test one fictional
employer's Hire → Onboard → Schedule → Clock In → Approve Time → Run Payroll →
Review → Release Payroll Records → Prepare Filing Evidence workflow.

The three isolated CI scenarios are PG16 direct hire, PG16 governed hire and
PG18 governed hire. PG18 additionally proves:

1. A new local PostgreSQL 18 `app_db` is empty before schema creation.
   Guarded CI identities, exact localhost URL and disabled payment flags are
   mandatory. Application Neon URLs and provider credentials are forbidden.
2. The **first** Drizzle schema push runs on that disposable database only.
   `scripts/qa/verified-pg18-bootstrap.mjs` inspects process output
   and exit status. PostgreSQL errors must fail CI even if Drizzle Kit exits
   zero; a "No changes detected" message cannot count as creation of an
   originally empty database.
3. A read-only SQL catalog check verifies core employee, employer, timekeeping,
   payroll and draft-filing schema objects. It checks the **original**
   `documents_org_employee_id_hr_cases_unique` key and
   `employee_hr_cases_coe_document_tenant_fk` still bind the same organization
   and employee, and records a metadata-only fingerprint (no employee rows).
4. The connected fictional payroll journey, tenant denial, authenticated
   role switching, governed-hire sidecar and synthetic mobile Chromium checks
   run against the newly created database. No test submits actual payroll
   money or statutory forms.

## Known unresolved issue — SECOND Drizzle push

Three exact-head CI experiments (runs 38560533426, 38563759547 and 38565602006)
showed that a **second** `drizzle-kit push` against its own fresh schema tries
to execute:

`ALTER TABLE "documents" DROP CONSTRAINT "documents_org_employee_id_hr_cases_unique";`

PostgreSQL properly refuses with SQLSTATE **2BP01**, because the existing
`employee_hr_cases_coe_document_tenant_fk` depends on that unique key.
Drizzle Kit 0.31.11 may log this error while exiting with status zero.

Reordering the composite parent key and the child table's physical columns
**did not fix it**. Those speculative changes have been reverted: the
production-bound schema remains unchanged. NEVER remove the FK, use
`DROP ... CASCADE`, ignore the SQL error, or automatically repeat
`db:push` against an existing real database.

**The development CI intentionally does not perform a second push.** A green
PG18 job is evidence of a fresh schema bootstrap and synthetic app acceptance,
**NOT** Drizzle idempotency, historical migration reconciliation or safe
production upgrade. Repeat-push/diff reliability remains a separately tracked
engineering blocker requiring a tested schema-diff fix and honest exit status.

The historical `drizzle/baseline.sql` and numbered migration archive cannot
be safely replayed as one ordered chain. The current workflow does not run,
rewrite or adopt those historical files. The production migration-provenance
and verified offsite recovery release holds remain intact.

## What remains after development CI passes

Physical mobile-device and novice employer tests, all 14 WFM acceptance
scenarios, real employer payroll reconciliation, official agency acceptance,
migration provenance and real-money payout authorization are all NOT RUN.
A successful synthetic scenario is not independently witnessed customer UAT.
