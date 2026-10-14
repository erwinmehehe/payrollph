# Official BIR desktop validation handoff — synthetic only

Use the exact test DAT from the BIR 1604-C Synthetic Browser QA artifact. Its hash is in VALIDATION-MANIFEST.json. **This contains invented taxpayer identities and must never be submitted or used for a real filing.**

On a controlled Windows computer:

1. Download the applicable official Alphalist Data Entry and Validation Module from https://www.bir.gov.ph/Downloadables. Confirm the installed version and keep the official source URL and installer SHA-256. RMC 15-2025 announced version 7.4; version 7.0 is historical.
2. Extract the GitHub Actions archive and verify the DAT file using PowerShell: `Get-FileHash -Algorithm SHA256 -LiteralPath 'path-to-file.DAT'`. It must match the manifest before proceeding.
3. In the official BIR application, select Form 1604-C, the synthetic employer/branch and tax year 2025. Attempt to import and validate the byte-identical DAT; record the actual messages. Synthetic TINs might be rejected by the official module; do not bypass that validation.
4. Preserve the actual module version, validation date, file hash, complete report, redacted screenshots and person performing the test in restricted storage. Test invalid identities, dates, amounts and controls as separate negative cases.
5. An independent authorized payroll/tax reviewer must review the unaltered original result and record yes/no, linking the same DAT SHA-256 and evidence reference. An unperformed or unreviewed run stays **not run**.
6. Keep the already-merged #959 runtime flag disabled  until actual acceptance and independent review are evidenced. Official module validation is not proof of a filed or accepted BIR submission.

Evidence record:

- PR: #959
- Input DAT SHA-256: copy from VALIDATION-MANIFEST.json
- Module version and official download URL: **not supplied**
- Module installer SHA-256: **not supplied**
- Execution date: **not run**
- Outcome: **not run**
- Exact official error/output record: **not supplied**
- Screenshot/report evidence reference: **not supplied**
- Independent reviewer and decision: **not supplied**
- Government eSubmission result: **not submitted**
