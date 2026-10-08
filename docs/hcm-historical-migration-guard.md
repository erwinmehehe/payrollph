# Historical employee-master migration release controls

The migration center is for **one-time initial HRIS/payroll-provider cutover**.
It is not an alternative to approved live compensation, hiring, separation,
job/position or payout-destination change workflows.

## Code-level safeguards

- Employee migration dry-run remains available to authorized company-wide
  migration operators. The preview explicitly reports migration blockers.
- Committing an employee-master migration requires an owner/admin with MFA,
  an 8-200 character independently traceable HR migration evidence reference,
  and a company that has **no payroll runs, imported historical payroll,
  configured Hire BP, prior HCM process instance, effective-dated HCM change,
  position assignment or employee pay revision**.
- An imported *new* worker must have a genuine source hire/start date. The
  importer will not silently stamp today's date as historical employment.
- New and updated employees' government IDs (TIN/branch, SSS, PhilHealth,
  Pag-IBIG) are encrypted through the same government-ID crypto helper as
  normal onboarding. In production, missing encryption configuration blocks
  the employee migration before batch or employee writes.
- The migration evidence reference is included in the existing audit event.
- Other migration kinds (historic payroll, leave balances, loan balances)
  continue using their dedicated parsing and authorization rules.

## Required controls before rollout

1. Run the new regression tests and staging end-to-end migration with synthetic
   records, including a disabled/future Hire BP and already-started payroll.
2. Validate source HR export line-by-line with the employer and independent
   payroll reviewer; reconcile total headcount, dates, rate basis, historical
   payroll evidence and government IDs.
3. Confirm that the encryption key is configured, encrypted values can be
   decrypted by authorized staff, and *no plaintext government IDs* remain.
4. The initial employee-master migration writes employee, pay-profile, batch
   and audit records in one rollback-capable database transaction and uses a
   transaction-scoped importer lock. **Remaining gap:** competing live hire,
   payroll and position change routes do not yet share this lock, so an
   independently approved cutover/maintenance window is still necessary.
5. No real payroll runs, banks, government filings or production migrations
   are approved or triggered by this change.

This PR should be reviewed separately from the create-only employee CSV
hardening PR #633 and the compensation integration PR #626.
