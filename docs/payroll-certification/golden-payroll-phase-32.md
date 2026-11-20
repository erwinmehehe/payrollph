# Golden payroll Phase 32: final pay honours every earning the cutoff exempted

Phase 25 and #2042 carried a released exempt **allowance** (an `EARN-` line) into final pay's
annualization. Year end also treats a non-taxable company premium and an exempt leave
conversion as exempt, because the cutoff withheld as if they were not paid. Final pay did not,
so a separated worker was taxed on pay the cutoff had exempted and under-paid. Phase 32 proves
the gap and certifies the fix.

- Catalog: `certification/golden-payroll-phase32.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase32.ts` (real engine, real
  `runYearEndAnnualization`, real `computeFinalPay` fed the year-to-date inputs exactly as the
  Separation API derives them from the released rows)
- CI: `.github/workflows/golden-payroll-phase32-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

This phase ships with a **calculation change** (`src/lib/final-pay.ts`). It is a T3 payroll
change and needs independent review.

## The defect (observed, the phase fails on the unfixed code)

`releasedExemptAllowanceYtd` recognised only `EARN-` allowance lines. Running this harness
against it, on a 60,000 salary with 12 cutoffs:

| Worker | Exempt pay in the year | Final-pay tax | Net final pay | Under-paid |
|---|---|---|---|---|
| noExemptEarningControl | none | 13,395.00 | 55,714.20 | none |
| nonTaxableCompanyPremium | 2,400.00 (25.00 an hour x 8 hours x 12) | 13,755.00 | 55,354.20 | **360.00** |
| exemptLeaveConversion | 10,000.00 (5 days x 2,000.00) | 14,895.00 | 54,214.20 | **1,500.00** |

Year end was right in every case (tax 13,395.00, refund 25,714.20). Only final pay, and its
parity with year end, failed (16 mismatches).

## The fix

`releasedExemptAllowanceYtd` now also counts, with the same fail-closed rule (the exemption is
never inferred from a missing, repeated or conflicting note):

- a company premium line (`PREM-`, `OTPREM-`, `NDPREM-`, `DAYPREM-`) whose single `Taxable:`
  note says `Taxable: no`;
- a `LEAVE_CONV-` line whose single `Tax treatment:` note says `Tax treatment: exempt`.

The Separation API route is unchanged: it already passes this helper's result to
`computeFinalPay`. The helper feeds the source fingerprint, so a pending final-pay package
computed under the old rule has a different fingerprint and must be recomputed before approval
or release.

## Evidence

- Phase 32: 3/3 with the fix; 16 mismatches without it. Phase 25 still 2/2.
- `tests/final-pay-released-exempt-earnings.test.ts`: 7 unit tests (each premium family,
  taxable and exempt conversions, unchanged allowance rule, missing/repeated/conflicting notes,
  malformed amounts failing closed).
- Mutation checks: removing the premium branch fails `nonTaxableCompanyPremium` (8 mismatches)
  and removing the conversion branch fails `exemptLeaveConversion` (8); each leaves the other
  cases passing.

## Tenant-isolation source pins

`src/lib/final-pay.ts` is a pinned source of the Phase 25 separation hold. Its blob changes, so
four one-line pins follow the same chain #2042 used: the `final-pay.ts` blob in
`scripts/qa/phase25-separation-hold.json` and `tests/tenant-prior-2316-post-final-pay.test.mjs`,
then the hold archive's own blob in `scripts/qa/document-source-accounting.mjs`, then that file's
blob in `scripts/qa/wage-registry-renewal-verify.mjs`. **No manifest status, credit, receipt or
hold content changed.** Updating the pins does not re-review the held separation methods: their
independent tax/security review remains pending, and this PR is itself gated on independent
review.

## Limitations

- Only a non-taxable worked-time premium (`PREM-`) and one exempt leave conversion are
  exercised; `DAYPREM-`, `OTPREM-` and `NDPREM-` are recognised by the same prefix rule and
  covered by unit tests only.
- A year-end termination with no imported periods, other outstanding pay, loans, separation pay,
  final leave monetisation or prior-employer income, as in Phase 25.
- The route cannot be called from a harness (it needs a session); the Phase 25 source test pins
  the expressions the harness reproduces.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data. Money,
payout, provider, CSP and calculation-history flags stay off. No method is credited or
re-credited.
