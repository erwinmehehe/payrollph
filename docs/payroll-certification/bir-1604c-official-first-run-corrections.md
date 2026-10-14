# Official 7.4 first-run rejection and corrected candidate

The operator ran the fictional ordinary/difficult DAT through the installed
official Alphalist Validation application on 2026-10-14. The application rejected
it. This is an actual observed failure, not an internal structural-test result.
The first report and original DAT are preserved separately from the corrected pack.

Original source: PR #1001, `6975747ecd11544e4e4a7606038ded612504af3f`.
Original DAT SHA-256:
`d530e0632649528c10c8cf8ebc6ae3af9b5f2b33b5958745aeaf6fa1272df03b`.
Original report SHA-256:
`33d7de6ac1aa5be95f659c1d4303e86f1982a29e2c00df633172b891c7d1a639`.
Observed errors: five invalid region codes, and two Schedule 2 combined/net
taxable compensation consistency errors on the fictional MWE row.

## Primary references and interpretation

[RMC 25-2024 Annex A](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf)
pages 6–9 specify D1/D2 field order and widths. REGION_NUM is **text**, width 4;
the implementation incorrectly required exactly four digits. The official 7.4
package listed on [BIR Downloadables](https://www.bir.gov.ph/Downloadables), ZIP
SHA-256 `b4591c13103525d9a081a98fd17c2bf9cab48c382b8f9d20d2eeb3c653c7cbe9`,
contains the region validation list in its shipped Schedule 1/2 form resources.
Those lists allow NCR, CAR, ARMM, Roman region identifiers and unpadded numeric
alternatives; they reject our 0001. No vendor code or binary is redistributed.
The local generator and pre-export preview now require an explicitly reviewed
listed code, without guessing an employee's region or silently changing it.

**Schedule 2 interpretation caveat:** the annex labels column 46 GROSS_COMP_INCOME,
but the shipped official validator checks this column as combined previous and
present *taxable* compensation, and checks net taxable against it. The original
MWE fixture placed PHP 156,500 exempt wages there while previous/present/net
taxable columns were zero. The corrected fixture keeps PHP 156,500 in its explicit
non-taxable wage/component totals and uses zero for the combined/net taxable columns.
This is a file mapping correction; no payroll rate, tax algorithm or ledger amount
is altered. An independent tax reviewer must resolve this field-label interpretation
for real employer data; do not automatically reclassify recorded wages to obtain a pass.

The generator and review also fail closed on inconsistent D2 combined/net taxable
totals, including a one-centavo difference. Missing fields remain missing; there is
no auto-filled zero. D1 field arithmetic is not changed by this correction.

## Executed regressions and repeat procedure

Executed tests serialize every listed region, reject padded/unknown regions,
reproduce both MWE failures, reject centavo drift, inspect the generated D2 and C2
taxable/exempt columns, and exercise disabled-feature behavior. Updated fixtures
use NCR. Existing source/identity binding and independent MWE evidence remain required.
The existing BIR_1604C_DAT_CANDIDATE_ENABLED flag remains default-off.

Generate with `PR_HEAD_SHA=<exact corrected commit> npx tsx scripts/build-bir-validation-corpus.ts`.
Copy to a new v2 folder, never overwrite the original failed pack or first report.
Record the new source SHA and DAT hash in a fresh manifest. An operator must run
the byte-identical corrected file in the official application and retain the actual
output, then run each deliberate negative case. Hash matching or green CI does
not prove official acceptance.

**Status of corrected DAT:** official repeat run NOT_RUN until actual output is
recorded; independent tax review NOT_RUN; agency submission PROHIBITED. Source
merge, if permitted after CI, does not activate the feature or certify a filing.
