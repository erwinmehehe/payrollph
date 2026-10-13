# BIR 1604-C annual Alphalist: reviewed DAT candidate operator runbook

**Status: INTERNAL DRAFT / NOT BIR-VALIDATED / NOT FILED.** This feature is default off. It is a controlled candidate for official external validator testing, not an accepted tax return, Form 2316 certificate or government submission. Do not turn it on for general customers until an authorized Philippine tax reviewer signs off on actual module acceptance and the rollout.

## Primary sources and versions

- [RMC 25-2024 Annex A, 1604-C detail/control record specifications, pages 6-9](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf): H1604C header, D1 Schedule 1 regular compensation, D2 Schedule 2 MWE, C1/C2 controls. Historical Schedule 7.1-7.5 descriptions are not extra record types; no ATC in D1/D2.
- [RMC 15-2025 and Annex B](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20B.pdf): annual filename convention.
- [RMC 07-2021 and BIR Downloadables](https://www.bir.gov.ph/Downloadables): legacy v7.0 validator; BIR also announced v7.4 under RMC 15-2025. Verify actual current validator applicable to the year. v7.0 and v7.4 are separate tests.
- [Official BIR Form 2316](https://bir-cdn.bir.gov.ph/local/pdf/2316%20Sep%202021%20ENCS_Final_corrected.pdf): supporting employee income certificate, NOT a 1604-C DAT.
- **Official desktop BIR validation has not run in this PR.** Only its authentic output can verify exact import compatibility.

## Layout emitted by existing candidate exporter

| Record | Count | Strings and identifiers | Money / codes |
| --- | ---: | --- | --- |
| H1604C | 4 | H1604C, employer TIN 9, branch 4, MM/DD/YYYY | No guessed values |
| D1 | 49 | D1; 1604C; employer TIN 9, branch 4, period 10; employee TIN 9, branch 4; names/nationality up to 30; BIR region 4; employment dates 10 | Seq 6; amounts 14 (11 whole digits + decimal + 2); status R/C/CP/S/P/AL, separation NA/T/TR/R/D, substituted Y/N |
| D2 | 59 | Same D1 identities/widths | Separate MWE statutory basic/day/month/year, holiday/OT/night/hazard; factor 3, range 1-999; amounts 14 |
| C1 | 36 | C1 and registered employer/year | Summed D1 monetary columns |
| C2 | 45 | C2 and registered employer/year | Summed D2 monetary columns |

Candidate serializes quoted printable ASCII, CRLF lines including final CRLF, nonnegative amounts with no more than two decimal places and 14-character zero padding. Zeroes are legal only when independently reviewed. The download filename follows employer 9-digit TIN + 4-digit branch + 1231 + 4-digit tax year + 1604C.DAT. All local outputs retain the DRAFT-UNVALIDATED status; official BIR compatibility requires independent testing.

## Payroll source mapping: what the system knows versus still needs

| BIR information | PayrollPH data | Export rule |
| --- | --- | --- |
| Registered legal-employer TIN/branch | legalEntities.birTin, birBranchCode | Select exact employer; verify 9/4 digits |
| Employee TIN/branch | encrypted employees.tin / tinBranchCode | Decrypt with configured PII key; verify exact 9/4 digits, no padding |
| Name / nationality | employees first/middle/last/nationality | Prefill in private worksheet, verify ASCII and 30-character widths |
| MWE status | yearEndAdjustments.mwe | D1/D2 choice; does not establish premium split |
| Employee taxable income and tax due | yearEndAdjustments.taxableIncome, taxDue | Prefill; compare with selected employee/year |
| Actual withholding | released payrollEntries.lineItems scoped by payrollRuns.legalEntityId | Prefill; compare with monthly 1601-C, year-end settlement and ledger per employee |
| Prior employer / Form 2316 components | No complete legal-employer-attributed breakdown | Independent reviewer records none-confirmed OR form-2316-verified with reference and every relevant amount |
| Each tax/non-tax BIR category and 90k 13th-month exemption allocation | Aggregated annual totals are NOT full BIR breakdown | Leave null pending reviewed evidence, including any reviewed actual zero |
| D2 MWE holiday/OT/night/hazard/factor | No complete verified annual premium breakdown | Leave null and require a separate premium evidence reference |
| BIR region 4-digit code, employment dates/status, reason for separation, substituted filing | Region is text (e.g. NCR), startDate insufficient for year, employee status is current-only | Leave null for independent statutory review; never infer a BIR code |

Do not commit real employee data, signed 2316 certificates, credentials or unredacted screenshots to GitHub or CI artifacts.

## Controlled operator workflow

1. In a private test environment enable BIR_1604C_DAT_CANDIDATE_ENABLED=true. By default this variable is absent/false and the endpoint returns disabled. Never modify schema.ts, migrations, payroll math or critical flags to enable.
2. Sign in as company-wide payroll operator with recent MFA. Under Compliance > Year-End Annualization select employer and tax year, then Reconcile legal employer. Resolve payroll/remittance/identity issues; note the fresh source fingerprint.
3. Download prefilled review worksheet JSON. Only source-backed employee details/tax amounts are prefilled; every unsupported field remains null and its name is in missingManualFields.
4. From authoritative annual payroll/2316 evidence fill every required D1/D2 field, including zeros with verified origin. Set sourceReference, reviewedBy, priorEmployerReview (none-confirmed or form-2316-verified), priorEmployerEvidenceReference when applicable and mwePremiumEvidenceReference when applicable. Delete optional missingManualFields hints. If evidence is missing, STOP.
5. Upload completed reviewed JSON and Check reviewed DAT source. Per-employee plain-language blockers identify inconsistent identity, missing fields, 1601-C reconciliation, MWE components, employer conflicts, bad status codes, amounts or stale source fingerprint.
6. After preview status DRAFT-UNVALIDATED and SHA-256 are visible, click Download hash-verified draft DAT. Browser verifies SHA-256 over exact returned bytes, checks matching preview and employer source digest. The server audits only source digest, file hash, year, employer ID and employee count. No external submission happens.
7. **Windows-only external validation**: from the official BIR Downloadables obtain the correct Alphalist Data Entry and Validation Module for the selected return year; retain official URL, installer SHA-256, module version. Open the registered employer and 1604-C return, import the exact DAT, run its validation, preserve its actual pass/error report, DAT SHA-256, redacted screenshots and reviewer/date in a private vault. Verify combined D1/D2 and separate control schedules.
8. Run negative import samples: missing employee TIN, invalid employer branch, invalid employment date, amount wider than 14, corrupt C1/C2, unsupported LOV codes, wrong number of employees. Record actual official BIR errors. If the DAT changes, rerun and retain a new SHA.
9. First authorized operator uses Record external BIR module result, enters v7.0 or v7.4, actual pass/fail, validation date, matching DAT SHA-256, private evidence reference. The system stores an observation; displayed status stays not run.
10. A **different** company-wide MFA operator independently verifies the screenshot/report against file hash, and uses Independent review to confirm or reject observation ID. Confirmed pass => yes; confirmed fail => no; absent/unreviewed/rejected/source-changed/byte-changed => not run. These statuses describe operator-recorded validator evidence, not actual BIR filing.
11. Disable the flag after validation. Obtain separate real agency submission/acknowledgement before treating 1604-C as filed or accepted. This PR does not create accepted government filing records.

## Commands and outstanding acceptance

- npm ci
- npm run lint
- npm run typecheck
- npx tsx --test --test-concurrency=1 tests/bir-1604c*.test.ts
- npm test
- npm run build

Capture synthetic-only screenshots of desktop width 1280 and mobile width 390 for the BIR workflow. General core-module browser CI screenshots do not replace BIR-specific browser evidence. Official v7.0/current module validation, independent professional review, real tax data tie-out and actual submission remain NOT DONE until external evidence exists. Do not claim production filing compatibility based solely on this PR.
