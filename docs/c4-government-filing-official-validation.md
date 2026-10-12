# C-4: Philippine government filing formats and official validation

**Status:** implementation brief and source register, **not agency certification**. Updated 2026-10-12. An official download/version may change; the operator must verify the current BIR and agency tools for the actual filing period.

**Scope:** BIR 1604-C annual Alphalist, 1601-C monthly withholding return support, Form 2316, SSS R-3, PhilHealth EPRS, and Pag-IBIG employer remittance. Accounting-only SAWT/QAP/SLSP/2307/2550Q are outside payroll C-4 and belong in a separately reviewed accounting/export scope.

## Primary-source hierarchy

Use (1) current official circulars/forms, prescribed layout and filing channels, (2) an actual successful agency validator or portal outcome for the same byte-identical file, (3) independent Philippine payroll/tax reviewer sign-off. Community libraries and competitor documentation are references only; **never** authority for money calculations or agency acceptance.

| Workflow | Primary specification / official tool | Treatment |
| --- | --- | --- |
| BIR 1604-C annual Alphalist | [RMC 25-2024 Annex A: 1604-C schedules D1/D2 and controls C1/C2](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf); [RMC 15-2025](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025.pdf); [RMC 15-2025 Annex B: annual DAT filename](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20B.pdf); [BIR Downloadables: Alphalist Data Entry and Validation Module](https://www.bir.gov.ph/Downloadables) | BIR publicly announced **module v7.4** on February 25, 2025. Check the BIR download page for later versions at execution time. The older RMC 07-2021/v7.0 reference is historical, not the acceptance baseline. RMC 15-2025 **Annex A concerns SAWT**; do not substitute it for RMC 25-2024's 1604-C record layout. |
| BIR 1601-C | [BIR eFPS job aids](https://efps.bir.gov.ph/efps-war/efpsJobaids.xhtml), current BIR eBIRForms/eFPS directions | Monthly tax return: internal worksheet is **not** an upload-ready BIR return and is not tested by the Alphalist module. Obtain official portal filing/payment evidence. |
| BIR Form 2316 | [Official BIR Form 2316](https://bir-cdn.bir.gov.ph/local/pdf/2316%20Sep%202021%20ENCS_Final_corrected.pdf) and current regulations | Employee annual tax certificate, **not** a DAT or monthly return. Validate figures and preserve applicable issuance/signature evidence. |
| SSS | [SSS electronic R-3 File Generator](https://www.sss.gov.ph/download-forms-and-electronic-applications/) and current My.SSS/e-CL/PRN workflow | The official generator is a validation/reference option, **not** open-source code or proof that PayrollPH CSVs are compatible. Retain agency posting/payment outcome. |
| PhilHealth | [Official employer payment and reporting procedures](https://www.philhealth.gov.ph/partners/employers/pay_procedures.php), current EPRS | Employers are directed to EPRS for premium reporting/payment. Historical [quick guide](https://www.philhealth.gov.ph/partners/employers/quickguide.pdf) is not the current file-format authority. Do not claim RF-1 CSV upload support without tested EPRS mapping/receipt. |
| Pag-IBIG | [Official eSRS guide](https://www.pagibigfund.gov.ph/document/pdf/payments/ESRS.pdf) and [MCRF encoding instructions](https://www.pagibigfund.gov.ph/document/pdf/dlforms/providentrelated/Instructions%20in%20Encoding%20of%20MCRF.pdf) | MCRF and eSRS MSRF are not interchangeable. Obtain employer-specific accepted remittance and payment/posting evidence. |
| Address geography (non-filing helper) | [PSA Philippine Standard Geographic Code](https://psa.gov.ph/classification/psgc) | Use dated official PSGC snapshots for address selections; not a payroll rate authority. |

## Repository integration points

- `src/lib/bir-1604c-dat-candidate.ts` already emits a **DRAFT-UNVALIDATED** 1604-C candidate, with explicit field mappings and tests. Preserve that wording until official validator and real employer evidence exist; do not build a competing generator.
- `src/lib/bir-employer-reconciliation.ts`, annual readiness and source-preflight flows, and `tests/bir-1604c-dat-candidate.test.ts` provide the starting point for tax-year totals, legal employer scope and synthetic fixtures.
- `docs/ph-official-filing-acceptance-pilot.md` and the existing filing-evidence lifecycle distinguish **operator-recorded evidence** from a verified official result. Reuse their version/hash/source binding rather than create another accepted boolean or bypass checker/owner release.
- The existing government worksheets remain **DRAFT-NOT-CERTIFIED** until independently demonstrated otherwise.

## Required C-4 acceptance sequence

1. **Pin official source versions.** Record official circular/form link, retrieval date, relevant tax year, module name/version, and installer checksum from the official download. Record any discrepancy or superseding rule for independent review; do not redistribute a BIR binary in this repository.
2. **Map 1604-C exactly.** Compare all header, D1/D2 detail, C1/C2 control, field width, quoting, decimal rounding, date, text encoding, order, file-ending and annual filename requirements with the *applicable official* annex and the live BIR Alphalist validator. Never auto-fill missing legally required values with zero. Reconcile each field to the independently reviewed annual payroll/2316 source.
3. **Test ordinary and difficult cases.** Include regular employees, minimum-wage earners, partial-year hires and exits, prior-employer compensation, year-end adjustments, refunds, zero *reviewed* amounts, duplicate employee identifiers, malformed TIN/branch, bad dates, unsupported characters, wrong employee totals, corrupt controls, changed bytes and wrong legal employer. Capture deterministic golden positive and negative fixtures; no real identities in CI.
4. **Run the official BIR validator outside CI.** An authorized operator imports the exact generated DAT into the current official module and retains a private **pass or fail** result, redacted screenshots/logs, version, test case, original SHA-256 and generated output hash. A green unit test or an unverified assertion is **not** official validation. Failures produce an actionable error inventory and block format-readiness.
5. **Test the actual submission channel separately.** Successful local BIR validation means **validator passed**, not **BIR accepted or filed**. Only the agency's actual submission/acknowledgement and independently checked evidence for that legal employer/year may satisfy filing acceptance. Also capture a rejected attempt when permitted; distinguish manual entry from an uploaded file.
6. **Treat other agencies independently.** For 1601-C use the prescribed return workflow, not the Alphalist validator. For SSS use its current employer portal and official generator where relevant; for PhilHealth use EPRS; for Pag-IBIG distinguish eSRS MSRF from MCRF. Never invent undocumented import formats.
7. **Preserve money and identity protections.** Do not alter statutory contribution tables, withholding algorithms, holiday rules, or employer/employee figures based on OSS packages. Do not store raw employer evidence, employee IDs/TINs, bank data, portal credentials, unredacted screenshots, or signed forms in public GitHub/CI. Require maker/checker, current-head tests and private employer-specific sign-off before activating any claimed integration.

## C-4 implementation prompt (ready to assign)

**TASK — C-4 official Philippine government filing validation**

Inspect and extend the existing government export and evidence paths in PayrollPH. Do **not** create a second annual Alphalist exporter or silently promote a draft to an official file. Start with `src/lib/bir-1604c-dat-candidate.ts`, annual employer reconciliation, year-end preflight, filing-evidence lifecycle, and their current tests. Map 1604-C to the correct official BIR schedules/controls and naming conventions, using RMC 25-2024 Annex A and the current official BIR 7.4-or-later module and applicable circulars. Verify whether newer BIR instructions supersede any part **before editing the format**. Track 1601-C returns and 2316 certificates separately. Keep SSS/PhilHealth/Pag-IBIG exports marked as internal reconciliation worksheets until current portal formats are verified.

Implement deterministic positive/negative golden fixtures, fail-closed missing-field/identity/total checks, immutable version+SHA-256 binding, and explicit states separating `draft`, `official-validator-passed`, and `agency-accepted`. If an official desktop-only validator cannot run in GitHub Actions, document and require the private operator procedure instead of claiming CI simulates official acceptance. Preserve release roles, tenant/legal-entity isolation, money logic, and evidence privacy. Do not enable external submission or money movement.

**DONE WHEN:** the 1604-C candidate matches current official BIR specifications; a synthetic clean dataset passes the current official BIR Alphalist validator, seeded invalid datasets are rejected for the correct reasons, annual totals reconcile to the approved released payroll/2316 source to the centavo, and the evidence record binds the exact file bytes, validator version/result and reviewer. Separate, authentic **agency submission acknowledgements** are still required before claiming filed/accepted status. SSS, EPRS and Pag-IBIG file-format acceptance remain blocked without their respective portal evidence.

## Secondary implementation references (not authorities)

- [Odoo Philippines fiscal localization](https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/philippines.html): accounting-side DAT patterns only. Verify the applicable license before reusing code; do not assume payroll features.
- [laraflair/mandatory-payroll-deductions](https://github.com/laraflair/mandatory-payroll-deductions): independent numerical cross-check **only**, after confirming maintained rate years and license.
- [innonazarene/ph-holiday-calendar](https://github.com/innonazarene/ph-holiday-calendar): holiday-table cross-check **only**; current Gazette proclamations, effective dates, holiday category and payroll policy remain primary.
- [PSGC API (community)](https://github.com/jeffreybernadas/psgc-api), [alternative](https://github.com/bkintanar/psgc-api): UI convenience only; PSA is primary.
- [PayrollHero reports](https://support.payrollhero.com/?p=259347), [Sprout reporting guide](https://guide.sprout.ph/government-mandated-reports-in-sprout-payroll): competitor coverage checklists, not specifications.

**Outstanding external evidence:** No official BIR validator run, real employer agency acceptance, or remittance portal upload was performed by this documentation change. Existing launch gates remain blocked until those independent records exist.
