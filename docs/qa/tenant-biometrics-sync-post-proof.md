# POST /api/biometrics/sync — provisional tenant isolation proof

This draft covers a distinct method family not addressed by the open account-email, public-classification, privileged-operations, or CI-scheduling PRs.

## Scope
- Real localhost production-mode HTTP requests against disposable PostgreSQL 16.
- Two independently signed-in fictional employer owners; successful own attendance punch writes persist in SQL.
- A third real higher-ID victim employer with device and worker rows; foreign organization/device selectors denied and victim snapshots unchanged.
- Forged foreign employee number must be unmatched and never inserted.
- Device HMAC token bound to employer ID and serial: foreign org/device reuse is denied, while a correctly bound fictional device succeeds.
- Own replay does not create a duplicate punch.
- Audit, biometric device, staff, attendance, and payroll snapshots checked; no real device, worker, provider, production SQL or payout operation.

## Constraints
This proof is **zero-credit until passing exact-head CI and independent security review**. Do not edit the shared manifest/inventory or change POST to COVERED based on writing tests alone. Coverage is for the complete method, including both credential paths, not merely one happy path.

Verify the SQL result, review downstream attendance reconciliation and time-sheet side effects, validate that CI's source SHA and test runner are current, check for unsafe lock/date assumptions, and obtain independent identity/security review. A passing run alone does not authorize production or tenant-wide certification.

The existing GET /api/biometrics/sync is independently covered and must remain unchanged. No production handler, feature flag, schema, or credential material is altered here.
