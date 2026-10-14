# Reviewed reimbursements: source verification and activation boundary

PR #896 is source integration behind `SPEND_PAYROLL_REIMBURSEMENTS_ENABLED=false`.
Receipt routes additionally require the document-vault and document-upload controls.
Multi-entity mode holds this reimbursement integration off pending employer attribution certification.
No payroll calculator math changes: reviewed amounts use existing ordinary supplementary earnings.

## Executed behavior

`TZ=Asia/Manila npx tsx --test --test-concurrency=1 tests/spend-payroll-reimbursement.test.ts tests/spend-receipts-behavior.test.ts tests/spend-receipt-integrity.test.ts tests/spend-expenses-api.integration.test.ts tests/spend-payroll-integration.test.ts tests/spend-receipt-recovery.test.ts`

Integration tests create a generated schema with no public-table fallback in disposable localhost PostgreSQL.
They run actual routes, role/membership/unit authorization, MFA and rate-limit code, SQL constraints,
audits, claim approvals, receipt attachment/read-back, payroll queue/calculation and transactional settlement.
Only session lookup is injected for route actor fixtures; scanner/object-provider responses are simulated.
Receipt reads hash actual bytes; wrong bytes, truncated/oversized content, identity drift and redirects fail.
One-time attachment, tenant-wide identical-receipt rejection even across workers, employer foreign keys, partial approval, concurrent
decisions/releases, duplicate register lines and double-cutoff settlement are exercised.
Spend-enabled release now downloads the scanned private object in bounded groups of four
before the settlement transaction, checks size/SHA against reviewed evidence and fails
closed on missing or altered bytes. Within the SQL release transaction, claim-row locks
enforce the unchanged receipt key, digest and byte-size snapshot before status is set
to paid. Tampered/missing object regressions run against a mocked private provider.
The locked settlement additionally verifies that every currently approved, unpaid
reimbursement for employees in the payroll run has an exact register line. A late
approval forces recalculation rather than silently skipping a payable claim.
This is NOT a substitute for independently verifying real object immutability and
provider availability throughout the release interval.
Synthetic MWE and ordinary workers exercise taxable versus non-taxable reimbursements using the
existing calculator; statutory SSS/Pag-IBIG trace bases must exist and remain equal across each pair.
A4 exact-centavo accounting assertions independently reconcile each submitted claim and approved
partial/full amount to precisely one EXP payroll line, sum all EXP lines against approved
SQL evidence (synthetic total PHP 40,900.02), sum employee gross/net against employer run totals,
isolate net-pay differences to withholding differences for equivalent ordinary/MWE workers,
and verify released gross/net and paid claim rows remain equal to the calculated snapshot.
This certifies implemented behavior, not the legal eligibility of a real employer's tax policy.
Receipt PUT is preceded by an audited, unreadable document cleanup intent. Metadata attachment and
intent clearance commit together. Ambiguous PUT failures wait for delayed cleanup; failed DELETE
retains the intent for retry by the leased retention tick, including when Spend is rolled back OFF.
Executed tests verify pre-PUT reservation, unreadable pending downloads, delayed DELETE retries,
idempotence, protection of already-referenced receipts and safe pre-migration no-op behavior.
Claim decisions, report creation/decisions and release share an employer-scoped transaction advisory
lock before row locks. Tests observe actual PostgreSQL advisory-lock waiters for approval and
competing releases. This closes the late-approval phantom window; OFF mode takes no new lock.
Signed-provider diagnostics are restricted to safe receipt error codes before surfacing release failures.
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
  BIR RR 3-98 and RR 8-2000 describe employer-named, non-personal, duly supported
  business reimbursement conditions and distinguish taxable compensation from some
  fringe benefits. The current boolean `taxable` category setting and synthetic
  payslip/withholding tests do NOT certify employee-specific legal classification,
  employer invoice ownership, appropriate FBT treatment or actual receipts.
- DBA preflight for duplicate receipt hashes across workers within one tenant before
  accepting the wider proposed unique index; changed/scanned invoices still require
  independent duplicate-invoice review. Bounded signed GET preflight requires
  pilot throughput, failure/retry, no-PII logging and time-of-check provider-object
  immutability validation.
- Authenticated full application/employee-navigation UAT and real device accessibility testing.
- Real private storage and malware-scanner certification, lifecycle/retention controls, production
  recovery/operator acceptance, disaster recovery and receipt legal retention review.
- Multi-entity activation, payroll provider acceptance, real money movement or government filing.

Failed provider deletion retains durable cleanup evidence; source integration does not certify a real provider.
The receipt hash prevents accidental reuse for the same worker, not two different scans of the same invoice.
All production flags remain OFF until these activation gates have separate evidence.
