# PayrollPH — local product-owner UAT capture (no customer data)

This companion lets the actual Owner record **self-executed** manual outcomes from the existing canonical [WFM-01..14](../wfm-pilot-acceptance-matrix.md) and nine-stage [employer journey](../connected-employer-pilot-execution.md). It **does not** run browser tests, invent a reviewer, verify evidence automatically, sign a compliance release or touch the database.

## Safety before beginning

- Use a **disposable real PostgreSQL 16, UTF-8** local database containing two fictional employers, distinct HR/WFM/Employee/Payroll Officer/Checker/Owner test logins and no real salaries or identifiers. Verify your `DATABASE_URL` is loopback-only before starting the app; this evidence tool itself never reads the environment's DB URL.
- Keep **PayMongo / Xendit disbursement, real notifications, official agency submissions and production integrations OFF**. Release payroll *records* only in the fictional environment.
- Freeze exact `git rev-parse HEAD`, migration 0109 state, active feature flags, fixture version, browser/device version and Manila date. Start with an **entirely clean committed checkout** (`git status --porcelain` must be empty). A changed checkout SHA or uncommitted code modification invalidates continued recording. Archive prior evidence, then initialize a **new clean session**. Never edit the session's source SHA to make mismatched evidence appear current.
- Store screenshots, HTTP logs, failed-case reproduction and original test details in a **separate private local location**, not GitHub. The recorder accepts **only opaque evidence IDs**, not personal data or file paths.

## Local use

In your existing Windows/macOS/Linux local project checkout, with Node 22:

```sh
node --test tests/manual-owner-uat.test.mjs
node scripts/qa/manual-owner-uat.mjs init
node scripts/qa/manual-owner-uat.mjs list
```

Use the actual app in your browser at your verified loopback URL. For each canonical WFM scenario and connected journey stage, record what you **actually** saw:

```sh
# Scenario PASS requires an evidence ID for a real observation.
node scripts/qa/manual-owner-uat.mjs record WFM-01 PASS UAT-TEST001

# Failing case requires both opaque evidence and a separate defect reference.
node scripts/qa/manual-owner-uat.mjs record WFM-04 NEEDS_FIX UAT-TEST004 BUG-12

# Report an inability to run, not a false success.
node scripts/qa/manual-owner-uat.mjs record WFM-14 BLOCKED DEVICE

# A real physical device can be noted as OWNER SELF-WITNESSED only, never certified.
# Do this ONLY after actually testing the designated supported equipment:
# node scripts/qa/manual-owner-uat.mjs record WFM-14 PASS UAT-PHYSICAL01 REAL_DEVICE

# Employer journey evidence uses JOURNEY-01..JOURNEY-09.
node scripts/qa/manual-owner-uat.mjs record JOURNEY-01 PASS UAT-HIRE001
node scripts/qa/manual-owner-uat.mjs report
```

To move to a new commit, preserve the previous session before reinitializing (even when the checkout has already changed):

```sh
node scripts/qa/manual-owner-uat.mjs archive
# Verify the new checkout has no uncommitted changes.
git status --porcelain
node scripts/qa/manual-owner-uat.mjs init
```

Archival never copies previous PASS results into the new session. Each new session starts with all 23 scenarios `NOT_RUN`. Do not manually delete an old session to get past the checkout guard.

Saved ignored-by-Git, local-only files:
- `qa-artifacts/local-owner-uat/session.json` — source-SHA-bound individual self-reported outcomes; safeguard this private file.
- `qa-artifacts/local-owner-uat/summary.md` — redacted count/status table with opaque evidence/defect IDs and explicit uncompleted external gates.
- `qa-artifacts/local-owner-uat/archived/<source-SHA>-<archive-UUID>/` — preserved prior session and summary, not automatically accepted or published.

The script refuses blank PASS evidence, unknown scenario/status IDs, uncategorized blocks, failed cases without a defect ID, and WFM-14 PASS without an explicit real physical-device witness marker. It does **not** independently validate any user-submitted observation. A self-reported PASS is never an independent reviewer signature.

## What to inspect in the actual local UI

**WFM-01..14:** follow the canonical scenario table rather than substituting source-level synthetic unit tests. Specifically verify tenant switching while requests are in-flight, cross-tenant denial, 50–200 worker roster and 3 worksites, overlapping claims, leave/qualification filters, overnight/partial-leave punch handling, PH premiums, corrected/stale timesheets, maker/checker, provider flags/retry, mobile accessibility and 200+ paging. Real offline biometric hardware is separately gated.

**JOURNEY-01..09:** work through one fictional worker with HR → Manager → Employee → Payroll Officer → Checker → Owner. Confirm role separation, approved schedule, *actual* local clock capture and separately identify historical seeded payroll punches, pre-/post-cutoff correction staleness, reviewed wage/benefit trace, employee payslip, immutable record release (not payments), and four draft agency worksheets/hash-bound downloads (not filings). Test employer A↔B on mobile.

Capture a screenshot or log privately for each actual observation. Use an **opaque UAT ID** in the CLI and store its filename/mapping only in the approved private folder.

## What this cannot close

- #691's *independent* human WFM and privacy/security/payroll reviews (the Owner's own observations remain owner self-UAT);
- #853's separate independently witnessed HR/payroll users on actual phones;
- #579's actual consenting employer one-period matching payroll and zero unexplained differences greater than PHP 0.01, signed by an independent checker;
- WFM-14 real-device certification, agency acknowledgements and bank/provider onboarding; or
- #112/#744/#908 production security, DB privilege, staging, money and launch controls.

Keep these explicitly NOT_RUN / NO-GO unless separately executed and supported by genuine evidence. Never upload real payroll files to GitHub or this recorder.
