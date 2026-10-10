# BIR annual compensation filing — Phase 2 engineering handoff

**As of 10 October 2026: staged / review only. No BIR agency acceptance or production filing is implied.**

This PR is intentionally stacked on **PR #722**. The parent PR is a source-readiness and
security gate. Phase 2 adds a separate employer-year reconciliation, a printable
Form 2316 **review worksheet**, and the strict record serializer for a **1604-C DAT candidate**.
Neither PR submits to BIR.

## What can be used after code review

### Employer-specific annual withholding reconciliation

GET `/api/bir/annual-employer?organizationId=...&taxYear=...&mode=employers` returns
active legal employers. GET with `legalEntityId=...&mode=reconcile` retrieves a
read-only, per-employer payroll and tax reconciliation. Both endpoints require
authorized company-wide payroll roles and recent MFA. The Year-End Annualization
panel exposes both actions.

It aggregates **Released** payroll runs by exact `legalEntityId`, detects employee
transfers or unattributed runs, compares settled year-end tax to signed actual
withholding, and compares each paid payroll month with reconciled BIR 1601-C
batches. It never changes released payroll or annual adjustment records.

**Hard stops:** an employee appears under multiple employers during the tax year;
unattributed imported history; missing or nonreleased payroll; missing
annualization; settled refund/collection mismatch; missing or unmatched BIR
1601-C evidence; and MWE lacking separate statutory premium-pay categories.
Because `year_end_adjustments` is still organization-wide, transfers cannot be
silently apportioned. A later separate, effective-dated employer-year ledger and
import-ownership migration is required for those cases.

### Printable Form 2316 review worksheet

`/api/year-end?organizationId=...&taxYear=...&employeeId=...&format=2316-print`
is a sensitive, MFA-protected, script-free HTML document with print CSS.
It shows mapped annual compensation and withholding, flags nonfinal data,
and explicitly identifies missing RDO/address/previous-employer/compensation
fields. This is **not** the official BIR Form 2316, not a signed document, and
not substituted-filing proof. Reviewers must complete the BIR-prescribed
September 2021 ENCS certificate separately and obtain any required signatures.
No plaintext certificate is stored.

### RMC-format 1604-C DAT candidate serializer

`src/lib/bir-1604c-dat-candidate.ts` defines:

- 49 fields for D1, 59 fields for D2 (including the Annex A continuation-page fields);
- 36 fields for C1 control, 45 for C2 control, with sums of reviewed numeric detail;
- H1604C header, explicit numeric cents, exact TIN/branch/region field widths,
  official annual name convention, Windows-compatible printable ASCII,
  and CRLF-separated records.

Every numeric field must have a **reviewer-provided** source amount, including
explicit zeroes. No previous-employer amount, substituted-filing status, PERA tax credits, MWE statutory basic wages/premiums, region number,
employment status, tax due, or tax withheld is guessed. Population and
independently derived released-payroll withholding must reconcile. DRAFT
candidates carry an `UNVALIDATED` filename and are never labeled accepted.

The renderer currently has **no public production route**: employee-level
BIR Schedule D1/D2 source capture, independent approval, and file-format
acceptance are not yet in place. Do not add a direct download to the payroll
home screen that would bypass source review.

## Remaining work before an official .DAT feature can be shipped

1. Add versioned **per-legal-employer, per-employee, per-tax-year** reviewed BIR
   record storage for all D1/D2 fields, plus employee region code, employment
   dates, previous-employer earnings/withholding, employment status and
   separation code. Enforce traceable source documents; do not infer missing values.
2. Add employee transfers and imported-history attribution to an
   employer-specific annualization ledger; do not mutate settled historical
   adjustments. Obtain independent reviewer signoff on mapping / corrections.
3. Implement maker-checker workflow and immutable, hashed snapshots. Confirm
   precise BIR status and separation LOV values and strict field encoding.
4. Independently reconcile 1604-C D1/D2 source rows, 2316, 1601-C monthly
   actual withholding and paid / accepted BIR evidence. A reconciled batch is
   useful internal evidence but is not a BIR eSubmission confirmation.
5. **Validate candidate bytes using the current official BIR Alphalist Data
   Entry and Validation Module**, including D1, D2, C1 and C2 controls,
   negative tests and all approved supported employee profiles. BIR validator
   behavior, especially control-record field counts, must be checked against
   its exact installed version, not guessed from a document alone.
6. Have an independent Philippine tax practitioner approve the output and
   record actual agency acceptance, rejection/correction and signed Form 2316
   samples. Do not claim automated tax filing or regulatory certification.

## Source-of-truth references

- [BIR RMC 25-2024 Annex A: 1604-C schedule fields, D1/D2 and controls](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf)
- [BIR RMC 15-2025 Annex B: annual DAT naming](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20B.pdf)
- [BIR RMC 15-2025: Alphalist Module v7.4](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025.pdf)
- [BIR 2316 official September 2021 ENCS form](https://bir-cdn.bir.gov.ph/local/pdf/2316%20Sep%202021%20ENCS_Final_corrected.pdf)
- Parent readiness audit: `docs/payroll-certification/bir-1604c-annual-preflight.md`
- Production release gates: `docs/payroll-certification/production-ga-gates.md`

**RELIEF / SLSP remains a separate VAT/accounting initiative; it does not belong
in employee withholding annualization.**
