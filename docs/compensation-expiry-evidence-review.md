# Recurring compensation expiration: staging proof and legacy evidence review

This is a **read-only evidence-review workflow**, not a remediation/backfill process, payroll certification, or authority to release wages. No payroll figures, statutory rates, bank instructions, employee records or already-issued payments are changed by the audit command.

## Scope and access

Use a staging or independently controlled reporting connection, scoped to an explicitly identified employer/organization. A PostgreSQL account with **SELECT only** on `employee_compensation_components`, `compensation_events`, and `audit_events` is sufficient to review evidence. Do not substitute a production write-capable application credential. Store any exported report in your employer's existing confidential compliance-evidence location, not a public issue or PR.

The CLI does **not** infer a tenant, automatically switch credentials, or scan all employers. You must supply a positive organization ID and deliberately select the database connection.

## Run a bounded, tenant-specific audit

Set `DATABASE_URL` through your organization's approved secrets mechanism, not by pasting passwords into issue comments or shell history.

```bash
npm run compensation:expiry:audit -- 42 0 100
```

The positional arguments are `organizationId`, optional `afterAssignmentId` (default `0`), and optional `limit` (default `100`, maximum `250`).

The output is a JSON record containing `examined`, `completeCount`, `needsReviewCount`, individual `findings`, and a `nextCursor`. It includes no employee names, pay amounts, bank details or other worker PII. Run the next page with the returned cursor **until `nextCursor` is `null`**. A clean *page* is not a clean *organization* while another page remains.

Exit codes: `0` = final page with no findings; `1` = one or more findings on this page; `2` = invalid input or audit could not run; `3` = no findings on this page but additional pages are required. Collect all pages and consolidate discrepancies before completing the employer review.

## Interpretation

| Flag | Independent reviewer action |
|---|---|
| `missing_effective_end` | Investigate why an assignment is ended without an approved last payable day |
| `missing_financial_event` | Locate the original signed expiration decision; don't invent an event |
| `duplicate_financial_events` | Inspect both originals for duplicate scheduler processing |
| `financial_date_mismatch` | Reconcile the end event's effective date against the last entitled day |
| `financial_employee_mismatch` | Escalate a potential cross-employee attribution error |
| `missing_operational_audit` | Confirm whether the event predates atomic audit writing and locate independent primary evidence |
| `duplicate_operational_audits` | Review duplicate audit assertions and their event links |
| `audit_event_link_mismatch` | Determine whether an audit refers to another event, or has no verifiable link |

New atomic expiration records must include exactly one `component_ended` event effective on the last payable Philippine date and one associated operational audit record linked by `compensationEventId`. The component is marked ended **after** that date.

Old records may legitimately lack the newer audit linkage; **mark them for review, not as certified or falsified**. Never silently create a historical event, backdate audit timestamps, reconstruct a reviewer approval, or delete duplicate evidence. Any correction requires an independently approved and identified follow-up, preserving the original record and signed reason.

## Verify the scheduler race in an isolated test environment

The PostgreSQL test suite covers:

- simultaneous activation and expiry of an overdue scheduled component using the shared assignment lock;
- two parallel compensation scheduler sweeps and a recovery pass, with exactly one activation and one expiry event;
- expiry after the last payable Manila-calendar date, not on it;
- rollback when the event insert fails and subsequent retry;
- one historical payroll period still earning the allowance while a later period does not.

Run these checks on an isolated PostgreSQL test database:

```bash
npx tsx --test tests/recurring-compensation-expiration.test.ts tests/compensation-expiry-evidence-audit.test.ts
```

**Controlled staging acceptance remains separate from CI.** A reviewer should exercise equivalent concurrent worker jobs in staging with synthetic or authorized test records, confirm the audit report is clean on the test employer, inspect timestamps and event linkage, and sign off on any historical exceptions. Do not run synthetic races or test payroll jobs on a real employer's paid payroll period.

## Release decision

A passing `npm run compensation:expiry:audit` reports structural evidence only; it does **not** certify an employer's payroll computations, government filing acceptance, external reconciliation, production recovery, or authorization to release money. Resolve open findings or document an explicit human-reviewed disposition before treating the legacy evidence review as complete.
