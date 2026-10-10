# BIR compensation filings: annual Alphalist and Form 2316

**Implementation scope (10 October 2026):** local payroll-source preflight and export safety, **not** BIR-certified electronic submission. These are distinct acceptance stages.

## Supported employee compensation workflow

1. Finalize the employer's 12-month payroll, imported history (if any), and BIR employer/employee identities.
2. Use **Compliance / Year-End Annualization** to compute the selected tax year's 2316 amounts.
3. Reconcile and settle December tax refund/collection adjustments in a **Released** payroll run. An approved-but-unreleased adjustment is not final.
4. Click **Check BIR source**. Correct any blocker: employer TIN/branch, employee TIN/branch, duplicate identities, missing employee from annualization, invalid monetary split, withholding variance, unsettled adjustment, or mixed legal employer.
5. Review warnings, especially imported payroll history and BIR Form **1601-C** months that lack matched/reconciled filing/payment evidence.
6. Download **Alphalist 1604-C source CSV** only after the checks pass. This is a clean, ordinary CSV: no comment or disclaimer inserted before the header, and **not** an ADES .DAT file.
7. Prepare the actual prescribed 1604-C schedules and .DAT in the official **BIR Alphalist Data Entry and Validation Module** for the applicable year. Obtain a successful official validation result and submit via the then-current BIR channel.
8. Keep the official acceptance / error reply, submission acknowledgement, and independently reviewed BIR Form 2316 specimens in the private employer-specific evidence vault. A PayrollPH preflight pass is **never** proof of BIR acceptance.

The BIR 1601-C workflow already generates monthly withholding snapshots and reconciles **actual accepted filing evidence** and payment references. Annual preflight flags months lacking a reconciled batch as a warning; it does not invent 1601-C confirmation.

## Boundaries that must not be misrepresented

- `src/app/api/year-end/route.ts?format=alphalist` returns a **source CSV**, not a filing-ready DAT or accepted BIR format. The `DRAFT-SOURCE-NOT-BIR-DAT` response header and draft filename are deliberate.
- `format=2316` is a labelled **text draft**, not an official completed BIR PDF/certificate and not a substitute for employer approval.
- Preflight is protected by organization-level payroll authorization and recent MFA. It shows employee numbers and issue summaries, not plaintext TINs. Actual source exports contain sensitive TINs and must be controlled.
- The stored annualization is organization-wide. Multiple active legal employers are **blocked**, because the stored annual rows cannot currently be separated reliably per legal employer. Resolving a legal entity ID alone would not fix underlying organization-wide annualization.
- Imported prior-provider payroll must be reconciled independently; the payroll engine does not have a complete prior-employer Form 2316 component breakdown.
- Never pad a missing 4-digit BIR branch code into `0000`; configure the actual registered code.
- **RELIEF/SLSP** is VAT/accounting reporting and is intentionally excluded from the payroll compensation filing work.

## Why DAT generation remains a separate implementation and acceptance gate

**BIR RMC 15-2025** announced ADES version 7.4 and directs custom extract programs to use the prescribed file structures/naming conventions. Its Annex A updates SAWT structures and Annex B gives the annual DAT naming convention. The employee compensation schedules in **RMC 25-2024 Annex A**, attachment to **1604-C**, contain more than aggregate gross and tax totals: Schedule 1 has 49 detail fields and Schedule 2 (MWE) has 59, plus employer headers and control records. They include prior-employer taxable/non-taxable breakdown, employment dates, region, statutory wage/premiums and exemptions, status and separation, December actual withholding, and other fields.

The existing employee/year-end schema does **not** capture or reconcile all of those schedule-specific items. Generating a superficially named `.DAT` from the aggregate CSV would be misleading and risky.

### Prerequisites for a real 1604-C DAT implementation

- Confirm the BIR-prescribed annual 1604-C schedule structures, tax-year effective version, encoding and filename with the current official module and a Filipino tax compliance reviewer.
- Capture all required Schedule D1/D2 and control fields, with source provenance for previous employer, employment dates/status, region and MWE premium pay, tax credit and actual December remittances.
- Reconcile per-employer, per-employee Schedule 1/2 amounts with Forms 2316, 1604-C and monthly 1601-C actual filing/payment evidence; support imported history and job changes.
- Build a versioned generator behind a **fail-closed** feature gate, never a best-effort guessed layout.
- Run an independent CPA/payroll reviewer and **real official ADES validation** (accept and reject cases) using synthetic and controlled real employer samples.
- Retain official validation and filing acknowledgements externally. Only then consider the DAT generator production-supported.

## Official references

- BIR RMC 15-2025 (Alphalist Data Entry and Validation Module 7.4): https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025.pdf
- RMC 15-2025 Annex A (SAWT updates): https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20A.pdf
- RMC 15-2025 Annex B (standard file naming): https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20B.pdf
- RMC 25-2024 Annex A (1604-C schedules 1 and 2): https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf
- Existing release gate: `docs/payroll-certification/production-ga-gates.md`.

**No employer's annual return is production-certified by this PR.** Reviewer signoff and agency acceptance are external prerequisites.
