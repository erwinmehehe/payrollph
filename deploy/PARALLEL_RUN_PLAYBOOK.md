# Private parallel payroll run playbook

> **Controlled pilot / no-money operating procedure.** This tracked Markdown contains **synthetic examples and blank signing fields only**. Never commit employee records, employer payroll amounts, bank details, keys, real source digests, agency/bank receipts, actual private manifests or signed decisions. **Evidence-ready is not GA; `gaApproved` remains `false`.**

**Implementation references:** [PILOT_GATES.md](../PILOT_GATES.md) · [Production GA gates](../docs/payroll-certification/production-ga-gates.md) · [#579 private no-money handoff](../docs/qa/579-private-no-money-reconciliation-handoff.md) · [Private parallel reconciliation specification](../docs/payroll-certification/private-parallel-reconciliation.md) · [External evidence handoff](../docs/payroll-certification/external-evidence-handoff.md) · [Acceptance binding controls](../docs/acceptance-bindings.md). When documents and code differ, confirm the candidate commit's implementation before processing employer data.

## 1. Scope, roles and stop conditions

The incumbent remains the paying system for a **no-money parallel comparison**. Run PayrollPH in an approved, isolated employer tenant against the same closed roster, cutoffs, effective-dated pay policies and payroll periods. **Do not submit a payout, use a real bank file for payment, or submit an agency filing as part of this procedure.** A post-release bank-file **preview/dry run** is not a completed disbursement, bank acceptance, or government acceptance. Positive/negative bank UAT, reversal handling and agency receipts are distinct, separately authorized external gates.

| Human role | Non-delegable responsibility |
| --- | --- |
| Named employer representative / payroll owner | Approve legal employer, no-money scope, source data, actual closed periods and later sign-off against the exact reviewed run and report digest. |
| PayrollPH operator / preparer | Confirm no-money protections, capture the exact reviewed engine commit, run the private local checker and retain protected evidence. |
| **Independent** Philippine payroll checker / CPA or qualified practitioner | Inspect authentic incumbent and PayrollPH originals, HMAC/canonical mappings, each worker and statutory/pay-policy exception; sign a scoped opinion **outside CI** and provide independently authenticated credential/license evidence. |
| DPO, compliance, bank contact and SRE | Approve intake/retention, independently authenticate actual third-party acceptances, and witness real production-like staging recovery. |
| Separate release decision owner / committee | Make a dated, employer-specific, out-of-band human release decision. The operational proof requires three different real people for `preparedBy`, `independentlyCheckedBy` and `releaseDecisionOwner`. |

**Block** if there is no employer permission/DPA, no approved private vault or source independence, any unexplained employee/component/GL mismatch exceeding ₱0.01, missing or unauthenticated signatures/receipts, invalid statutory handling, unresolved exception, unsafe bank change, stale evidence or changed engine SHA. A green CI run, benchmark, normalized file hash, synthetic exercise or first-period pilot **cannot clear those blocks**.

## 2. Private intake: verified tool guarantees and privacy boundaries

Create a **separate private bundle per real legal employer** in the ignored `certification/external-private/EMPLOYER_CODE/` directory, ideally on an approved encrypted volume. [` .gitignore`](../.gitignore) ignores `/certification/external-private/`; **an ignore rule is not encryption or access control**. Authorize collection under the employer's security/privacy agreement, apply least privilege, secure local backups, approved retention/deletion and audited access. Preserve genuine source exports in the private vault, never GitHub/CI/chat/PR artifacts.

1. **Freeze and authorize.** Log legal entity and approved code, real month(s) (`YYYY-MM`), calendar and cutoff policy, immutable roster, approved attendance/leave/OT, commissions, salary changes, loan data, statutory rate/policy effective dates, original incumbent system, PayrollPH tenant, exact deployed/reviewed lowercase 40-character engine commit. Ensure payout/provider and government submission actions are disabled for the no-money run; do not invent a CLI flag that does this.
2. **Obtain independent originals.** For **each month**, retain original incumbent register, PayrollPH register, incumbent GL journal and PayrollPH GL journal and have a separate reviewer normalize them into **four physically distinct** evidence exports with source roles `incumbentPayroll`, `linawPayroll`, `incumbentJournal` and `linawJournal`. Never point two manifest source roles or months to the same real file or a hard-linked alias. Identical independently obtained **values or SHA-256 digests** are allowed; independently retained physical files are required.
3. **Protect worker identities.** Use the same stable worker reference in both systems with an employer-specific, secret-keyed **HMAC-SHA-256**. Store the secret and re-identification crosswalk separately from the canonical exports. No names, raw employee IDs, TIN, SSS/PhilHealth/Pag-IBIG identifiers, email, account numbers, dates of birth, or narrative PII in canonical CSVs. The checker verifies a **64-lowercase-hex key's shape**, not that the key was truly generated by HMAC or that original custody is genuine.
4. **Normalize before comparing.** Use exactly the headers below; aggregate completed cutoffs for the same month, independently verify every amount, employee/base/period mapping, approved policies and effective date. Maintain the signed mapping from original GL accounts to ten separate certification controls. Do not silently modify the incumbent's released payroll to match PayrollPH.
5. **Pin bytes locally.** Record SHA-256 over **each unchanged normalized file** in `parallel.json` with a path **relative to the same private `files/` root**. Keep original sources, normalized CSVs, mapping, private manifest values, hashes and signed opinions inside the vault. Do not use production data in benchmarks or synthetic CI fixtures.

**Exact payroll CSV header** ([source array](../src/lib/private-parallel-payroll-reconciliation.ts)):

~~~csv
employee_key,legal_entity_code,period,gross_pay,taxable_pay,sss_ee,philhealth_ee,pagibig_ee,withholding_tax,government_loans,company_loans,other_deductions,net_pay,sss_er,ec_er,philhealth_er,pagibig_er
~~~

**Exact journal CSV header** ([source array](../src/lib/private-parallel-payroll-reconciliation.ts)):

~~~csv
account_code,legal_entity_code,period,debit,credit
~~~

Amounts: PHP **plain decimal** with 0–2 decimals, no peso symbol, commas, quotes, BOM, NULL bytes or extra columns. One keyed worker per employer/month and one normalized GL account per employer/month. Employee contributions and normal deductions are positive, **employer** shares separate from net; only `withholding_tax` and `other_deductions` may carry a documented negative refund/reversal. All other monetary fields are nonnegative. `gross_pay - employee deductions = net_pay` within ₱0.01; taxable pay cannot exceed gross after permitted WHT-refund allowance.

### What the inspected code actually does (and cannot prove)

| Source | Enforced locally | Not guaranteed |
| --- | --- | --- |
| [`check-private-parallel-payroll.ts`](../scripts/check-private-parallel-payroll.ts) and [`private-parallel-payroll-reconciliation.ts`](../src/lib/private-parallel-payroll-reconciliation.ts) | Offline reading; manifest ≤256 KiB at CLI; canonical exact headers, HMAC-key **format**, valid employer/month, unique workers/GL accounts, source bytes ≤8 MiB, 1–50,000 data rows, regular files inside root (resolves symlinks), actual SHA-256, **no reused physical realpath or device/inode** across all role/month sources; payroll identity, account balancing, 10 GL bridges, per-worker/per-field and aggregate checks. Output is counts and issues, **not** worker keys, wage rows or banking details. | Secure creation of HMAC, true source independence or provenance beyond different paths/inodes, Philippine legal compliance, completeness of original records, real-world approvals or actual third-party acceptance. |
| [`check-external-payroll-evidence.ts`](../scripts/check-external-payroll-evidence.ts) and [`external-certification-evidence.ts`](../src/lib/external-certification-evidence.ts) | Structural evidence IDs/types, same legal employer, valid dates, non-placeholder issuers/references, local readable file/digest matching, distinct months, expected agencies/filing pairs and accepted/rejected bank-UAT **documents**. | Authentic bank/agency or professional signatures, licensed status, real portal outcomes or the truth of the documents. Error messages may include operator-chosen document IDs: use opaque IDs and keep logs private. |
| [`check-external-acceptance-bindings.ts`](../scripts/check-external-acceptance-bindings.ts) and [`external-acceptance-bindings.ts`](../src/lib/external-acceptance-bindings.ts) | Five exact positional arguments, reruns **non-pilot** payroll and external checks, exact employer/months/engine SHA, 10+ matched workers per month, checked document IDs/kinds/digests/issuer references and nonreused acceptance/bank references. | Portal/bank contact verification, human sign-off or GA authority; `gaApproved: false` always. |
| [`check-production-certification.ts`](../scripts/check-production-certification.ts) and [`production-certification-gates.ts`](../src/lib/production-certification-gates.ts) | Six exact positional arguments, required bindings, combined arithmetic/external/operational checks, nine proof kinds, separated roles and a documented measured DR timeline. | Evidence authenticity, real production recovery, payment/filing authority or GA; `gaApproved: false` always. |
| [`benchmark.ts`](../scripts/benchmark.ts) | With `BENCH_SIZES` default `50,500,3000` and `BENCH_CHUNK` default `250` it **writes synthetic organizations, workers and runs** to configured DB, processes them, prints throughput/gross and attempts cleanup. | No PII protection or independent payroll correctness gate; do **not** run on a real employer/production database, or treat a performance number as bank, privacy or GA acceptance. |

The arithmetic comparator requires a **6–48 character** employer code matching `[A-Za-z0-9][A-Za-z0-9_-]{5,47}` and **distinct nonfuture** monthly periods. The ordinary mode requires **2–12** periods; `--pilot` allows **1–12**, with the same arithmetic guards. Its tolerance is **one cent**: discrepancies **greater than ₱0.01** block, as do missing workers/accounts even where totals happen to offset. **The ten-worker minimum is imposed by acceptance binding/combined GA, not by stand-alone parallel checking.** No code path verifies source signatures or legal interpretation. Consult the [actual evaluator](../src/lib/private-parallel-payroll-reconciliation.ts) and [#579 independent-source check](../docs/qa/579-private-no-money-reconciliation-handoff.md) rather than inferring privacy or source validity from a passing result.

## 3. Repeatable per-run procedure and disposition

1. **Begin each closed period with a no-money authorization.** Confirm the legal entity, cutoff/month, worker scope, version, Owner/Checker separation, same frozen inputs, and that no provider/agency action will be sent.
2. **Export independently.** Preserve original incumbent/PayrollPH payroll and GL, along with approved attendance, compensation changes, pay-rule version, employee roster and released run references. Have an independent reviewer sign the cutoff-to-month, worker-key and chart-of-accounts transformations.
3. **Prepare canonical `parallel.json`.** Copy [`certification/parallel-payroll-template.json`](../certification/parallel-payroll-template.json) privately. Set `schemaVersion: 1`, valid `legalEntityCode` and `cycles[]`. Each cycle needs unique `period` plus four objects (`incumbentPayroll`, `linawPayroll`, `incumbentJournal`, `linawJournal`), each with local relative `filePath` and exact lowercase `sha256`. Use the same `files/` root across all later manifests.
4. **Optionally run the one-period no-money pilot**. This is **not** certification and does not support acceptance or GA:

   ~~~sh
   npm run payroll:parallel:check -- \
     certification/external-private/EMPLOYER_CODE/parallel.json \
     certification/external-private/EMPLOYER_CODE/files \
     --pilot > certification/external-private/EMPLOYER_CODE/pilot-report.json
   sha256sum certification/external-private/EMPLOYER_CODE/pilot-report.json
   ~~~

   The `--pilot` mode argument is accepted **only** as the optional third argument of `payroll:parallel:check`; unexpected args or a different flag are rejected. Passing status is `pilot-arithmetic-reconciled-pending-independent-review`. A report digest anchors **saved bytes**, not a human opinion.
5. **After two or more distinct genuine employer months, run certification-mode arithmetic** **without** `--pilot`:

   ~~~sh
   npm run payroll:parallel:check -- \
     certification/external-private/EMPLOYER_CODE/parallel.json \
     certification/external-private/EMPLOYER_CODE/files \
     > certification/external-private/EMPLOYER_CODE/parallel-report.json
   sha256sum certification/external-private/EMPLOYER_CODE/parallel-report.json
   ~~~

   Passing status is `arithmetic-reconciled-pending-independent-review`. Exit 1, `reconciliation-blocked` or any `issues[]` is **blocked**. Save commands, actual run revision, stdout JSON and SHA-256 locally, never in CI.
6. **Verify every independent comparison.** Investigate per-worker and aggregate `gross_pay`, `taxable_pay`, `sss_ee`, `philhealth_ee`, `pagibig_ee`, `withholding_tax`, `government_loans`, `company_loans`, `other_deductions`, `net_pay` and employer `sss_er`, `ec_er`, `philhealth_er`, `pagibig_er`. Compare roster and canonical GL debit/credit accounts **separately**. The comparator checks fields, **not** full employee-level holiday/variable-pay causes; review the underlying lines and policies independently.
7. **Classify, correct and recheck.** Record each observed mismatch using the exact categories in section 4, the protected worker key, actual source line, original policy/approval, root cause, correction, owner and independent disposition. No editing already-pinned files, offsetting discrepancies between employees or statutory accounts, changing tolerance, or adding an artificial GL plug to pass. Regenerate changed exports, digests, signed mapping, variance analysis and checker JSON.
8. **Review source and banking preview independently.** Checker examines original payslips/registers, statutory year-to-date treatment, 13th/final-pay issues, gross/net, 10 GL bridges and audited **post-release bank-file preview** with no disbursement. Separate owner no-money pilot sign-off uses the **digest of the actual saved reconciliation report**, matched worker count and evidence reference (see [private reconciliation spec](../docs/payroll-certification/private-parallel-reconciliation.md)). A preview with placeholder destinations or incomplete immutable payment snapshot does not count. `payoutEvidenceMode: "no-money-bank-file-dry-run"` never satisfies the broader completed-payout gate.
9. **Escalate only with independent external evidence.** Two actual months, ≥10 matched workers per month, real reviewer opinion/credentials, required government portal receipts, controlled positive/negative bank and reversal proof, independently witnessed encrypted staging restore, privacy/security review and final release decision are separate, mandatory steps. If any source, policy or engine revision changes, obtain fresh hashes and revalidate all affected gates.

### Independently bridge ten canonical GL controls

| Account code | Correct separate bridge for each source and period |
| --- | --- |
| `PAYROLL_GROSS` | Debit = sum `gross_pay` |
| `BANK_NET` | Credit = sum `net_pay` |
| `EMPLOYER_STATUTORY_EXPENSE` | Debit = sum of `sss_er + ec_er + philhealth_er + pagibig_er` |
| `SSS_PAYABLE` | Credit = `sss_ee + sss_er + ec_er` |
| `PHILHEALTH_PAYABLE` | Credit = `philhealth_ee + philhealth_er` |
| `PAGIBIG_PAYABLE` | Credit = `pagibig_ee + pagibig_er` |
| `BIR_WHT_PAYABLE` | Credit = net WHT; **debit** if refund |
| `GOVERNMENT_LOANS_PAYABLE` | Credit = government loans |
| `COMPANY_LOANS_PAYABLE` | Credit = company loans |
| `OTHER_DEDUCTIONS_PAYABLE` | Credit = net other deductions; **debit** if reversal |

Nonzero expected controls **must** be present, zero controls may be omitted; each source journal must independently balance. For any net negative WHT or other-deduction liability use the **debit** side, not a fictitious positive payable. The original CoA mapping must be independently signed; never combine SSS, PHIC, Pag-IBIG, BIR, company or government loan controls in one generic GL account. [Bridge code](../src/lib/private-parallel-payroll-reconciliation.ts) · [bridge requirements](../docs/payroll-certification/private-parallel-reconciliation.md).

## 4. Variance categories and a disposition for **each** one

**Important:** [`classifyPayrollVariance`](../src/lib/payroll-variance.ts) categorizes a PayrollPH explanation compared with a **previous payroll entry**, not incumbent-versus-PayrollPH normalized CSV differences. The external discrepancy counts need human root-cause tagging. Categories are **nonexclusive**; do not treat the classifier as an approving authority. [`buildPayExplanation`](../src/lib/payroll-explain.ts) supplies supporting line codes/context, but originals govern.

| Exact category | Actual trigger in `payroll-variance.ts` | Independent path to disposition |
| --- | --- | --- |
| `exception` | `currentStatus === "Exception"` | **HOLD.** Resolve exception state, approved attendance/pay policy and engine/rule issue, re-run, checker verifies source and status. |
| `salary_change` | `hasPayRevision` or context `effectivePayChanges > 0` | Match effective-dated written approval, proration, statutory/tax bases; fix revision and related retro, rerun, get checker acceptance. |
| `overtime_spike` | Positive `OT` delta with previous OT >0 and current OT ≥1.5× prior, **or** prior OT=0 and increase ≥₱500 | Match independently approved minutes, OT/holiday/rest/ND rates and overlays; correct or document verified legitimate movement and rerun. |
| `retro` | Positive `RETRO-` current line **or** context `retroPay >0` or `retroAdjustments >0` | Trace original released cutoff and effective date, exclude duplicate carry-forward, handle WHT and EE/ER statutory true-up, re-export and verify. |
| `new_hire` | `isNewHire` | Prove start date, pay basis, partial-month entitlements and contribution timing; correct dates/roster, independent sign-off. |
| `new_to_run` | Current entry without previous entry, **only when `isNewHire` is false** | Investigate prior-run scope, identity mapping and why existing worker newly appears; do not equate to genuine hiring or ignore roster mismatch. |
| `separation` | Prior present/current absent with non-active employee status, **or** non-active employee still in current entry | Verify separation effective date, final pay, lawful deduction/refund, exit and remaining period entitlements; reconcile original chronology and GL. |
| `missing_from_run` | Prior entry/current absent **without inactive status** | **BLOCK.** Verify worker status, filters, cutoff and HMAC crosswalk; restore missing active worker or document legitimate scope with originals; rerun to matched population. |
| `bank_details` | `bankDetailsChanged` | **HOLD all live payout.** Confirm authorized bank change via independent secure employer process; separate Owner/Checker approval and fresh protected preview; never log actual account numbers. |
| `statutory` | Changed line with `abs(netEffectDelta) ≥0.01` and code in `SSS, PHIC, PHILHEALTH, HDMF, HDMF_VOL, PAGIBIG, PAG-IBIG, WHT, TAX` | Recalculate current valid SSS/MPF, EC, PHIC, Pag-IBIG, BIR employee/employer amounts; review bases, timing, refunds, filings and corresponding distinct GL; independent statutory review. |
| `net_variance` | `netDelta` exists and `abs(netDelta) ≥0.01` | Trace every gross, earning, withholding, loan and other-deduction line to bank preview and GL; fix cause, recheck each worker and require reviewer disposition; **no cross-worker netting**. |

**Threshold nuance:** classification flags `statutory`/`net_variance` at **≥₱0.01** changes; the [parallel comparator](../src/lib/private-parallel-payroll-reconciliation.ts) blocks monetary difference at **>₱0.01**. The discrepancy may have multiple tags. A valid business explanation is **not** an override for red comparator output. Track privately per case: `OPEN/BLOCKED` → source/policy mapping review → `CORRECTED_AND_RERUN` (fresh hashes) or `EXPLAINED_WITH_ORIGINALS` (no outstanding arithmetic issue) → `INDEPENDENTLY_VERIFIED`. Any unexplained >₱0.01 or unmatched population/GL leaves the employer run **BLOCKED**, not signed off.

## 5. Synthetic statutory/pay-policy edge-case matrix

**Fictional worker IDs and amounts below are training inputs only.** They are not actual payroll, fixed statutory rates, legal conclusions, genuine agency/bank acceptance or evidence for the certification manifests. Confirm current Philippine law and employer contracts/CBA, effective dates and pay rules with a qualified independent reviewer. The aggregate CSV may match while underlying pay treatment remains wrong.

| Synthetic scenario | Review the expected behavior and independent disposition | Possible classifier tags, conditional on actual triggers |
| --- | --- | --- |
| **Mid-period hire** — `SYN-HIRE-A` begins halfway through an invented month and is paid in the latter cutoff. | Check original effective date, eligibility, prorated basic/days/hours, omitted earlier cutoff, month-level roster, statutory timing and net/GL; correct employee inclusion or proration and rerun. | `new_hire`, `statutory`, `net_variance`; `new_to_run` only if **not** new hire. |
| **Variable pay** — `SYN-VAR-B` has a fictional approved ₱3,200 commission plus a separate expense reimbursement. | Check earned period and original approval, taxable vs reimbursement classification, gross/withholding contribution bases, GL account and net; no `variable_pay` category exists. | `net_variance`, `statutory`; `overtime_spike` only if OT trigger is truly met. |
| **13th-month** — `SYN-13-C` receives a part-year payment at an invented later cutoff. | Independently reconcile entitled basic earnings/YTD, timing, already-paid amount, separation overlap, current-year tax treatment/thresholds, gross/net and journal; correct omissions/double-pay. | `net_variance`, `statutory` if WHT line changes; `salary_change` only if pay revision. |
| **Final pay** — `SYN-EXIT-D` leaves between cutoffs with unused leave and loan recovery. | Validate actual separation, final wages, earned 13th allocation, authorized leave conversion, lawful loan/deduction refunds, applicable withholding, net/GL and exclusion from later active payroll. | `separation`, `net_variance`, `statutory` as triggered. |
| **Retro SSS/Pag-IBIG** — `SYN-RETRO-E` has a fictional prior salary-base correction in a current cycle. | Tie to original released period; calculate SSS/MPF and Pag-IBIG EE/ER separately using then-applicable rules, prior collections, caps, refund/true-up and once-only posting. Keep `SSS_PAYABLE` and `PAGIBIG_PAYABLE` distinct, assess agency amendment. | `retro`, `statutory`, `salary_change` if revised, `net_variance`. |
| **`HOLIDAY_UNWORKED`** — `SYN-HOL-F` is eligible for an invented unworked holiday. | Verify holiday calendar and type, work/non-work record, salaried/daily-paid and eligibility rules, paid holiday and no double-counted basic/holiday credit; check taxable base and GL. No generic holiday category exists. | `net_variance`/`statutory` only if those classifier conditions trigger. |
| **Night differential stacking** — `SYN-ND-G` works approved hours overlapping an invented holiday/rest-day/OT shift. | Check minutes once, actual holiday/rest/OT/ND conditions, statutory floor and approved CBA/policy stacking, no double premium for the same minute, taxable contribution base, net and GL. **Never presume a single multiplier for all cases.** | `overtime_spike` only above its explicit threshold; `net_variance`, `statutory` conditionally. |
| **Calamity premium** — `SYN-CAL-H` works during an invented calamity with a configured employer hazard policy. | Confirm event declaration, eligibility and actually applicable employer/CBA `CALAMITY` rule, dates/minutes, regular compensation and additional premium, taxes/statutory bases; **do not imply a universally mandated calamity percentage**. | `net_variance`, `statutory`, `exception` if actual triggers apply. |

For trace line meanings (`OT`, `ND`, `HOLIDAY`, `CALAMITY`, `RETRO-`), use [`payroll-explain.ts`](../src/lib/payroll-explain.ts). The [synthetic golden pay-rules runner](../scripts/golden-pay-rules-phase3.ts) can test engineering behavior, **not** independently certify a real employer or current regulatory position.

## 6. Bundle and exact CLI flags / bindings

Use **one** private `files/` root for all manifests. Copy these source-controlled **incomplete** templates to the vault: [parallel](../certification/parallel-payroll-template.json), [external](../certification/external-evidence-template.json), [operational](../certification/operational-evidence-template.json) and [bindings](../certification/acceptance-bindings-template.json). **Never fill checked-in templates with actual employer data.** Keep completed evidence files, IDs, SHA-256s and signers private.

~~~text
certification/external-private/EMPLOYER_CODE/
  parallel.json                  # payroll and GL sources, schemaVersion 1
  manifest.json                  # external proof documents and IDs
  operational.json               # nine proof kinds, DR, role separation
  bindings.json                  # review/filing/bank binding to checked documents
  pilot-report.json              # optional no-money pilot only
  parallel-report.json           # required ordinary two-month checker
  files/                         # common private root for relative filePath
  signed-decisions/              # out-of-band human original evidence
~~~

### A. `parallel.json`

`schemaVersion: 1`; same real legal `legalEntityCode`; `cycles[]` of distinct nonfuture `period` values `YYYY-MM` (pilot **1–12**, ordinary **2–12**). **Each** period has independent `incumbentPayroll`, `linawPayroll`, `incumbentJournal`, `linawJournal` with private relative `filePath` and actual lowercase 64-hex `sha256`. Each file must be a nonempty canonical CSV inside the root (≤8 MiB, 1–50,000 data rows). No reused physical path/inode across **all months and roles**. The comparator enforces equal worker populations, employee field differences, gross/net identity, balanced and correctly bridged GL, and aggregate field differences. The script returns per-field **counts**, not signed cause determinations.

### B. `manifest.json` — external evidence

`schemaVersion: 1`; `legalEntityCode`; `documents[]` of unique **non-placeholder** `id`, one of the exact evidence `kind` strings, same `legalEntityCode`, private relative `filePath`, actual `sha256`, actual `issuer`, genuine `externalReference` and valid nonfuture `issuedAt` (`YYYY-MM-DD`). The allowed kinds are `independent-review`, `professional-license`, `incumbent-payroll`, `linaw-payroll`, `variance-analysis`, `independent-checker`, `government-submission`, `government-receipt`, `bank-accepted-test` and `bank-rejected-test`. Proof that purports to be external (review, license, government receipt, bank tests) cannot use PayrollPH as its issuer. Operator-provided document IDs should be opaque and nonsensitive because errors can refer to IDs.

- `independentReview.reviewId` → `independent-review`; `independentReview.professionalLicenseId` → `professional-license`. Independent verification of signature/license authenticity still required.
- `parallelCycles[]`: **at least two distinct** `period` months. Each has `incumbentId` → `incumbent-payroll`, `linawId` → `linaw-payroll`, `varianceId` → `variance-analysis` and `checkerSignoffId` → `independent-checker` document IDs.
- `governmentFilings[]`: **exactly the five** needed for bindings/GA: `BIR:1601-C`, `BIR:Alphalist`, `SSS:R-3`, `PhilHealth:EPRS`, `Pag-IBIG:eSRS/MCRF`. Each uses `agency`, `form`, `submissionId` (kind `government-submission`) and `acceptanceId` (kind `government-receipt`); store real distinct original submission and receipt documents/issuer references. BIR 2316 is a separately reviewed operational sample.
- `bankUat.bankName` (actual counterpart), `bankUat.acceptedTransferId` → `bank-accepted-test`, `bankUat.rejectedTransferId` → `bank-rejected-test`. Bank UAT must separately cover a genuine authorized low-value accepted case, negative/rejected case, failure/reversal and reconciled duplicate-prevention proof, not a no-money preview.

Standalone checker success only means `package-ready-for-human-verification`; it **does not authenticate** issuers, external bank/agency results or professional licenses. See [evidence validator](../src/lib/external-certification-evidence.ts) and [external handoff](../docs/payroll-certification/external-evidence-handoff.md).

### C. `operational.json` — nine proof kinds + witnessed DR

`schemaVersion: 1`; same `legalEntityCode`; `engineCommitSha` equal to the exact reviewed **40 lowercase hex** CLI SHA; `documents[]` with one of **each** of the **nine exact** proof kinds below. Every document has `kind`, private relative `filePath`, valid nonfuture `issuedAt`, lowercase 64-hex `sha256` and a named `issuer` **different** from named `independentlyReviewedBy`. Files must be nonempty regular files ≤8 MiB inside the root; hashes match actual bytes.

1. `bir-2316-sample-reviewed`
2. `filing-format-reviewed`
3. `low-value-payout-authorization`
4. `negative-and-reversal-uat`
5. `encrypted-backup-control`
6. `isolated-restore-rehearsal`
7. `rollback-rehearsal`
8. `security-access-review`
9. `privacy-retention-approval`

`recovery.exerciseEnvironment` must be literal `isolated-production-like-staging`. Capture valid nonfuture ISO instants with UTC offset for `snapshotCapturedAt` ≤ `incidentDeclaredAt` ≤ `restoreVerifiedAt`. Restore must have been verified **within 90 days**. The validator computes `measuredRpoMinutes = ceil((incidentDeclaredAt - snapshotCapturedAt)/60,000)` and `measuredRtoMinutes = ceil((restoreVerifiedAt - incidentDeclaredAt)/60,000)`. Record agreed integer `rpoObjectiveMinutes` (**0–10080**) and `rtoObjectiveMinutes` (**1–10080**), with actual measurements **≤ objectives**. All five fields must be literal `true`: `backupEncrypted`, `isolatedRestoreConfirmed`, `sourceAndRestoreChecksumsMatch`, `rollbackSuccessfullyRehearsed`, `representativeDatasetPrivacyReviewed`. Keep witnessed encrypted snapshot restore, schema/FK/totals, privacy and rollback evidence private. Synthetic CI restore is **not** production-like external recovery proof.

`separationOfDuties`: real distinct `preparedBy`, `independentlyCheckedBy`, `releaseDecisionOwner` (three different named people) and valid dated `reviewedAt` after the restore. This only yields `operational-evidence-ready-for-human-review`. See [operational validator](../src/lib/production-certification-gates.ts) and [production GA gates](../docs/payroll-certification/production-ga-gates.md).

### D. `bindings.json` — required, cross-checked accepting evidence

`schemaVersion: 1`; exact same valid `legalEntityCode` as `parallel.json`/`manifest.json`/`operational.json`; exact `engineCommitSha` as the separately reviewed **40-character** lowercase CLI SHA. `payrollMonths[]` must be **exactly the same set** of ≥2 unique valid `YYYY-MM` months in `parallel.cycles[]`, `manifest.parallelCycles[]` and actual reconciling result (no extras, missing or duplicate months); **each** needs **≥10 matched real employees**. The ordinary no-`--pilot` reconciliation and external checks must first pass.

- `independentReview`: `reviewEvidenceId`/`reviewSha256` and `licenseEvidenceId`/`licenseSha256`, matching original external manifest `reviewId` and `professionalLicenseId`, expected kinds/employer and actual **lowercase** SHA-256 values.
- `governmentFilings[]`: **exactly five unique mandated `agency`/`form` pairs and no extras**. Every pair includes `submissionId`, `submissionSha256`, `submissionExternalReference`, `acceptanceId`, `acceptanceSha256`, `acceptanceExternalReference`. All must match **the same** checked external manifest documents by ID, kind, legal employer, hash and original issuer reference. No reused proof IDs or acceptance receipt IDs; acceptance issuer references must be unique **per agency**.
- `bankUat`: `bankName` equals external manifest. Distinct `accepted` and `rejected` objects each have `evidenceId`, `sha256` and `externalReference` matching the checked accepted/rejected evidence documents; nonempty **unique** bank external references; no reused proof ID.

Failure yields `binding-blocked`. Success is **`structurally-bound-pending-authenticity-review`**, **`gaApproved: false`**. The validator proves only internal metadata/byte linkage, never origin authenticity. [Binding source](../src/lib/external-acceptance-bindings.ts) · [template](../certification/acceptance-bindings-template.json).

### E. Run exact commands locally (private evidence only)

**Source CLI names and positional inputs are from the actual scripts and [package scripts](../package.json).** The placeholders below are instructions to the private operator, **not real evidence or a passing example**.

~~~sh
# External evidence; 2 required positional arguments
npm run payroll:evidence:check -- \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/files

# Acceptance binding; EXACTLY 5 positional arguments, no --pilot
npm run payroll:acceptance:check -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/bindings.json \
  certification/external-private/EMPLOYER_CODE/files \
  EXACT_40_CHARACTER_REVIEWED_ENGINE_COMMIT_SHA

# Combined GA EVIDENCE assessment; EXACTLY 6 positional arguments;
# operational.json AND bindings.json are required; no --pilot
npm run payroll:ga:evidence -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/operational.json \
  certification/external-private/EMPLOYER_CODE/bindings.json \
  certification/external-private/EMPLOYER_CODE/files \
  EXACT_40_CHARACTER_REVIEWED_ENGINE_COMMIT_SHA
~~~

| Command | Exact arguments | Possible successful structural status | Authority |
| --- | --- | --- | --- |
| `payroll:parallel:check` | `<parallel.json> <private-root> [--pilot]` | `pilot-arithmetic-reconciled-pending-independent-review` with `--pilot`; otherwise `arithmetic-reconciled-pending-independent-review` | Arithmetic and source-file integrity only; failed check → `reconciliation-blocked`/exit 1. |
| `payroll:evidence:check` | `<manifest.json> <private-root>` | `package-ready-for-human-verification` | Local document hashes/links only; failed → `evidence-incomplete`/exit 1. |
| `payroll:acceptance:check` | `<parallel.json> <external.json> <bindings.json> <private-root> <reviewed-40-char-SHA>` | `structurally-bound-pending-authenticity-review`; **`gaApproved: false`** | Cannot use pilot month or substitute for issuer authentication; failed → `binding-blocked`/exit 1. |
| `payroll:ga:evidence` | `<parallel.json> <external.json> <operational.json> <bindings.json> <private-root> <reviewed-40-char-SHA>` | `evidence-ready-for-independent-final-review`; **`gaApproved: false`** | Not an approval to submit/pay or launch GA; failed → `blocked`/exit 1. |

For 5-/6-argument scripts, each JSON manifest must be a nonempty file ≤256 KiB and the reviewed SHA must be **exactly 40 lowercase hex characters** and equal in operational/binding manifests. No `--pilot` is accepted for either script. Keep results private: even if parallel output omits PII, operator-supplied IDs/references and external documents may be sensitive, and none of these scripts sanitizes arbitrary originals for public distribution.

## 7. Out-of-band **named** human sign-off (private blank template)

**Not to be completed in Git.** The actual employer must supply **named, authenticated individuals**; no program, benchmark, test, AI agent, digest or CI workflow can act as their approval or independently authenticate an issuer. Preserve signed originals and verification trail under private `signed-decisions/`.

| Required private field | To be completed and checked by humans |
| --- | --- |
| Actual registered legal employer name and code | [LEGAL NAME / CODE — PRIVATE] |
| Authorized tenant, period(s), employee count each period | [REAL RUN SCOPE / AT LEAST TWO REAL MONTHS FOR GA — PRIVATE] |
| Incumbent run/version; PayrollPH exact reviewed engine commit | [ORIGINAL SYSTEM + EXACT SHA — PRIVATE] |
| Original register and journal evidence, HMAC/CoA normalization map | [CONTROLLED ORIGINALS AND MAPPING REFERENCE — PRIVATE] |
| Final original-file digests, local report digest and issue resolution register | [EXACT PRIVATE HASH/REFERENCE — PRIVATE] |
| All worker/component/GL variances and statutory edge cases | [RESOLVED / BLOCKED + REVIEWER OPINION ID — PRIVATE] |
| No-money bank-file preview, immutability and forbidden payout/filing settings | [RUN-SCOPED VERIFIED PREVIEW — PRIVATE] |
| External license, BIR/SSS/PhilHealth/Pag-IBIG, bank UAT and reversal | [AUTHENTICATED ISSUER/RECEIPT REFERENCES OR **PENDING**] |
| Witnessed encrypted staging DR, RPO/RTO, DPO/security/role separation | [ORIGINAL AUTHENTICATED RECORDS OR **PENDING**] |
| Decision scope and unresolved exceptions | [CONTROLLED NO-MONEY PILOT / HOLD / REJECT; SEPARATE GA RECORD] |

**Named employer representative (Owner, not independent reviewer)**

- Full legal name **[REQUIRED ACTUAL NAME]**; employer job title, delegated authority and independently confirmed identity **[REQUIRED]**.
- Original attestation: “I examined this employer's actual frozen inputs, incumbent release, PayrollPH no-money run, reconciliation, every variance disposition and the protected post-release bank-file preview for the stated run/engine version. I authorize **only** the explicitly identified no-money pilot if all blockers are resolved; I do **not** authorize any bank submission, actual payout, agency filing or GA by this signature.”
- Decision **[APPROVE NO-MONEY PILOT / HOLD / REJECT]**; actual original signature, date/time, private record ID and evidence digest **[REQUIRED]**.

**Named independent reviewer (different real person from preparer and employer representative)**

- Full legal name **[REQUIRED ACTUAL NAME]**; independent organization/role **[REQUIRED]**; independently authenticated professional/license proof record **[REQUIRED]**.
- Original attestation: “I examined both original-source payroll registers and GL journals, HMAC mapping and source independence, effective rules and statutory edge cases, all employee/component/aggregate and ten control reconciliations, bank-file no-money proof, exact artifact/source hashes and every exception's resolution. Any qualifications are in my signed professional opinion; code checks are not my opinion.”
- Decision **[INDEPENDENTLY REVIEWED AND RECONCILED FOR SPECIFIED SCOPE / HOLD / REJECT]**; dated signed opinion ID, private digest and actual signature **[REQUIRED]**.

**Separate release decision owner / committee**

- Full legal name/authority **[REQUIRED ACTUAL PERSON, DIFFERENT FROM PREPARER AND CHECKER]**.
- Independently verify authenticity of underlying government/bank acceptance, reviewer license, employer scope, production-like recovery/security, exact reviewed engine SHA and lawful release conditions; record an actual dated **signed decision** outside CI.
- Disposition **[CONTROLLED PILOT ONLY / GA DECLINED / GA APPROVED ONLY FOR EXPLICIT AUTHORIZED EMPLOYER SCOPE AFTER ALL REAL GATES]** and private signed reference **[REQUIRED]**. This decision is **not** generated by or written back as `gaApproved: true` in any checker report.

## 8. “Evidence-ready” ≠ GA approved

The [combined result type](../src/lib/production-certification-gates.ts) has only `"blocked"` or `"evidence-ready-for-independent-final-review"` and **literally returns `gaApproved: false`**. [Acceptance bindings](../src/lib/external-acceptance-bindings.ts) also hardcode **`gaApproved: false`**. The strongest automated result means supplied local bytes, arithmetic, metadata, binding IDs, file hashes, role names and asserted recovery measurements met the **structural** thresholds. It **does not** prove the original records are true or the signers, professional license, government agency, bank and production-recovery claims are genuine.

**Never present** `evidence-ready-for-independent-final-review` as “certified,” “bank approved,” “BIR/SSS/PhilHealth/Pag-IBIG accepted,” “production DR proven,” “permission to disburse” or “GA approval.” Actual original issuance/portal acknowledgements, bank accepted/rejected/reversal and settlement proof, latest statutory correctness, source SHA and employer policies, separate SRE/DPO/CPA evidence and **named employer + independent reviewer + release committee** sign-off remain mandatory outside CI. If a real source, approved month, evidence, engine commit or applicable rule changes, freeze escalation, rerun impacted gates, reauthenticate and re-sign.

Until that out-of-band employer-scoped human release decision, **controlled pilot only; `gaApproved: false`.** Synthetic examples and the [benchmark](../scripts/benchmark.ts) must never be submitted as evidence. No tool can substitute for the human decision.
