# HCM intake governance: controlled initial-roster import

## What changes

This change hardens two **legacy** paths: `POST /api/employees` and
`POST /api/employees/import`. These paths must not be treated as an equivalent
alternative to an employer's explicitly configured Hire business process.

- **Configured HCM hire policy:** If an organization has *any* stored HCM BP
  definition of type `hire`, direct new-hire creation and bulk employee CSV
  imports fail with `409 HCM_GOVERNED_HIRE_REQUIRED`. This includes inactive,
  future-dated and unit-specific definitions: a legacy import has no approved
  candidate/position context to prove that bypass is permitted.
- **Legacy/basic onboarding:** Organizations that have never configured a
  `hire` BP may continue to create employees directly and import a starting
  roster with company-wide People admin membership and MFA.
- **Create-only CSV:** Existing employee numbers are **skipped without changing
  salary, employment status, title, MWE, bank details or other fields**. The
  response gives the source CSV row and a message directing the operator to
  the appropriate governed workflow. A file can partially import genuinely
  new records while reporting skipped/invalid rows.
- **Source dates:** The import template now requires each employee's actual
  **Start Date (YYYY-MM-DD)**, rather than recording the time of CSV import as
  their first day. Existing old CSV templates without this column fail
  validation with a specific explanation.
- **Input validation:** All 17 configured wage-region codes are recognized.
  Employee statuses for direct initial intake are limited to Active and
  On leave, while any separation must use its lifecycle path.
  Bank destination pairs, MWE flag values, pay precision and calendar dates
  are validated before any new employee insert.
- **Atomic import:** The worker row, pay profile, import-batch metadata and
  actor audit record are written in one PostgreSQL transaction. Serializing
  concurrent CSV import attempts per organization reduces duplicate intake.

## Operator instructions

1. Download the new CSV template. Complete all required columns including
   verified actual Start Date.
2. Click **Validate only**. Review precise source-line errors, seat limits
   and new-eligible counts.
3. Correct duplicates. The CSV importer does not update existing employees.
   Existing salary changes go through Compensation; position/manager changes
   through effective-dated HCM; payout changes through destination controls;
   separation through the offboarding workflow.
4. If the workspace has Hire BP definitions, use Recruitment > Hire & onboard.
5. **Historical migrations or correction backfills of existing employees**
   require a separately approved, evidence-backed migration procedure.
   They are not silently re-enabled by a CSV flag. Preserve the old roster,
   pay ledger, position/assignment history and source evidence for reconciliation.

## Known follow-ups / release gates

- Enforcing *all* existing HCM sources remains open under issue #610
  (direct pay corrections, manual position assignments, recruitment handoffs,
  separation paths). A configured **hire** BP gate does not claim all HCM
  governance has been certified.
- Importing initial new workers is not equivalent to candidate/requisition
  approval for workspaces with no explicit Hire BP configured.
- The database presently lacks a demonstrated unique constraint on
  `(organization_id, employee_no)`. The transaction-level importer lock only
  serializes *CSV imports*, not every standalone creation path. Rehearse a
  deduplication/unique-index migration with a DBA and add matching locks to
  all intake paths before certifying concurrent production hiring.
- Tenant approval, independent HR/payroll reviewer acceptance, migrations,
  external bank/government checks and full end-to-end staging QA are required
  before deploying these behavioral restrictions to employers.
- No real employee, payroll or live database data is modified by this code PR.
