# M-5 imported-history and year-end source provenance — synthetic engineering evidence

**Scope:** Fictional payroll-data acceptance only for audit #744 / #1043. Does not authorize real employer payroll, historic benefit adjustment, clawback, bank payment, government filing or closeout.

## Observed deficiency and correction

The merged final-pay parser rejects `RETRO-<adjustment ID>` without a verified original payroll year. Previously, `runYearEndAnnualization` called that parser with no source-year attribution and failed for a valid retro line paid during the annualization year. A disposable PostgreSQL test reproduced the precise `FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED` error.

This PR reuses the M-5 tenant-bound, Released, same-worker original-run lookup for year-end 13th-month BASIC. Valid retro BASIC is included only when its original source cutoff is in the requested year, irrespective of later payout year; missing/Draft/foreign/other-worker/cross-year source cannot be guessed. The year-end `thirteenthStillDue` breakdown now uses the shared centavo rounding rule, avoiding binary-floating drift such as `216.66999999999825`.

## Synthetic examples (PHP)

| Fictional employee | 2025 source basic before retro | Verified 2025 retro settled in 2026 | Corrected 2025 13th entitlement | 2025 13th paid in imported history | Signed gap | Automatic recovery/payment |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Employer A / FA-HISTORY | 360,000.00 | +1,200.00 | 30,100.00 | 30,000.00 | +100.00 | No |
| Employer B / FB-HISTORY | 180,000.00 | -1,200.00 | 14,900.00 | 15,000.00 | -100.00 | No |

Two fictional employers separately imported all 12 historical pay-month rows for **2025 and 2026** through the application's `parseMigrationCsv` parser and inserted the parsed rows into the app's `historical_payroll_entries` schema. The year-end database route computes 2026 basic of PHP 242,000.00 and 182,000.00 respectively, **excluding both 2025 retrospective adjustments**. Both 2026 13th entitlement differences are PHP 166.67, assuming the fictional amounts already paid in the fixtures. The Employer B scenario also excludes separate `HOLIDAY_UNWORKED` pay by default; documented employer-specific legal exceptions remain unapproved.

## Execution and safety

- Network-isolated Vercel sandbox `uat988-isolated-pg-repair-20261014` using a **separately created loopback PostgreSQL 16 database populated with schema only**, not copied employer rows. Dedicated database role and fictitious data.
- **Red test:** valid settled retro failed before code change with `FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED`.
- **Green tests:** `tests/m5-yearend-retro-pg.test.ts` (valid prior/same-year and Draft-source fail closed; previously persisted adjustment preserved), `tests/m5-imported-history-review-pg.test.ts` (two employers, 48 CSV-parsed history rows, 2025 centavo gaps, 2026 year-end, separation-review SQL identity constraints), prior M-5 provenance DB test and ordinary 24-cutoff annualization/financial-approval regressions.
- Before opening PR: `node_modules/.bin/tsc --noEmit --pretty false` returned zero diagnostics; all **10** selected database/regression tests passed with zero failures in the sandbox.
- Review simulation enforces maker/checker user-ID separation with the PostgreSQL constraint; a historic source change invalidates the frozen fingerprint; approval is reset and no release event is created. **This is direct fictional database acceptance, not a fully authenticated HTTP approval or an independent human signature.**
- Existing M-5 financial and statutory default behavior remains a no-money, no-automatic-clawback process. Prior historical payments here are synthetic fixture fields, not incumbent employer exports.

## Not signed or approved

M-5 #1043 remains **OPEN** after an engineering merge until: a complete authorized employer's historic source ledger and actual already-paid 13th evidence are independently reconciled; the approved employer/CBA/established-practice holiday inclusion policy and effective dates are documented; independent qualified Philippine payroll reviewer and employer owner sign the centavo differences and exact merged SHA; authenticated maker/checker approval and private immutable export are witnessed; and the no-money parallel payroll pilot #579 is independently passed. Do not equate tests or signed-gap calculations with permission to pay or collect an adjustment. M-10 #1044 remains independently blocked on agency-specific SSS/HDMF rules.
