# PayrollPH payroll accuracy: external-source spot check and pilot handoff (18 October 2026)

**Status: ENGINEERING SOURCE CHECK ONLY — NO-GO** for real-company payroll, agency corrections, filing, bank transmission, payouts or general availability. Distinguishes source-reference arithmetic, code behavior, actual fictional database aggregates, and missing human/agency approvals. Neither source tests nor this packet constitute statutory practitioner certification.

**Scope:** Source-only branch, official references below; all existing financial/operational release flags remain OFF. Issues #1044 (SSS/HDMF retro), #1102 (historical fictional demo headers), #579 (real no-money employer) stay OPEN. Exact GitHub Actions CI on final PR head must pass before any merge claim.

## Official-source 2026 arithmetic and known limitations

| Source | Code examined | Independent worked examples | Disposition |
| --- | --- | --- | --- |
| [SSS 2024-006 schedule effective January 2025](https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf); [SSS contribution site](https://www.sss.gov.ph/pay-contribution/) | SSS_RULE_PACKS, computeSss: 5% employee, 10% employer, MSC 5k-35k, regular/MPF split at 20k, EC employer-only | Salary PHP5,250 => MSC5,500 EE275 ER550 EC10 total835; PHP20,250 => MSC20,500 EE1,025 ER2,050 EC30 total3,105; salary PHP34,750 => total5,280 | Ordinary business employees, relevant current schedule spotchecked. Does NOT decide month attribution for prior-year/later-paid adjustments |
| [Philippine Information Agency 2026 PhilHealth](https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/) and [PhilHealth MBS Circular 2020-0005](https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf) | PHILHEALTH_RULE_PACKS / computePhilHealth: 5% of *monthly basic salary*, floor 10k, cap 100k, shared EE/ER | MBS PHP10k => monthly500/EE250/ER250; MBS30k =>1500/750/750; MBS100k =>5000/2500/2500 | M-6 daily/hourly basic monthly equivalent requires actual employee wage/divisor evidence; don't substitute bonuses/OT for fixed MBS. Assigning odd rounded centavo to employer is an internal convention, not agency-certified |
| [HDMF Circular 460 official reference](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20460%20-%20Guidelines%20on%20the%20Pag-IBIG%20Fund%27s%20Implementation%20of%20Increase%20in%20the%20MFS%20Effective%20February%202024.pdf), [government implementation announcement](https://pco.gov.ph/other_releases/pag-ibig-members-to-gain-more-benefits-under-new-rates-starting-february-2024/) | PAGIBIG_RULE_PACKS: ordinary covered employee cap10k, EE1% up to PHP1500 else2%, employer2% | Salary PHP1500 => EE15 ER30; salary PHP10k+ => EE200 ER200 | Ordinary category only; obtain current authoritative original Circular 460, category and effective-month decisions. Direct PDF sometimes anti-bot; no retro attribution/amendment conclusion |
| [BIR RR11-2018 Annex E withholding tables](https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf) and [digest](https://bir-cdn.bir.gov.ph/local/pdf/Digest%20RR%2011-2018.pdf) | BIR_WITHHOLDING_RULE_PACKS effective 2023 onward | Monthly **taxable** PHP40k => withholding3,208.40; semi-monthly taxable20k =>1,604.10; annual taxable500k =>42,500 | Table arithmetic only; does not certify input deductions/exemptions, employee category, annualization or real filing |
| [DOLE 13th-month guidance](https://bwc.dole.gov.ph/dole-bwc-urges-employers-to-release-13th-month-pay-not-later-than-december-24/) | computeThirteenthMonthPay defaults exact-cent flag OFF; thirteenthMonthFromCentavos performs integer cents basic/12 half-up | Annual basic PHP120,000 =>10,000. Illustrative PHP120,000.06 =>10,000.01 under internally chosen half-up algorithm | Basic/12 principle supported; **specific rounding choice**, prior-year BASIC/holiday policy and already-paid entitlements need payroll reviewer + owner approval. No flag activation |
| M-3 final-pay signed review | finalPaySignedBalance / default-OFF FINAL_PAY_SIGNED_REVIEW_ENABLED | Gross0, tax adjustment -PHP7,500, deductions0 => -PHP7,500 signed balance | Read-only accounting difference; not a negative payout nor automatically collectible employee debt. Needs accountant/practitioner sign-off |

**Important:** these are independent-input spot checks of isolated calculation functions, NOT a full payroll engine run, binding current agency interpretation for all employers, current filing import acceptance, or professional money certification. New regression file: tests/payroll-2026-source-spotcheck.test.ts. Preserve existing A-3 UNVERIFIED RATE markers and money-release holds until an actually qualified approval is recorded.

## #1044: independent SSS and HDMF prior-period correction decisions remain pending

The repo already has docs/payroll-m10-sss-hdmf-statutory-decision-register.md, scripts/m10-synthetic-review.ts and fictional 48-case, two-employer SSS/HDMF centavo review. Those **48 are alternative scenarios, not cumulative remittance amounts**; math matching does not prove member posting.

**SSS separate written interpretation required:** distinguish (1) prior-month wage difference first paid later from (2) wages already paid/reported incorrectly; identify proper contribution MSC/MPF/EC/rate month, positive and negative amendments, December-January boundaries, unfiled/submitted-unposted/paid-posted/rejected/reversed/already-amended states, sanctioned e-CL/PRN route, required evidence, penalty, employer/employee collection authority and member-level posting.

**HDMF separate written interpretation required:** the same fact patterns, employer category and effective MFS/rate, current lawful eSRS/MSRF correction/reversal, and deducted-but-unremitted *enforcement* vs first-paid historical wage difference. Circulars 274/275 cannot be generalized into an automated backpay rule; current Circular 460 original and accepted posting guidance must be obtained.

**Keep M-10 FAIL-CLOSED:** STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED non-waivable; no remittance correction, release override, fabricated historical receipts, or real agency upload. Agency/practitioner answers and actual accepted corrections are missing.

## #1102: original fictional demo headers — 18 October read-only inspection

Verified against Neon project calm-wave-70219564, default branch br-lucky-sound-b79i56jw, database neondb. **SELECT aggregate query only**, no employee/person rows or payroll updates. Legacy fictional records are not evidence of production calculation faults.

| Run ID / status | Detail rows | Header gross - detail gross | Header net - detail net |
| --- | ---: | ---: | ---: |
| 1 Released | 6 | -PHP5,000.00 | -PHP1,755.00 |
| 2 Pending approval | 6 | -PHP1,550.00 | +PHP1,168.00 |
| 3 Needs review | 6 | -PHP900.00 | +PHP1,724.00 |

Root cause: old persisted mock header literals differ from detail rows. Merged new public-demo six-worker generator creates matching future headers and detail; unchanged-existing-row semantics intentionally preserve old fictional data. The separate eight-worker developer seed also has a single-source fixture. **Do NOT silently write the three old headers.**

Reusable **read-only** discrepancy query (ONLY in a verified fictitious tenant, with an operator-approved target; does not fix anything):

~~~sql
WITH runs AS (
  SELECT r.id AS run_id, r.status, r.employee_count,
         COUNT(e.id)::integer AS entry_count,
         r.gross_pay::numeric(18,2) AS header_gross,
         COALESCE(SUM(e.gross_pay::numeric),0)::numeric(18,2) AS detail_gross,
         r.net_pay::numeric(18,2) AS header_net,
         COALESCE(SUM(e.net_pay::numeric),0)::numeric(18,2) AS detail_net
  FROM public.payroll_runs r
  JOIN public.organizations o ON o.id = r.organization_id
  LEFT JOIN public.payroll_entries e ON e.payroll_run_id = r.id
  WHERE o.name = 'Loom & Local'
  GROUP BY r.id, r.status, r.employee_count, r.gross_pay, r.net_pay
)
SELECT run_id, status, employee_count, entry_count,
       (header_gross - detail_gross)::numeric(18,2) AS gross_difference,
       (header_net - detail_net)::numeric(18,2) AS net_difference,
       CASE WHEN employee_count = entry_count
                      AND header_gross = detail_gross AND header_net = detail_net
            THEN 'FICTIONAL_RECONCILED' ELSE 'FICTIONAL_MISMATCH' END AS classification
FROM runs
ORDER BY run_id;
~~~

**Owner choice needed:** (A) retain historic fictional records and explicitly label these displayed summaries *legacy unverified mock amounts*, or (B) authorize a separate, precisely scoped, **disposable-database-first** correction and rehearsal with record hashes/rollback and explicit target approval. Until separately authorized, **no update, delete, reset, release, or mutation** to original Neon/shared tables. #1102 stays OPEN.

## #579: real employer no-money reconciliation — handoff ready, input missing

Existing source: docs/qa/579-private-no-money-reconciliation-handoff.md; scripts/check-private-parallel-payroll.ts; docs/payroll-certification/private-parallel-reconciliation.md. PR #1242 contains a new parallel-run operations playbook under review.

Entry prerequisites: named consenting employer with completed historical incumbent payroll, signed legal/privacy permission and protected vault; distinct independently generated incumbent and PayrollPH employee-level payroll/GL CSVs (no reused physical files); pseudonymized worker IDs with mapping held only in vault; correct cutoff/legal employer; qualified **independent** Philippine payroll checker, owner and deployment SHA; payout and all agency submissions OFF.

Private command after authorized files exist:

~~~sh
npm run payroll:parallel:check -- /absolute/private/manifest.json /absolute/private/evidence-dir --pilot
~~~

Resolve every *unexplained* absolute difference greater than **PHP0.01 per worker per component**; reconcile statutory EE/ER, tax, premiums, loans, gross/net, GL totals and dry-run bank file. Authentic originals, checker signing and employer authorization must be inspected separately from the CLI PASS. One approved employer period is an initial pilot milestone only.

**Not supplied / NOT RUN:** consenting employer, actual source period, authentic two-system data, private signed checker decision, SSS/HDMF determinations, actual agency/filing acceptance. #579 remains OPEN and no real payroll certification can be claimed.

## Engineering handoff and next authorized steps

- [x] Independently crosscheck ordinary 2026 SSS/PHIC/HDMF/BIR and DOLE basic/12 against linked government documents and source functions, with clear limitations.
- [x] Add purely fictional, no-side-effect source-reference regression tests. **Exact-head GitHub CI pending after the branch is opened; record actual status, don't assume.**
- [x] Reconfirm all three historic fictional run mismatches read-only, no data changes.
- [ ] Obtain owner/payroll reviewer policy for M-6 divisor and PhilHealth odd-cent treatment, exact 13th-half-cent choice, final-pay signed liability, and retro year attribution.
- [ ] Obtain separate qualified SSS and HDMF written source-month/remittance decisions; only then design source-only, default-OFF corrections with agency acceptance.
- [ ] Choose demo legacy labeling vs separate fully authorized mock-data correction; preserve current historic records.
- [ ] Obtain authorized real employer + independent reviewer and complete one private no-money shadow payroll cycle; validate against originals to the centavo.
- [ ] Check exact reviewed code SHA, GitHub Actions, four golden suites, targeted unit/PG tests, issuer current rules and independent sign-offs before any claim of real customer readiness.

**Hard exclusions:** no live SQL writes, production configuration, approvals, payment providers, agency submission, feature activation, actual person/payroll data, AWS spend or money movement in this work.
