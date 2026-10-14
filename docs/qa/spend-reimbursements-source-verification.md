# Reviewed reimbursements: source verification and activation boundary

PR #896 is source integration behind `SPEND_PAYROLL_REIMBURSEMENTS_ENABLED=false`.
Receipt routes additionally require the document-vault and document-upload controls.
Multi-entity mode holds this reimbursement integration off pending employer attribution certification.
No payroll calculator math changes: reviewed amounts use existing ordinary supplementary earnings.

## Executed behavior

`TZ=Asia/Manila npx tsx --test --test-concurrency=1 tests/spend-payroll-reimbursement.test.ts tests/spend-receipts-behavior.test.ts tests/spend-receipt-integrity.test.ts tests/spend-expenses-api.integration.test.ts tests/spend-payroll-integration.test.ts`

Integration tests create a generated schema with no public-table fallback in disposable localhost PostgreSQL.
They run actual routes, role/membership/unit authorization, MFA and rate-limit code, SQL constraints,
audits, claim approvals, receipt attachment/read-back, payroll queue/calculation and transactional settlement.
Only session lookup is injected for route actor fixtures; scanner/object-provider responses are simulated.
Receipt reads hash actual bytes; wrong bytes, truncated/oversized content, identity drift and redirects fail.
One-time attachment, identical-receipt rejection, employer foreign keys, partial approval, concurrent
decisions/releases, duplicate register lines and double-cutoff settlement are exercised.
The unnumbered SQL proposal is rehearsed twice only in that generated namespace.

Default OFF leaves the legacy ORM mapping and JSON response fields unchanged. Tests drop both
new tables and execute legacy POST/GET before applying the proposal. Executed SSR compares initial
expense markup to baseline main using `node scripts/qa/spend-flag-off-parity.mjs`.
After governed data exists, disabling the feature deliberately holds its calculation/decision/release;
rollback cannot silently turn a taxable or partially approved claim into an ordinary legacy reimbursement.

## Browser coverage

`npm run build` then `node scripts/qa/spend-browser.mjs` exercises the actual ExpensesPanel with
compiled application CSS at 1440px and 390px. Fictional API responses cover reviewer, maker,
employee, loading, error/retry, empty and flag-OFF states. Screenshot artifacts contain no real PII.
These are component browser checks, not an authenticated application walkthrough. The existing
legacy OFF table can overflow at phone width; this PR preserves its markup and contains scrolling
only for the reviewed mode. A full flagged-app launch was rejected by automatic approval review
locally, without a supplied reason. No production MFA bypass was introduced.

## NOT done: production activation

- Canonical numbered migration allocation, DBA production lock/rollback review and deployment.
- Independent Philippine tax review of each category, including MWE and employer-policy acceptance.
- Authenticated full application/employee-navigation UAT and real device accessibility testing.
- Real private storage and malware-scanner certification, lifecycle/retention controls, durable recovery
  of orphan uploads if provider DELETE fails, disaster recovery and receipt legal retention review.
- Multi-entity activation, payroll provider acceptance, real money movement or government filing.

Receipt cleanup is best effort on failed attachment; source integration does not certify provider deletion.
The receipt hash prevents accidental reuse for the same worker, not two different scans of the same invoice.
All production flags remain OFF until these activation gates have separate evidence.
