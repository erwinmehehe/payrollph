# Philippine government filing: actual portal workflow and acceptance evidence

> **C-4 implementation brief and primary-source register:** [Government filing formats and official BIR validation](c4-government-filing-official-validation.md). Includes the ready-to-assign C-4 prompt, current BIR validator references and negative-test acceptance matrix. This guidance does not certify any file.

Status: **agency acceptance not yet independently verified**. This note is for pilot employers and source reviewers, not a declaration that PayrollPH CSVs are compatible with government uploads. Reviewed against public official agency guidance on 2026-10-11. Reverify current agency rules, forms, channels, and due dates before every real payroll period.

## The current operator journey

1. Complete employer legal identity (including required statutory identifiers), employee IDs, payroll month, final cutoff and independent payroll approval.
2. Release the applicable payroll run through existing checker and statutory assurance gates. A Draft or otherwise unreleased run cannot later be marked agency accepted.
3. In Exports > Government Filing Evidence, create the appropriate **hash-bound source worksheet**. The record stores generated file SHA-256, generator version, legal employer, payroll period, month, employee count and total.
4. Download the exact recorded version. Treat it as a **reconciliation worksheet** unless the agency separately confirms importing that exact version. Work through the linked current official agency service and validate figures/format with the portal.
5. Record the **actual outcome** (accepted or rejected), submission method, agency-issued acknowledgement, date and the specific period. Reject means fix data or format and create a new record. The accept operation now verifies the payroll run is released and the recorded worksheet still regenerates with identical bytes.
6. Retain the actual government acknowledgement and relevant payment evidence in the employer's controlled evidence repository. A typed reference in PayrollPH is an audited claim, **not** independent cryptographic verification of a government receipt. The current system does not automatically retrieve a government portal receipt.
7. Only the employer/independent filing reviewer can sign off the government gate for a real employer. No CI, demo receipt, user self-attestation or locally green worksheet may substitute.

## Agency-by-agency requirements

| Agency / item | PayrollPH output | Required external proof / channel |
| --- | --- | --- |
| SSS R-3 | Monthly reconciliation worksheet, not a certified upload | Current My.SSS employer e-CL/PRN, filing and payment/posting evidence. SSS also publishes an [official R-3 File Generator](https://www.sss.gov.ph/download-forms-and-electronic-applications/). An R-3 CSV from PayrollPH is not that generator's output. |
| BIR 1601-C | Internal monthly withholding summary, not an import format | Complete the official eBIRForms/eFPS return, retain the filing acknowledgement and payment reference. [BIR eFPS job aids](https://efps.bir.gov.ph/efps-war/efpsJobaids.xhtml). Check eFPS-group-specific filing dates. |
| BIR 1604-C / annual Alphalist | Annual source CSV and **DRAFT-UNVALIDATED DAT candidate**, not a certified upload | Reconcile annualization and 2316; check RMC 25-2024 Annex A (D1/D2/C1/C2) and RMC 15-2025 Annex B (filename) against the **current** BIR Alphalist Data Entry and Validation Module (BIR announced v7.4 in 2025). Independently retain the exact-file validator result **and** separate filing acknowledgement. A source CSV or candidate DAT alone is not accepted. |
| BIR 2316 | **Separate employee annual certificate**, not a monthly filing or annual Alphalist DAT | Use the [official BIR Form 2316](https://bir-cdn.bir.gov.ph/local/pdf/2316%20Sep%202021%20ENCS_Final_corrected.pdf), independently review wages/taxes, capture required signatures and employee distribution evidence. BIR lists issuance by January 31 of the next year, or with final wage payment upon termination. PayrollPH's monthly export is not a 2316 certificate. |
| PhilHealth RF-1 | Reconciliation worksheet; EPRS import mapping unverified | Use employer EPRS, retain remittance and payment evidence. [PhilHealth employer procedures](https://www.philhealth.gov.ph/partners/employers/pay_procedures.php) |
| Pag-IBIG MCRF | Internal worksheet; no verified agency import | The [official eSRS guide](https://www.pagibigfund.gov.ph/document/pdf/payments/ESRS.pdf) refers to the MSRF membership-savings schedule. The [official MCRF encoding instructions](https://www.pagibigfund.gov.ph/document/pdf/dlforms/providentrelated/Instructions%20in%20Encoding%20of%20MCRF.pdf) are separate; do not assume an MCRF CSV imports as an eSRS MSRF. Retain the final employer remittance and payment/posting evidence. |

## Additional programmatic gate for historical evidence

A previous acceptance record lacking a genuine-looking agency reference or a valid submission date cannot satisfy the current-version file-format or operational evidence predicates. This prevents legacy incomplete records from turning the application readiness gate green. It **does not authenticate the agency receipt**: an operator can still enter a purported reference, so external reviewer/agency evidence remains mandatory.

The filing UI now displays the agency-specific acceptance checklist and distinguishes an operator-recorded claim from independent verification. Form 2316 is tracked as a separate annual certificate and cannot be mistaken for annual Alphalist acceptance.

## Pilot acceptance test (not possible with synthetic fixtures alone)

For each agency and pilot employer, obtain one current-format **agency-accepted** and one **agency-rejected** attempt where permitted, including the exact generated file, SHA-256, current generator version, legal employer, applicable month and portal receipt. Use separate records for manual entry versus uploaded file. For 1601-C, the external workflow is a portal return; the PayrollPH CSV cannot be labeled BIR-prescribed merely because the filing was accepted. For 1604-C, official DAT validation is a separate BIR annual workflow; retain the BIR validator version, pass/fail receipt and exact-byte hash before any format-readiness claim. A validated file is still not a filed/accepted return without BIR acknowledgement. Private data and screenshots must remain employer-scoped.

Data protection: filing exports contain sensitive employee tax/government identifiers. Do not attach unredacted files or receipts to public PRs, public GitHub issues or marketing pages. Source-only checks, release QA and generator tests do not prove agency acceptance.

## Code-path security changes in this slice

- New official links and proof requirements appear in the employer-scoped filing evidence cards; no extra public readiness response or token disclosure.
- Operator writes stay behind existing same-origin, role and recent-MFA gates, and now check the **linked payroll run's organizational unit scope**.
- Positive outcome writes regenerate the file, compare SHA-256, confirm legal employer and require Released payroll state. A drifted/unreleased source returns 409 instead of an accepted gate.
- ISO calendar dates reject impossible rollover values; current rules for one-time audited outcomes and form-specific submission methods remain.

Merge requires exact-head unit/PG integration tests, golden payroll suites, lint, typecheck, build, security checks and maintainer diff review. External employer acceptance is a separate operational gate. Rollback: revert source changes. No agency data or live employer filing was submitted during this branch.
