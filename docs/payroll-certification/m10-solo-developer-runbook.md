# M-10 solo developer runbook — engineering evidence vs agency acceptance

**Status: engineering-review candidate only; M-10 historical agency corrections remain policy-blocked and release NO-GO.**  
Primary issue: [#1044](https://github.com/erwinmehehe/payrollph/issues/1044). Detailed statutory-source research: [M-10 decision register](../payroll-m10-sss-hdmf-statutory-decision-register.md) (merged in PR #1117). No payroll accountant, QA team, or second developer is presumed.

## What this code actually does

- [src/lib/payroll-m10-readonly-review.ts](../../src/lib/payroll-m10-readonly-review.ts): pure, **no-side-effect** evidence review. It separates SSS from Pag-IBIG, checks source-run/entry identities, same-tenant and same-employee Released reference, period validity, integer centavos, remittance state evidence, original/correction receipts and duplicate review keys. Invalid evidence fails closed.
- Two externally supplied worksheet snapshots can be **subtracted** per agency in integer centavos (SSS regular, MPF, EC; HDMF employee/employer savings). A worksheet difference is **not** a calculated liability, government remittance instruction or recovery from a worker.
- Every result returns policy decisions \`NOT_OBTAINED\`, \`canPostAgencyCorrection: false\`, \`agencyFilingAction: NOT_AUTHORIZED\`, and \`approvedAgencyLiabilityCentavos: null\`, even if the caller passes \`acknowledgeExceptions: true\` or candidate month.
- No payroll runtime, exports, current employee statutory calculation, Released payroll record, source lookup, approval exception, or API is changed or wired to this new module. This is **offline reviewer tooling** only. It does not override \`STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED\`.

**Important:** The existing statutory remittance-correction UI/API is for correcting **evidence snapshots**, not a blanket permission to alter previously paid SSS/HDMF liabilities. Do not reuse it as an M-10 policy implementation.

## One-person developer commands

From the repository root, with Node 22 and project dependencies installed:

~~~sh
npx tsx --test tests/payroll-m10-readonly-review.test.ts tests/payroll-retro-statutory-source-period.test.ts
npx tsx scripts/m10-synthetic-review.ts
npx tsx scripts/m10-synthetic-review.ts --rows > /tmp/m10-fictional-review.json
npm run typecheck
~~~

The output is a **fixed 48-case synthetic pack** (12 variants × two fictional employers × SSS and Pag-IBIG) and has no real employee information or agency receipts. The \`--rows\` JSON does not contain authorized contribution assessments. Do **not** pass live/production payroll exports to this development script.

Run the repo's full applicable lint, golden payroll, test, build, PostgreSQL 16/18 and isolation CI after the source reaches a review branch. CI proves only code regression behavior. Do not attribute observed results to tests that have not actually run.

## Agency contacts — two focused clarifications, not a staffing project

**SSS (official contact channel):** [Pay Contributions](https://www.sss.gov.ph/pay-contribution/), [Contact us](https://www.sss.gov.ph/contact-us/). Include employer category and *fictional* scenarios; request current authoritative rule, circular section, applicable month, filing/correction channel, and written reply. The published R-3 contains addition/deduction fields, but its continued availability is not proof that a modern already-paid e-CL/PRN can be amended through that route.

Suggested SSS request:

> We are testing a Philippine payroll platform using fictional records and need written SSS guidance for a compulsory private-sector employee. For a wage differential relating to December 2024 that is first paid in January 2025, and separately for wages already paid in December 2024 but incorrectly reported: (1) which applicable contribution month and schedule should be used (2024 or January 2025); (2) how should employee/employer SS, MPF and EC be recomputed; (3) what is the sanctioned e-CL/PRN correction method when the original month is unfiled, submitted-unposted, paid/posted, or a correction was already accepted; (4) what receipt/member-posting evidence proves the amendment? Please identify the rule/circular and whether negative corrections or employee-share recovery require additional approval.

**Pag-IBIG (official contact channel):** [Pag-IBIG website](https://www.pagibigfund.gov.ph/) and [official HDMF circular register](https://www.pagibigfund.gov.ph/circulars.html). Ask separately; do not assume SSS procedures apply. For a January 2024 earning paid February 2024, identify whether the old or new February MFS governs **this exact fact pattern**. Also distinguish a late-paid earning from deducted-but-unremitted contributions under Circular 274 (an enforcement context).

Suggested HDMF request:

> We are testing a payroll system with fictional private-employer cases. Please identify the current Pag-IBIG rule for (a) an earlier-month wage difference first paid later, (b) wages already paid but incorrectly declared, (c) contribution previously deducted but not remitted, and (d) a negative reversal. For January 2024 wages corrected in February 2024, which contribution/assessment month and MFS schedule applies? Please distinguish unfiled, submitted-unposted, rejected, paid/posted and already corrected eSRS/MSRF records, and specify any accepted supplemental/amended procedure, employee/employer share treatment, original receipt linkage, and proof of member posting. Circular 274/275 enforcement rules and Circular 460's February 2024 MFS change are the starting references; please confirm present applicability and cite any newer circular.

**Never email actual employee numbers, government IDs or real receipts to public addresses without an authorized privacy-safe employer process.** Keep actual reviewer credentials and correspondence in a restricted evidence store, not a public GitHub issue.

## M-10 split deliverables

| Track | What one developer can establish independently | What must stay external/blocked |
| --- | --- | --- |
| Engineering | source identity checks, read-only worksheet arithmetic, duplicate detection, period/cutover cases, correct code CI | No auto-filing/release from synthetic tests |
| Statutory decision | source register and sharply scoped question pack | Written SSS-specific and HDMF-specific interpretation for historical corrections |
| Money acceptance | two fictional employers' centavo-difference exercise, before/after audit structure, reviewer read-only JSON | Real-person validated cents, qualified money review, actual agency posting acceptance and records |
| Operational launch | exact source SHA, CI evidence, disabled correction path | Controlled authorized employer pilot, receipts, human final approval |

When written agency determinations become available, implement SSS and Pag-IBIG remedies separately in **a new scoped PR** with effective-dated, credential/evidence-bound logic and no double posting. Retain the non-waivable release blocker until lawful scenario-specific evidence has been established. **Do not mark #1044 closed now.**

## Next M-10 engineering increment: independent fictional centavo comparison

The earlier 48-case M-10 preview compares two supplied worksheets, but did
not cross-check that arithmetic against an independently authored golden.
The new [M-10 centavo evidence module](../../src/lib/payroll-m10-centavo-evidence.ts)
now produces a **per-case, per-employee, per-agency** inspection ledger,
comparing each hypothetical difference against a separate expected fixture.

Do not sum alternative scenarios as if they are concurrent liabilities: each
fictional scenario describes a distinct possible history, not another
transaction to post. The module refuses incomplete source proof, duplicate case
identities, duplicate/missing/unscoped expectations, invalid/overflow cents and
mismatched SSS/HDMF fields. Distinct employer and employee identities are not
interchangeable. Exact matches are labeled `MATH_MATCH_ONLY`, never agency
accepted or legally payable.

### Optional one-command checks (fictional data only)

~~~sh
npx tsx --test tests/payroll-m10-centavo-evidence.test.ts tests/payroll-m10-readonly-review.test.ts
npx tsx scripts/m10-synthetic-review.ts --independent-summary
npx tsx scripts/m10-synthetic-review.ts --independent-ledger > /tmp/m10-independent-fictional-ledger.json
~~~

The source fixtures contain 12 alternatives × 2 employers × 2 agencies = 48
individual scenario rows, including 44 independently checked hypothetical
component deltas and 4 intentionally unverified source cases. The JSON
includes per-case original and revised **hypothetical** SSS regular/MPF/EC or
Pag-IBIG member/employer cents, candidate versus source/correction months, and
any one-centavo mismatch. An SHA-256 review fingerprint detects changed
synthetic report content; it is NOT an authentic agency receipt or signature.
No real employee identity, actual government filing or original-acceptance
evidence is included.

**No remittance-write API, DB migration, agency file generator, payroll
release path, exception acknowledgement or production feature flag changes.**
`STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED` must remain a non-waivable release
blocker. Neither green CI nor a mathematical match allows clearing #1044.

The next *external* gate remains two agency-specific written determinations
for SSS and HDMF, including historical contribution/month selection, prior
accepted-payment handling, original remittance adjustment workflow and
approved employee/employer recovery/refund treatment. This repo has no authority
to invent those procedures. Use the official-source decision register and
fictional packet; do not transmit real worker information in public GitHub.
