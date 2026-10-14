# Filing validation and first-payroll development acceptance

This change closes development evidence gaps, not customer or agency acceptance.

## Exact fictional filing inputs

Run `PR_HEAD_SHA=<40-character source commit> npx tsx scripts/build-bir-validation-corpus.ts`.
The pack under `qa-artifacts/bir-validation-corpus` contains five separately hashed,
officially named DAT inputs: a structural ordinary/difficult sample and deliberately
corrupt header, control, employer-detail and truncated-file cases. The source input
and source commit are bound in `manifest.json`. No generated case is certified.

The sample covers regular, MWE, partial-year, prior-employer and refund fields;
all zeros are explicit fictional fixture values. It is not a payroll/tax opinion
or proof that these identifiers will pass BIR's current validator. Unit tests
also execute malformed identity, duplicate identity, impossible date, newline,
missing field, population mismatch and wrong employer rejection. The generator
now rejects either direction of a one-centavo withholding discrepancy. Its existing
`BIR_1604C_DAT_CANDIDATE_ENABLED` gate remains default-off.

An authorized operator must obtain the current official Alphalist module from
[BIR Downloadables](https://www.bir.gov.ph/Downloadables), record its actual version
and installer SHA-256, and import each exact DAT separately in a local test context.
Record observed pass/fail and the actual errors; expected rejection is not an observed
result. Preserve redacted output and each original DAT hash privately. Never submit
these fictional identities. RMC 15-2025 announced version 7.4; this pack does not assert
that it is still the newest version. Follow the existing Windows handoff for private
review and distinguish validator success from an agency submission acknowledgement.

On 2026-10-14, the live official Downloadables page listed **7.4 for taxable years
2023 onwards** and 7.1 for 2018–2022. Its official 7.4 ZIP was downloaded from
`https://bir-cdn.bir.gov.ph/BIR/pdf/Alphalist%20Data%20Entry%20and%20Validation%20ver.%207.4.zip`.
The downloaded ZIP SHA-256 was
`b4591c13103525d9a081a98fd17c2bf9cab48c382b8f9d20d2eeb3c653c7cbe9`;
it contains a Windows executable installer. The binary is not committed or
redistributed. This verifies the listed distribution, not installation, official
validator execution or format acceptance. Recheck the distribution before use.

## Same-worker governed journey

The connected acceptance workflow runs two independent disposable PostgreSQL 16
jobs: `NINE_STAGE_HIRE_MODE=direct` retains the original employee-create baseline;
`governed` starts with a real requisition, candidate offer, Hire BP request, distinct
HR and owner approval sessions, and a single candidate-to-worker conversion.
Direct-create bypass, maker self-approval, repeated request and duplicate conversion
are exercised. The resulting authoritative employee ID is the worker used for all
remaining stages: onboarding, schedule, Web Bundy, independent time correction,
payroll calculation, checker review, record release and four draft worksheets.
Government identifiers are completed through the authorized onboarding API.

The report binds candidate, position, requisition and Hire BP IDs to that same worker;
receipt tests reject a mismatched employee or missing source identifier. The separate
future-start #995 sidecar remains explicitly separate and cannot substitute for this
lineage. Desktop and 390px screenshots are captured for both jobs, including the
existing default-off header comparison. No application behavior flag is introduced
by this QA selection; it is confined to the workflow and scripts.

## Still not accepted

- Official BIR module execution, independently reviewed tax figures, and agency acknowledgement.
- Official 2316 form issuance, SSS R-3, EPRS and Pag-IBIG channel acceptance.
- Published workforce-plan-to-position creation: the position and Hire BP policy are fictional setup fixtures.
- A real first customer's parallel payroll reconciliation, independent human sign-off and physical-device testing.
- Any live payout, government submission, production activation or migration.

Synthetic CI can demonstrate application behavior and source lineage. It cannot
satisfy any of these external acceptance records.
