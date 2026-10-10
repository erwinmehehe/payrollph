# PayrollPH HCM — Guided Journey Actions

Status: **Draft and read-only.** Designed for the People → Connected Worker Profile.

This extends the connected seven-stage Employee Journey in PR #669 with an advisory, prioritized list of source-linked follow-ups. It does **not** create a second employee state machine, auto-approve a decision, generate a missing HR record or affect wages.

## Operator experience

- **Needs review:** source discrepancies, failed compensation proposals and incomplete separation clearance.
- **Follow up:** in-progress onboarding, performance reviews, future-dated position changes and pending approvals.
- **Source check:** neutral optional checks for legitimate direct hires and imported historical workers without linked records.
- **No action:** completed, not-applicable or permission-restricted milestones.

Priorities are stable: review first, follow-up second, optional source checks last. The component initially shows four actions; "Show all" expands the list. Each item shows the responsible team and opens the existing governed source module using `onPage` **without an API write**.

Recommendations are predefined by known stage IDs and do **not** copy employee names, amounts, free-text notes or backend error strings into follow-ups. Hidden Payroll and Compensation statuses cannot be re-created by the client action helper.

## Security and release integration

- The action list is mounted **inside** the already permission-checked People employee drawer, immediately after `HcmWorkerJourneyPanel`; it uses the worker profile's server-filtered `journey`.
- The existing worker-profile API enforces tenant/org-unit People membership and, independently, payroll-view permissions before returning financial status evidence.
- No additional API, database table, schema migration, feature-flag override, salary change or payroll-engine patch is introduced.
- PR #669 must be reconciled with canonical employee-intake/payout-governance PR #640 before merging, preserving #640's hire, salary, import and payee maker-checker controls.
- Keep the integrated PR **draft** pending its exact-head full TypeScript/test/Next build, browser, security, payout-isolation and tenant/privacy verification.

## Test and staging acceptance

Automated `tests/hcm-journey-action-plan.test.ts` covers review priority, stable order, restricted-data exclusion, neutral historical coverage, no automatic financial mutations and UI navigation-only wiring.

On staging:
1. Run across two distinct tenants and verify cross-tenant employee IDs never leak records.
2. Compare HR, unit-scoped HR, payroll viewer, owner and a role with a denied permission-set overlay.
3. Validate a direct/legacy hire without an applicant link; never imply illegal hiring.
4. Validate pending future position assignments, a failed compensation approval, and missing Released payroll evidence, without inferring wage nonpayment.
5. Validate released Separation with unfinished IT access/asset return remains actionable but cannot trigger automatic final pay.
6. Re-run the existing #640 payroll register/payee change negative-path and maker-checker tests on the combined branch.

Passing CI is not equivalent to employer HR, Philippine labor/payroll, privacy or bank-release certification.
