# Employee import preview and tenant modules

Both capabilities default off in `src/lib/critical-release-flags.ts`:

- `EMPLOYEE_IMPORT_PREVIEW_ENABLED=true` activates the People import workflow.
- `CORE_MODULE_NAVIGATION_ENABLED=true` activates tenant module disclosure.

Apply `drizzle/0116_tenant_module_disclosure.sql` before deploying the schema change,
then restart/redeploy with the desired flags. On a populated database use this
migration before any schema push: it backfills existing tenants to `all`, then sets
future organizations' default to `core`. A direct schema push alone would use the
new default for old rows and is not the production rollout procedure.

## Import

The existing endpoint remains `/api/employees/import`. With the import flag enabled,
clients must preview the exact CSV and skip selection, then commit its session-bound
receipt. Editing/reuploading or changing skips requires another preview. The flagged
CSV template adds TIN and Department. Blank TIN or bank details are warnings, malformed
TINs, duplicate employee numbers, ambiguous/unparseable dates and unknown/ambiguous
departments are errors. Dates use `parseMigrationDate`. Department lookups and existing
employee checks are tenant-scoped. Import continues to create new employees only.

The preview returns every row (up to the explicit 10,000-row/2 MB limit), with no
employee, batch or audit insert. The UI pages 50 rows at a time and downloads the full
error/warning CSV. Users can fix and reupload, or explicitly skip rows and refresh
preview. Warnings may be committed; unskipped errors prevent every insert.

Commit revalidates current employees, departments, seats and governed Hire policy
inside the tenant intake transaction. Employee rows, encrypted bank/TIN values,
legal-employer bootstrap, pay profiles, batch summary and audit commit together.
Large inserts are chunked within the same transaction. A failure anywhere rolls back
the entire batch and returns a downloadable failure receipt. Turning the flag off
rejects the new action protocol rather than treating a preview request as a legacy
commit. Legacy `dryRun`/import behavior is unchanged while the flag is off.

## Modules

New organizations start with `core` preferences. Existing organizations retain `all`
preferences and their original navigation. Flag-off navigation is also unchanged.
Core mode includes People, Time, Payroll, Reports and Settings, plus Dashboard and
Approvals so onboarding and independent checker work remain accessible. Reports
contains only the reports/exports the user's existing role permits.

Company-wide owner/admin/bookkeeper accounts can opt into module groups from More
modules. Choices are saved per tenant and shared by sidebar, mobile navigation and
command palette. An opt-in never adds role permissions or bypasses plan, MFA,
maker-checker or release gates. Hiding a module does not delete its data. Solo
workspaces retain their existing navigation.

## Acceptance

- `tests/employee-import-preview-batch.test.ts`: exactly 20 seeded errors in 500 rows;
  date normalization; signed receipt isolation; blocked commits; rollback after audit
  failure; explicit skips produce 480 employees and matching pay profiles.
- `tests/employee-import-atomic-postgres.test.ts`: disposable GitHub Actions PostgreSQL
  exercises the actual request service and transactions, tenant isolation, a failing
  audit trigger, full rollback and successful commit. It also executes the migration
  against an existing-row fixture to prove new/default versus legacy behavior.
- `tests/tenant-module-navigation.test.ts`: rendered navigation snapshots for new and
  existing tenants, opt-ins, flag-off behavior, checker permissions and solo scope.
- Standard CI runs Manila-timezone tests, typecheck, warning-debt lint and all golden
  payroll suites. Local database-dependent checks need a disposable PostgreSQL service.
