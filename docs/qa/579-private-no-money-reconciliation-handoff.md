# #579 — private no-money payroll reconciliation handoff

This is a **real-employer operational gate**. A green CI test or fictional payroll run is not a real-source employee-by-employee reconciliation. Do not submit identifiable data, salaries, account numbers, keys, raw source file digests or reviewer identities to public GitHub.

## Engineering proof now available

- The existing canonical verifier is scripts/check-private-parallel-payroll.ts, invoked via npm run payroll:parallel:check.
- The new fictional offline CLI integration regression proves one SHA-256-pinned monthly fixture passes with --pilot (but is still PENDING INDEPENDENT REVIEW), the same period cannot satisfy multi-month certification without --pilot, and an employee-level two-cent mismatch blocks reconciliation.
- The audited post-release bank-file **dry-run** proof now rejects reused or path-shaped split part filenames, even when row counts and total pesos agree; duplicated part paths could overwrite an export segment. This is a source validation improvement, not proof an actual bank file was generated or accepted.

## Required private employer execution

1. Obtain an actual consenting employer/legal entity, a completed incumbent payroll period, security/DPA permission and an approved encrypted local evidence vault.
2. Bind the payroll app to an authorized safe tenant, real distinct Owner/Payroll Officer/Checker identities, and an exact deployed source SHA. Keep all bank disbursement/provider and government submission flags disabled.
3. Produce an actual PayrollPH payroll register, payslips, GL and audited post-release bank-file **preview only**, for the same immutable worker roster/cutoff that the incumbent payroll already closed. Do not move money.
4. Have an independent bookkeeper normalize the two authentic source registers and GL journals into the exact PAYROLL_COLUMNS and JOURNAL_COLUMNS format defined in src/lib/private-parallel-payroll-reconciliation.ts. Use a private employer-specific HMAC secret for stable pseudonymized worker IDs, retain original source files and the crosswalk only in the encrypted vault, and pin the SHA-256 of each normalized CSV into the private manifest. Record verified legal employer and period separately.
5. Run the existing offline checker, retaining its JSON and exact source hashes privately:

~~~sh
npm run payroll:parallel:check -- /absolute/private/manifest.json /absolute/private/evidence-dir --pilot > /absolute/private/pilot-report.json
sha256sum /absolute/private/pilot-report.json
~~~

6. Investigate and document **every** employee and component with unexplained differences greater than PHP 0.01; rerun until none remain. Reconcile gross/net, statutory EE/ER, withholding, loans, leave/OT/premiums, cash, GL debits/credits and total bank-file dry-run amounts. The checker validates supplied normalized CSV arithmetic; it does not verify originals, approvals or signatures.
7. Have a **different, real Philippine payroll checker** review the original evidence, account/employee mapping, normalization and final variance report. Obtain actual Owner no-money pilot signoff against the exact run and artifact digest. Keep both private.
8. Leave issue #579 OPEN unless genuine authorization, original period files, zero unexplained >PHP 0.01, independent human review and Owner decision are all documented. One period is a pilot only; normal certification still requires multiple periods. Agency import/acknowledgement and bank acceptance are separate.

The repo's canonical detailed instructions remain docs/payroll-certification/private-parallel-reconciliation.md. The fictional CLI and bank dry-run changes in this PR are **engineering safety improvements**, not new payout or filing authority.
