# Employee import preview

Default off: EMPLOYEE_IMPORT_PREVIEW_ENABLED=true. No database migration is required for this capability; existing employee/pay-profile/import/audit tables are reused.

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

## Acceptance

500 rows with 20 seeded errors; blocked batch writes; explicit skips; actual PostgreSQL audit-trigger rollback and successful retry. Browser/role/phone evidence is required before activation.

## Screens and role states

| Screen | Roles | Empty/loading/error behavior | Phone/flag evidence |
| --- | --- | --- | --- |
| People > Import | Company-wide owner/admin/HR with existing People administration authority | Upload prompt; disabled controls and Working while preview/commit runs; file/API errors as alerts; all row reasons and filter; download errors; no commit without refreshed receipt | Browser workflow captures 1280px/390px before/after and preview; manager and employee UI/API denied |

Screenshots are synthetic acceptance evidence, not live employer approval. Artifacts exclude server logs, credentials, MFA secrets and session tokens. The workflow retains production MFA enforcement and signs in using a fictional account's authenticator code.
