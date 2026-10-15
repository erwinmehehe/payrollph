# 2316 released-withholding evidence — 16 October 2026

## Scope and gate

`BIR_2316_WITHHOLDING_EVIDENCE_ENABLED` is a new default-OFF child of `BIR_2316_RECONCILIATION_ENABLED`. Both must be exacttrue before the existing year-end/offboarding 2316 endpoints query or display posted withholding evidence. Existing roles, MFA, employee selection, multi-entity year-end hold, payroll math and release controls are unchanged. No migrations or historical backfills.

## Evidence model

- Query only the selected organization/employee/pay year, joining the worker back to the same organization. Read in one repeatable-read, read-only transaction. Imported history remains unverified; its taxes are not silently promoted to released-ledger evidence.
- Use exact WHT and bound YE-TAX-id codes and integer centavos. Collections are negative payroll lines; refunds positive. Reject missing/duplicate WHT, malformed amounts, unfamiliar withholding codes, duplicate source entries, wrong employer/cutoff/tenant and stale opening totals.
- Bound adjustments require the exact settlement line on the linked Released run. Approved/unreleased runs cannot supply actual withholding. Balanced reassessments without a bound run require actual released totals to match the opening exactly.
- Offboarding uses the frozen source employer and frozen entry identities, dates and line-item contents. Compare them with currently released, same-tenant/worker ledger rows before using the approved final-pay allocation. Missing or changed frozen data stays unknown.
- Cross-year final-pay release dates (Asia/Manila) remain unverified for tax-year attribution; never silently put a later posting into the last-day year.
- Require distinct stable maker/checker/releaser IDs, a dated released record and release reference, explicit applied/unpaid tax amounts, and a consistent gross/net/statutory/loan allocation. Do not infer collection from tax due, expected adjustment or status alone. Partial historical collections show actual posted amounts and an uncollected balance; missing allocation fields stay unknown. A real release with unresolved mandatory deductions remains subject to the existing release prohibition.

These values describe posted payroll/release records. A manual release reference is an operator attestation, not bank settlement or BIR remittance proof. No payout or government filing is authorized here.

## Output and rollback

The existing numbered review displays item25A actual present-employer withholding, applied collection/refund, uncollected tax and unapplied refunds. Previous-employer, category mapping and PERA evidence remain independently unverified. Roll back by disabling the child flag; the parent-only worksheet remains byte-identical. With the parent disabled, the complete legacy worksheet/text bytes retain the previous snapshot checks. Flag-off readers return before opening a transaction.

## Verification

Pure behavior tests exercise signed collection/refund, approved-run exclusion, bound settlement identity, each scope dimension, unknown/imported data, duplicate/malformed rows, opening variance, executed final-pay shortfall and child-off rendering parity.

The guarded disposable-PG acceptance checks real read-only transaction state, two-tenant same-number workers, stale source, wrong employer, unreleased runs, frozen final-pay evidence and post-approval source mutation. It runs only in explicit BIR_2316_POSTGRES_QA=true loopback/app_db CI. Synthetic browser acceptance covers the actual MFA-protected annual worksheet and offboarding text routes, flag on/off, employee403, no-store, desktop1280/390 screenshots and actual/uncollected amounts. The shortfall fixture is explicitly fictional legacy data, not a release action or a way around current release controls.

## NOT done

Prescribed official certificate/PDF generation, historic offboarding header identity correction, full earnings category/prior-employer/PERA intake, independently verified imported payroll withholding, real employer reconciliation, human tax review, bank or agency acceptance, production activation and data migration. No unverified source is rewritten as zero or certified by this change.
