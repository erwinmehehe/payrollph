# Local disposable scenario: provider-switch year, calculated-cutoff withholding

Verifies PR #2013 on this computer's disposable PostgreSQL 16 only. The expected values are the hand-derived
Phase 15 catalog values (`certification/golden-payroll-phase15.json`); observations
must reproduce them to the centavo. The engine harness
(`scripts/golden-payroll-phase15.ts`) is the ground truth for how each fixture
row is built.

## Safety rules

- Local disposable PostgreSQL 16 only, with fictional employees. Never use production,
  a Vercel preview (which shares the production database), any remote/shared database,
  or real employee data. Never redirect or tunnel the local port to another server.
- Payment rails off: `PAYMONGO_DISBURSEMENTS_ENABLED=false`,
  `XENDIT_PAYOUTS_ENABLED=false`, `XENDIT_BILLING_ENABLED=false`,
  `WORKER_ENABLED=false`, `CENTRAL_SCHEDULER_ENABLED=false`. No payout, no
  disbursement, no emails.
- `EXACT_THIRTEENTH_CENTAVOS_ENABLED` stays off. This scenario does not test it.
- The checkout must contain #2013 (a1d969e90 or later). Record the exact checkout SHA.
  Do not represent a CLI engine receipt as a Next.js build or browser witness.

## Local execution, one step at a time

The operator runs these steps and shares sanitized results before continuing.
This document is a recipe, not evidence of execution. Local execution remains
NOT_RUN until an actual receipt is attached. No password, API key, environment
dump or real employee data should be pasted.

1. Stop only an older disposable database you recognize. From the main checkout,
   start `node .qa-local/pg16-server.mjs .qa-local/pg16-phase15` with a fresh data
   directory. Confirm PostgreSQL 16 listens on 127.0.0.1:5432. If the port is occupied
   or the directory already contains data, stop and investigate; do not reset it.
2. In a separate PowerShell terminal in the #2013 checkout, confirm `git rev-parse HEAD`
   and that the relevant source is committed. Install dependencies with `npm ci`
   if needed. Set this session's environment:

   ```powershell
   $env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/app_db'
   $env:GOLDEN_PHASE15_DISPOSABLE = 'local-disposable-pg16-only'
   $env:GOLDEN_PHASE15_LOCAL_CONFIRM = 'fresh-empty-fictional-database'
   $env:TZ = 'Asia/Manila'
   Remove-Item Env:CI, Env:GITHUB_ACTIONS -ErrorAction SilentlyContinue
   $off = @('PAYMONGO_DISBURSEMENTS_ENABLED', 'XENDIT_PAYOUTS_ENABLED',
     'XENDIT_BILLING_ENABLED', 'WORKER_ENABLED', 'CENTRAL_SCHEDULER_ENABLED',
     'EXACT_THIRTEENTH_CENTAVOS_ENABLED', 'FINAL_PAY_SIGNED_REVIEW_ENABLED',
     'FINAL_PAY_MANUAL_RELEASE_ENABLED', 'PAYROLL_CALCULATION_HISTORY_ENABLED', 'NEXT_CSP_ENABLED')
   foreach ($name in $off) { Set-Item -Path "Env:$name" -Value 'false' }
   foreach ($name in @('PII_ENCRYPTION_KEY', 'BANK_DATA_ENCRYPTION_KEY', 'TOTP_ENCRYPTION_KEY')) {
     $ephemeral = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
     Set-Item -Path "Env:$name" -Value $ephemeral
   }
   Remove-Variable ephemeral
   ```

   Provider/email keys and deployment variables must be absent. The preflight
   names any forbidden variable without displaying its value. Do not load a
   deployed environment file. Keep ephemeral encryption keys local if the app
   requires them; never print or share them.
3. Prepare the empty local schema with
   `node --import tsx scripts/qa/golden-phase15-local-bootstrap.ts`.
   It checks target, PG16 identity, loopback server/client and zero employers
   before schema writes, then applies two hash-pinned source baseline files.
   It does not reset/drop a database. Do not use the CI-only
   `apply-isolated-baseline.mjs`, or set CI variables to bypass its guard.
4. Run `node --import tsx scripts/golden-payroll-phase15.ts` and preserve
   `qa-artifacts/golden-payroll-phase15-reconciliation.json`. This invokes the real engine
   directly; `npm run dev` is unnecessary. Browser/import-screen verification is
   separate and NOT_RUN; do not infer menu paths or UI success from this receipt.

The harness checks every cutoff before setting its synthetic run to Released
for annualization. This fixture marker is not a human approval or payout.
On failure it stops further cutoffs, retains the fictional database, and records
available run/entry IDs and observations. Stop, capture those payslips and IDs,
and do not merge. Unexecuted cutoffs and year-end results are NOT_RUN.

## Setup

Tax year 2026, 24 semi-monthly cutoffs, `split` statutory timing, Asia/Manila.
Four fictional employees, each with basic salary 30,000 a month (15,000 a
cutoff). The provider switch is 2026-07-01.

**Imported history (January to June, six monthly rows per employee):**

| Employee | Imported rows |
|---|---|
| A. poolExhaustedBeforeYearEnd | gross 36,000, basic 30,000, SSS 1,500, PhilHealth 750, Pag-IBIG 200, tax withheld 1,007.40, 13th month 0, de minimis breakdown `{ uniformClothing: 6000 }` |
| B. ceilingExhaustedByBothSources | same as A |
| C. historyWithoutDeMinimis | gross 30,000, same contributions and tax, **no** de minimis breakdown field |
| D. controlNoGrant | gross 30,000, same contributions and tax, no breakdown field, no grant |

(Net pay on the imported rows: 32,542.60 for A and B, 26,542.60 for C and D.)

**Engine de minimis grants (uniform and clothing allowance, effective 2026-07-01):**

| Employee | Grant |
|---|---|
| A | 15,000 a month (7,500 a cutoff) |
| B | 6,000 a month (3,000 a cutoff) |
| C | 6,000 a month (3,000 a cutoff) |
| D | none |

**Runs:** calculate cutoffs 13 to 24 (July to December) in order. Set each
calculated run to Released before the year-end settlement, because year-end
reads Released runs.

## Expected result per cutoff (withholding tax on the payslip)

| Employee | Cutoffs 13-20 | Cutoff 21 | Cutoffs 22-24 |
|---|---|---|---|
| A | 484.95 | **1,434.10** | **1,834.10** |
| B | 484.95 | 484.95 | 484.95 |
| C | 484.95 | 484.95 | 484.95 |
| D | 503.70 | 503.70 | 503.70 |

The headline check is A at cutoffs 21 to 24. Before #2013 the engine returned
484.95 there (4,996.60 under-withheld across the four cutoffs).

## Expected entry status and review flags

| Employee | Status | Review flags |
|---|---|---|
| A | Exception, every cutoff 13-24 | shared PHP 90,000 pool flag from cutoff 13; no "no de minimis category breakdown" flag |
| B | Exception, every cutoff 13-24 | shared pool flag from cutoff 13; no "no breakdown" flag |
| C | Exception, every cutoff 13-24 | "has no de minimis category breakdown" flag from cutoff 13; shared pool flag from cutoff 15 |
| D | Ready | none |

Flag text to look for: "has no de minimis category breakdown" and "does not
identify the shared PHP 90,000". A and B keep the pool hold on purpose: the
import schema cannot capture prior other pool benefits, so the hold remains
until complete year-to-date evidence is reconciled. This is the conservative
behavior, not a defect.

## Expected year-end settlement (after cutoff 24 is Released)

| Employee | Gross compensation | Non-taxable | Taxable income | Tax due | Tax withheld | Adjustment |
|---|---|---|---|---|---|---|
| A | 516,000 | 128,900 | 387,100 | 20,565.00 | 16,860.40 | collect 3,704.60 |
| B | 462,000 | 128,900 | 333,100 | 12,465.00 | 11,863.80 | collect 601.20 |
| C | 426,000 | 96,900 | 329,100 | 11,865.00 | 11,863.80 | collect 1.20 |
| D | 390,000 | 59,400 | 330,600 | 12,090.00 | 12,088.80 | collect 1.20 |

13th-month pay in every case is 30,000. Statutory contributions: 30,900 for A,
B and C; 29,400 for D.

Arithmetic check for A: tax withheld = 6,044.40 imported + 8 x 484.95 + 1,434.10
+ 3 x 1,834.10 = 16,860.40; collect = 20,565.00 - 16,860.40 = 3,704.60.

## Pass criteria

All of the following, to the centavo:

1. A's withholding at cutoffs 13-20, 21 and 22-24 matches the table.
2. B, C and D withhold the same amount at every cutoff.
3. Entry statuses and review flags match the table, including the absence of
   flags on D.
4. Year-end figures match for all four employees.
5. No payout, disbursement or email was created.

## Fail and stop conditions

- A withholds 484.95 at cutoff 21 or later: the fix is not active on the
  tested checkout. Stop and confirm the checkout SHA.
- D is anything but Ready, or any employee shows a different amount to the
  centavo: capture the payslip and run id, and do not merge.
- Any unexpected status flip to Ready on A, B or C: the review hold was
  lost. Stop and do not merge.
- Any payout or email appears: stop, preserve the evidence, and do not merge.

## Evidence to attach to the PR

Attach the receipt with exact checkout SHA and source hashes, four employee IDs,
all actual run/entry IDs (12 shared cutoff runs on a complete run), the 48-cell
observed withholding/status/flags table, every year-end figure and confirmation
that all payment rails were off. Do not invent four run IDs: each cutoff run
contains the four employees. If separately testing the UI, also record its actual
build SHA. Evidence is SOLO_VERIFIED_DEV_RECOVERY, not an independent witness or
production acceptance. CI success does not substitute for the operator's local run.
