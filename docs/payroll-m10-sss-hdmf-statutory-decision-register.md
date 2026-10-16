# M-10: SSS / Pag-IBIG retroactive pay and remittance correction — official-source decision register

**Prepared:** 2026-10-16. **Classification:** source research and agency/practitioner decision handoff; **NOT an approved statutory interpretation, current agency clearance, payment instruction, file certification, or release authorization**.  
**Issue:** [#1044](https://github.com/erwinmehehe/payrollph/issues/1044); master [#744](https://github.com/erwinmehehe/payrollph/issues/744); filing gate [docs/ph-official-filing-acceptance-pilot.md](ph-official-filing-acceptance-pilot.md).  
**Engineering baseline:** merged #1042 exposes a read-only centavo/source-month review; #1096 pins fictional contribution boundaries. Neither provides an accepted prior-period remittance remedy. Source work month is evidence, **not automatically an SSS/HDMF contribution or payment month**.

## Authority register: what the published materials actually establish

| ID | Agency | Primary official reference and limited supported finding | What this **does not** decide |
| --- | --- | --- | --- |
| S1 | SSS | [SSS Circular 2024-006, pp. 1–2](https://www.sss.gov.ph/wp-content/uploads/2024/12/CI-2024-006-Publication.pdf): business employer/employee contribution schedule effective **January 2025**; 15% total SS (10% employer, 5% employee), with MSC bracket table to PHP 35,000; EC is employer funded. [SSS Pay Contributions](https://www.sss.gov.ph/pay-contribution/) explains monthly compensation and e-CS/PRN. | Which year's/month's schedule governs a **later-paid prior-work-month adjustment**, or what amount an agency will accept as a historical amendment. |
| S2 | SSS | [SSS Employer](https://www.sss.gov.ph/employer-er/) states employers deduct employee share on gross monthly compensation, remit employer share and EC, keep payroll/receipt records; underreported/unpaid contributions can create assessed liabilities and 2% monthly penalties. [SSS Pay Contributions](https://www.sss.gov.ph/pay-contribution/) says employers use e-CL and PRN and can edit the e-CL to issue a **new PRN**. | Authority to silently change **paid/posted** PRNs, automatically compute a penalty, or net prior-month differences into a current month. |
| S3 | SSS | [Official SSS Form R-3](https://www.sss.gov.ph/wp-content/uploads/2022/03/SSSForms_Contribution_Collection_List.pdf), p. 1, includes **Addition to Previously Submitted R-3** and **Deduction from Previously Submitted R-3**; p. 2 instructs adjustments based on the period's actual remuneration and prior posted list. [2025 SSS Citizen's Charter](https://www.sss.gov.ph/wp-content/uploads/2025/06/SSS-Citizens-Charter-2025-1st-Edition.pdf) indexes a member-facing request for correction/refund/posting/adjustment of contribution. | Whether a particular employer's modern e-CS transaction can be amended using R-3, the permitted electronic workflow, refund/credit mechanics, fee or acceptance. Obtain SSS instructions and an actual acknowledged case. |
| H1 | HDMF | [HDMF Circular 460 (official location)](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20460%20-%20Guidelines%20on%20the%20Pag-IBIG%20Fund%27s%20Implementation%20of%20Increase%20in%20the%20MFS%20Effective%20February%202024.pdf) and [Philippine government announcement](https://pco.gov.ph/other_releases/pag-ibig-members-to-gain-more-benefits-under-new-rates-starting-february-2024/): for ordinary covered employees, **February 2024 onward**, maximum fund salary PHP 10,000 (previously PHP 5,000), ordinary member/employer 2% each above PHP 1,500, generally up to PHP 200 each. The Circular explicitly has exceptional rules for kasambahays and other member categories, and supersedes inconsistent older contribution amounts. | Whether a particular historical backpay adjustment belongs to the earning month or actual payment month, and whether the applicable employee category changes the result. |
| H2 | HDMF | [Circular 274, Section E(3.1–3.3)](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20No.%20274%20-%20Revised%20Guidelines%20on%20Pag-IBIG%20Fund%20Membership.pdf) distinguishes **previously deducted but unremitted sums** under enforcement (may be applied retroactively with employee proof) from **never deducted** amounts, where enforcement payments/member catch-up can be treated as a **single** contribution rather than assigned to missed months. [Circular 275, employer enforcement portion](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf) similarly distinguishes deducted/unremitted from not-collected contributions. | These are **delinquency/enforcement** provisions. Do **not** generalize them to all late salary differentials or assume unchanged treatment without a current HDMF agency interpretation. |
| H3 | HDMF | [HDMF eSRS payment guide](https://www.pagibigfund.gov.ph/document/pdf/payments/ESRS.pdf), p. 3, says incorrect uploaded **remittance files** are rejected and should be corrected/re-uploaded. [Official electronic remittance service](https://hdmf-sdd-sandbox.pagibigfund.gov.ph/Views/HomePage.aspx) links eSRS. | Whether a **submitted/unposted or accepted/paid/posted** eSRS record can be canceled, revised or credited. A rejected upload is **not** evidence that a posted remittance can be edited. MSRF, MCRF, payment-instruction and receipt workflows must not be conflated. |

**Source access limitations:** As of this research, direct Pag-IBIG PDF endpoints sometimes returned an anti-bot challenge; the first-party indexed document text, government announcements, and a copy of Circular 460 were used for cross-checking. Before a binding sign-off, the reviewer must obtain the **current agency-issued originals**, verify amendments/repeals and identify exact sections. SSS Form R-3 is a legacy-form format (Rev. 08-99) even though it remains available on the SSS website; do not presume that this paper procedure is the current accepted e-CS amendment route.

### Negative inference controls

- The SSS prohibition on retroactive gap-filling for **voluntary/self-employed** members does **not** establish the employer correction policy for compulsory employees. Do not apply it to M-10 without an SSS ruling.
- A payroll **work/source month** can be proven from the Released source run, but that alone does **not** establish the legally applicable **contribution assessment month**, file period or agency posting month. Both agencies discuss remuneration/earnings received in a month; backpay's exact statutory attribution still requires a separately documented decision.
- An **adjustment form**, a draft upload, a successful checksum, and a payment receipt are different evidence. No claim of correction acceptance is made until the agency confirms the relevant **member/month posting**.
- Published base rates/caps do not justify applying the **2025 SSS table** to January 2024, the **February 2024 HDMF limit** to January 2024, or any default rate to unverified employee coverage categories.
- Default M-10 behavior is **review only**. Do not mutate Released payroll, original agency ledger, tax records, employee deductions or payout records. Preserve the non-waivable `STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED` blocker, including with `acknowledgeExceptions=true`.

## Separate written agency decisions required — NOT YET OBTAINED

Obtain one **SSS** opinion and one **HDMF** opinion, each with agency/practitioner name, role, issue date, official section/circular, signed decision, scoped employer and employee category, supporting transaction evidence, and reviewed source SHA. These must answer all of the following **independently**:

1. **Classification and time:** For (a) wages legally earned in an earlier work month but **first paid later**, (b) prior wages **already paid but underreported**, (c) earlier **deducted-but-unremitted** contributions, and (d) negative wage/SSS/HDMF corrections: which period receives the assessed contribution, and which period appears in official files and member ledger? Is there a different rule for an originally correct filing versus a filing error?
2. **Effective rates and splits:** Exact historical schedule, MSC/MFS bracket, SS/MPF/EC, EE and ER portions, employee/category exceptions, floor/cap and decimal rounding; whether approved correction uses original month's rates or payment month's rates. Check 2024 January/February HDMF and 2024 December/2025 January SSS boundaries.
3. **State machine:** Exact accepted method when prior record was **not generated**, **generated but not submitted**, **submitted but unposted**, **accepted and paid but not member-posted**, **accepted and posted**, **rejected**, or **already corrected/credited/refunded**. Define whether amendment, replacement, supplemental payment, refund, offset, or human branch review is available in each state.
4. **Forms and receipts:** SSS modern e-CL/PRN and applicability of R-3 adjustment/other specific request forms; HDMF eSRS MSRF/MCRF and payment instruction. Provide sanctioned format/spec, original reference linkage, member/month correction reference, rejection reason and final agency-accepted posting proof.
5. **Financial/legal authority:** Penalty handling, underpaid employer shares, employee share recovery/return, treatment of sums not previously withheld, already deducted amounts, employer-only late liabilities, interest/dividends where relevant, and payroll/workforce authorization needed for any worker recovery.
6. **Cross-year, cap, and reversals:** Dec/Jan and historical rate cutovers, same/monthly multiple cutoffs, over-MSC/MFS limits, negative retro, partial reversal, repeat uploads and already accepted correction replay. State exactly which workflows are **prohibited** or **manual-only**.

**Decision record template (one per agency):** `agency | officer/practitioner | credential/contact (restricted) | signed date | circular section | employer class | retro case type | source work month | correct contribution month | file/remittance month | original agency status | permitted remedy + form | rate schedule | EE cents | ER cents | EC/MPF cents | interest/penalty basis | original receipt | correction receipt | accepted member posting | exceptions | approved source SHA | checker signed date`.

Until the independent decision exists, enter `POLICY_UNRESOLVED`, not `zero contribution`, `same as current month`, or `approved`.

## Minimum 12 fictional test decisions (repeat for two unrelated fictional employers)

For each row, independently prepare **SSS and HDMF** expected/actual worksheets; do not insert guessed statutory cents. Also test missing source, cross-tenant source, unreleased source, unmatched employee and sub-cent invalid input as fail-closed variants.

| ID | Source/correction case | Filing status to simulate | Required signed outcome |
| --- | --- | --- | --- |
| 01 | Same-month positive change | Not submitted | Authorized current-month recomputation or denial |
| 02 | Same-month negative change | Not submitted | Authorized subtraction and employee treatment |
| 03 | Earlier-month positive underpayment | Not submitted | Source/assessed month, correct schedule, original-file handling |
| 04 | Earlier-month negative reversal | Not submitted | Allowed reversal (or prohibition), EE/ER and net money |
| 05 | Earlier-month positive adjustment | Submitted but unposted | Allowed replacement/correction and accepted upload |
| 06 | Earlier-month negative adjustment | Submitted but unposted | Allowed stop/replacement/rejection outcome |
| 07 | Earlier-month positive adjustment | Paid and member-posted | Original receipt linkage, supplemental/correction acceptance |
| 08 | Earlier-month negative adjustment | Paid and member-posted | Actual refund/credit/reversal decision; no negative payment |
| 09 | Duplicate retry after approved prior correction | Correction accepted | Idempotency, original + correction receipts, zero duplicate posting |
| 10 | December 2024 earnings, settled January 2025 | Various | **SSS** 2024/2025 schedule and assessment decision; HDMF independent decision |
| 11 | January 2024 earnings, settled February 2024 | Various | **HDMF** pre-/post-Circular-460 cap and assessment decision; SSS independent decision |
| 12 | Earlier-month ambiguous/unverifiable source | Any | Non-waivable denial: no period inference, no agency export |

**Centavo ledger columns for each employer × employee × agency × month:** immutable original run/entry id and SHA; original gross statutory compensation, contribution bracket, historical rate/EE/ER/EC/MPF and original withheld/remitted cents; signed retro delta cents; **reviewer-authorized** newly assessed compensation, bracket and EE/ER/EC/MPF cents; agency-accepted paid/posted amounts; delta; over/under-payment balance; receipt/rejection IDs; duplicate-control key and reviewer result. Expected vs actual **per employee**, **per statutory month**, **per agency**, and **employer grand total** must equal to the centavo. No signed determination => expected statutory correction value is `UNKNOWN_POLICY` (not numeric zero).

## Proposed follow-on implementation boundary — conditional, not approval

Only **after** both agency opinions and acceptance evidence:

1. Establish **effective-dated**, agency-specific policies and explicit eligibility scope; deny unknown combinations. Model SSS and HDMF separately (never a universal `retroContributionDelta` remittance rule).
2. Ingest read-only source-run work month, legal employer, exact employee entry, adjustment cents and historical contribution ledger; require human-reviewed statutory period independent of source-work-month. Ensure immutable previous-posting reference and no cross-tenant exposure.
3. For an approved scenario, calculate `agency-approved revised employee/month liability minus original agency-accepted liability` **in integer centavos** by EE/ER/EC/MPF. Differences are proposed reconciliation entries, **not automatically collectible or creditable**.
4. Use a strict transaction state machine (draft → independently reviewed → authorized submission → submitted → accepted/rejected → paid → member-posted → reconciled). Separate rejection/retry, accepted amendment, credit and reversal branches. Tie idempotency keys to legal employer + agency + employee + statutory month + original receipt + correction kind/version; prevent simultaneous/replayed double collection.
5. Never rewrite Released runs or offset a posted prior month into a current remittance without exact approved agency process. Retain auditable before/after ledger, original and replacement receipt/hash, payroll maker/checker authority and compensating rollback plan.
6. Prove regression/PG multi-tenant isolation, idempotent retries, concurrency, Dec/Jan rates, no double posting, negative/refund handling, `acknowledgeExceptions=true` still blocked, and exact-head CI.
7. Have the qualified reviewer and employer sign off the exact source SHA and centavo ledgers; use sanctioned agency workflows to retain **real accepted or rejected** receipts before saying an upload format/remittance correction works. Never use a live employee submission merely to test the software.

## M-10 disposition

**Source research: PARTIAL; rate/form identification: SOURCED WITH SCOPE LIMITS; SSS agency decision: NOT_OBTAINED; HDMF agency decision: NOT_OBTAINED; practitioner: NOT_ASSIGNED; centavo acceptance: NOT_RUN; portal posting: NOT_RUN; historical remittance implementation: NOT_AUTHORIZED; release: NO-GO.**

**#1044 must remain OPEN.** The doc's purpose is to replace unstructured assumptions with explicit source evidence and review questions, **not** to turn published background rules into an agency sign-off.
