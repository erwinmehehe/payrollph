# External payroll certification — evidence intake and independent verification

Tracks [certification issue #192](https://github.com/erwinmehehe/payrollph/issues/192). This is a **controlled evidence handoff**, not a certificate or a substitute for employer, CPA, agency or bank review. Engineering CI/pilot/golden results cannot complete these external gates.

## Ownership and source of truth

- **Independent CPA / Philippine payroll practitioner:** review effective-dated statutory rates, tax treatment, all Phase 1 / 2A / 2B / 3 golden results, and selected real payrolls. The external reviewer signs a dated, scoped opinion; a professional-license record is separately supplied and independently verified.
- **Employer payroll officer and independent checker:** execute two or three **actual** consecutive payroll cycles in parallel with the incumbent system. Attach employer-approved payroll inputs, the incumbent run, the Linaw run, a per-employee variance report (gross, SSS/MPF, PhilHealth, Pag-IBIG, BIR WHT, loans, net, GL), and checker sign-off for **each distinct month**. Zero unexplained differences are acceptable; any discrepancy needs a documented resolution, not a waived checkbox. Reconcile pesos to ₱0.01.
- **Employer compliance operator:** retain genuine BIR 1601-C and Alphalist acknowledgements, SSS R-3/e-CL, PhilHealth EPRS and Pag-IBIG eSRS/MCRF portal submission IDs and acceptance/rejection receipts **for the exact legal employer and submission file**. Draft CSV output is not portal acceptance. Check actual forms and portal schemas with the agencies before filing.
- **Bank integration owner + named bank contact:** execute controlled UAT, save the exact submitted batch's hash, its accepted receipt, a rejected/negative case, reversal/failure handling evidence, and the bank's signed UAT acceptance. No real funds move without owner/checker authorization.
- **Privacy/DPO:** keep personal identifiers, employee wage data, bank details and external receipts out of GitHub and CI artifacts. Apply least privilege, encryption, retention and deletion policy to the private evidence vault.

Each legal employer requires a **separate** bundle. No aggregation between employers is acceptable.

## Offline evidence bundle

The manifest schema is illustrated in `certification/external-evidence-template.json`. That checked-in template is intentionally incomplete. Copy it outside tracked source, for example:

```bash
mkdir -p certification/external-private/EMPLOYER_CODE/files
cp certification/external-evidence-template.json certification/external-private/EMPLOYER_CODE/manifest.json
```

For each private **document**, supply: a unique `id`, `kind`, matching `legalEntityCode`, a relative `filePath` inside the private files root, lowercase `sha256` of the actual bytes, a named independent `issuer`, genuine external `externalReference`, and `issuedAt` (YYYY-MM-DD). Never put a fake identifier or redacted placeholder where independent acceptance is required.

Mandatory manifest links:

- `independentReview.reviewId`: a signed report document with kind `independent-review`; `professionalLicenseId`: evidence with kind `professional-license`.
- At least two distinct `parallelCycles`, each `period` (YYYY-MM) and evidence IDs for `incumbent-payroll`, `linaw-payroll`, `variance-analysis`, `independent-checker`. A simulated QA tenant **does not count**.
- `governmentFilings`: BIR/1601-C, BIR/Alphalist, SSS/R-3, PhilHealth/EPRS, Pag-IBIG/eSRS-MCRF; each with separate `government-submission` and `government-receipt` evidence IDs. The manifest form literal for Pag-IBIG is `eSRS/MCRF`.
- `bankUat`: actual `bankName` and two evidence IDs of kind `bank-accepted-test` and `bank-rejected-test`.

Calculate each SHA-256 locally on the unchanged original file (for example `sha256sum` on Linux/macOS or `Get-FileHash -Algorithm SHA256` on PowerShell) and record the exact output. Do **not** upload this bundle to the public repository or attach it to PR comments.

## Numerically reconcile the actual parallel cycles first

Before attaching a signed variance-analysis document for a real parallel cycle, use the *private offline* employee and GL comparator in [private-parallel-reconciliation.md](private-parallel-reconciliation.md). It compares normalized incumbent and Linaw payroll figures and journal lines across at least two real months, and rejects missing employees, wrong legal employer, unexplained monetary differences and mismatched accounting. Run this against actual independently obtained files and retain its result plus the original source hashes and reviewer-approved normalization mapping under the employer's private evidence vault. A passing arithmetic result is **not** a checker signature, independent CPA approval or real portal/bank acceptance.

## Check a completed bundle locally

```bash
npm run payroll:evidence:check -- \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/files
```

The checker fails closed on missing required documents, missing/mismatched hashes, duplicate periods, untrusted absolute/escaping file paths, placeholder IDs, employer mixing, absent agency receipts or missing UAT positive/negative tests.

A successful check returns **`package-ready-for-human-verification`**, never `certified`. It validates file bytes and structural references **only**; it cannot independently authenticate signatures, reviewer qualifications, bank/agency portal results, file content correctness, or genuine third-party issuance. The named reviewers must confirm those items independently through their official channels, lock the evidence hashes in a controlled audit record, and expressly approve the relevant employer and release. The final GA decision is separate.

## Acceptance checkpoint

Do not mark issue #192's external checkboxes complete until real evidence and its human verification are recorded. If a source system changes, a filing is rejected, the evidence expires, or the employer/engine version differs from what was reviewed, stop release and obtain new evidence. Golden-payout CI results and internal pilot simulations remain engineering proof only.


## Combined operational and GA evidence gate

For real-employer GA, the above manifest alone is not enough. Run the private
[production/GA release gate](production-ga-gates.md) with
`certification/operational-evidence-template.json` completed in the private
vault. This adds independently reviewed BIR 2316 samples, approved low-value
transfer/negative reversal UAT, encrypted backup and witnessed isolated restore,
rollback, security/privacy evidence, measured RPO/RTO, employer and month
agreement, and at least 10 matched employees per month.

The combined validator **never issues GA approval**. Final signature and
government/bank evidence authentication remain human, external decisions.
