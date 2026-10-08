# Private real-employer parallel payroll reconciliation

Tracks certification issue #192 and complements external proof intake PR #515. This command verifies local input integrity and arithmetic differences across two actual systems. It never declares PayrollPH certified.

## Procedure

1. Employer payroll officer authorizes a controlled parallel trial. Run Linaw beside the incumbent payroll for **at least two distinct real payroll months**, ideally three, without replacing the current payer or disbursing funds.
2. Export both systems' employee gross-to-net reports and posted journal data. An independent reviewer signs off on normalization from original source reports to these canonical schemas, including policy, attendance, 13th-month, overtime, retro pay, loans and pay-period aggregation.
3. HMAC-pseudonymize stable employee IDs **using a private employer-specific secret**. Do not store raw names, employee IDs, TINs, bank accounts, government numbers, emails, secret keys or mapping files in the CSV or GitHub.
4. Store all files and the manifest in the existing ignored, encrypted directory under certification/external-private/EMPLOYER_CODE. Copy certification/parallel-payroll-template.json to that private location and add at least two months and four file references + SHA-256 hashes per month.
5. Run the offline CLI and resolve all variances. Have an independent checker/CPA review originals, account mapping, pay calculations and exception explanations. Archive the report and approval with the appropriate cycle's variance-analysis and independent-checker document IDs in the #515 external-evidence manifest.
6. Obtain actual government portal acceptance and actual bank UAT separately. A matching local CSV is not a filing or payout acceptance.

## First-period pilot: distinct from multi-month certification

The first **real-employer payroll period** may be checked privately with `--pilot`.
This performs the **same employee-level and journal integrity checks**, HMAC matching,
input hashes, gross-to-net bridge, account control reconciliation, and ₱0.01 variance
limits, but accepts **one month**. A passing report is named
`pilot-arithmetic-reconciled-pending-independent-review`, **not certified**.

After independently reviewing the original employer exports and approving all
exceptions, retain the local manifest and report with their SHA-256 hashes in
the private encrypted evidence vault. Generate the **SHA-256 digest of the
actual saved JSON reconciliation report** and enter it, the matched employee
count, and the independent evidence reference into the Owner sign-off screen.
The digest anchors the private evidence for later review; entering it does
not mean PayrollPH has read the private report or verified its origin. In production, record the reference to
that reviewed evidence against the correct released run. The Owner must verify
the real payroll outcome and the post-release bank-file dry run before pilot
sign-off. A preview with placeholder destinations or missing immutable
payment snapshots does **not** count. Do **not** submit any payout.

```bash
npm run payroll:parallel:check -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/parallel-files \
  --pilot > certification/external-private/EMPLOYER_CODE/parallel-report.json
sha256sum certification/external-private/EMPLOYER_CODE/parallel-report.json
```

The normal command **without `--pilot`** continues to require **at least two**
distinct real-employer payroll months for broader certification evidence.
Neither mode substitutes for external agency acceptance or bank portal UAT.

**Readiness separation:** An Owner may sign off a no-money reconciled pilot with
an audited post-release bank-file preview, but that evidence is recorded as
`payoutEvidenceMode: "no-money-bank-file-dry-run"`. It never clears the
`production-pilot-signoff` broad-launch readiness gate. A separate actual
completed-payout evidence record and external bank/agency/privacy/recovery
acceptance are still required. The Owner can record the completed-payout
evidence later without overwriting the original no-money audit event.
Legacy pilot records without a verified payout mode are not automatically
grandfathered into the broader-launch gate.

## Run locally (never in CI with production data)

~~~bash
mkdir -p certification/external-private/EMPLOYER_CODE/parallel-files
cp certification/parallel-payroll-template.json certification/external-private/EMPLOYER_CODE/parallel.json

npm run payroll:parallel:check -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/parallel-files
~~~

SHA-256 source hash: Linux/macOS sha256sum; PowerShell Get-FileHash -Algorithm SHA256. Use the hash of each actual *normalized* file's unchanged bytes. Preserve the independently reviewed transformation mapping and original source exports in the private vault. The checked-in template is incomplete on purpose and cannot pass.

## Employee CSV — exact header, no extra columns

~~~csv
employee_key,legal_entity_code,period,gross_pay,taxable_pay,sss_ee,philhealth_ee,pagibig_ee,withholding_tax,government_loans,company_loans,other_deductions,net_pay,sss_er,ec_er,philhealth_er,pagibig_er
~~~

One row per HMAC-pseudonymized employee and legal employer for each YYYY-MM calendar month. Aggregate all relevant settled cutoffs for the month; explain any manual conversion from per-cutoff or non-monthly data. Each employee key is a 64-character lowercase **keyed HMAC-SHA-256**, generated from the same stable internal employee reference in both systems with a private employer-specific secret. Unsalted hashes and identifiable IDs are prohibited.

Money is PHP without separators, symbols or quotes; use at most two decimals. Employee contributions are the positive amounts withheld, not employer shares. Withholding tax may be negative for refunds; other_deductions may be signed for correctly documented reversals. All other numeric fields are nonnegative. All cash earnings belong in gross_pay. Mandatory and other deductions must fully explain the difference between gross_pay and net_pay. Employer statutory amounts are *separate* and must not reduce employee net pay. Independently validate taxable pay treatment rather than relying on either system's label.

## Journal CSV — exact header, no extra columns

~~~csv
account_code,legal_entity_code,period,debit,credit
~~~

One unique **normalized account code** per period and employer after independently documented mapping. Every source journal must balance on its own. The reviewer must approve the conversion from the employer's actual chart of accounts to these **separate** canonical payroll controls:

| Canonical account | Required reconciliation |
| --- | --- |
| `PAYROLL_GROSS` | Debit = total employee gross pay |
| `BANK_NET` | Credit = total employee net pay |
| `EMPLOYER_STATUTORY_EXPENSE` | Debit = employer SSS + EC + PhilHealth + Pag-IBIG |
| `SSS_PAYABLE` | Credit = employee SSS + employer SSS + employer EC |
| `PHILHEALTH_PAYABLE` | Credit = employee + employer PhilHealth |
| `PAGIBIG_PAYABLE` | Credit = employee + employer Pag-IBIG |
| `BIR_WHT_PAYABLE` | Credit = net employee withholding; net refund is a **debit** |
| `GOVERNMENT_LOANS_PAYABLE` | Credit = employee government-loan deductions |
| `COMPANY_LOANS_PAYABLE` | Credit = employee company-loan deductions |
| `OTHER_DEDUCTIONS_PAYABLE` | Credit = other employee deductions; net reversal is a **debit** |

All controls with a nonzero expected balance must be present. A zero-balance control may be absent, but if present must reconcile to zero. Net refunds/reversals are debits, not fictitious positive payables. **Do not combine SSS, PhilHealth, Pag-IBIG, BIR, or loan liabilities into a generic statutory account** that hides misclassification.

These codes are normalized certification controls, not necessarily the employer's literal accounts. Preserve original journal files and a signed, independently reviewed mapping in the private evidence vault. Where one source account contains debit and credit postings, net to the correct side with documented proof; never omit entries, shift amounts between statutory categories, or insert a balancing suspense line to force a pass.

**Why this bridge matters:** Two journals can agree while both misclassify BIR withholding as SSS payable. The ten-control bridge blocks that outcome even when both books independently balance and gross/net pay match.

## Verification and release boundary

The checker enforces valid periods and legal employer, two months, canonical no-PII headers, 64-hex pseudonymous keys, unique employees and GL accounts, matching employee populations, monetary differences within ₱0.01, gross-to-net identities, journal balancing, exact source hashes, and safe local file paths including symlink isolation. It reports discrepancy counts by field, not employee keys, payroll amounts or file contents.

Its strongest possible result is **arithmetic-reconciled-pending-independent-review**, never certified. It does **not** prove that sources are genuine, calculations comply with Philippine labor or tax law, the professional license or signature is authentic, or any government/bank portal accepted a file.

Any unexplained variance blocks sign-off. The independent reviewer must sign a dated, employer- and period-specific opinion covering original reports, engine versions, mappings, material exceptions, hashes and corrective actions. Keep actual evidence out of GitHub/CI; comply with the privacy and retention controls in the existing external-evidence-handoff document. Issue #192 remains open until real reviewer, parallel payroll, agency acceptance and bank UAT evidence are complete.
