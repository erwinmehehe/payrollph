# Fictional first-payroll reconciliation

This regression joins the newly onboarded employee to an actual calculated,
approved, released payroll and its exported artifacts. It complements the larger
`scripts/pilot-payroll-qa.ts` scenario: this smaller case keeps privileged MFA
enabled, explicitly retries the same draft intent, checks exact file bytes, and
refuses duplicate final-file issuance. No API coverage credits are generated.

## Defect reproduced

The production-pilot signoff card rendered `13271.30` as `₱13,271`. That card asks
the operator to reconcile exact monetary totals, so dropping the centavos hides a
real difference from the register and file. Use the existing `moneyExact`
formatter. The new render regression fails with the old formatter and passes for
`13271.30`, `0.01` and `10000.00` after the fix. No financial calculation changes.

## Executed flow

Local production-mode Next server on 127.0.0.1:3016, new task-owned PostgreSQL
16.14 cluster on port 5436, fictional employer and independently authenticated
owner, payroll officer, HR reviewer and checker fixture sessions:

1. Create a worker through the real employee POST; store encrypted initial payout
   details through PATCH. Historical complete punches are fictional seeded inputs.
2. Configure this fictional employer's timesheet policy to block. Attempt payroll
   without approved time: 422, no payroll row created. Submit the timesheet; refuse
   self-approval; approve it through a distinct HR session.
3. Calculate via payroll POST, replay the same idempotency key, require exactly one
   worker entry and one run. Reconcile register gross, deductions and net in exact
   integer centavos. Fictional monthly salary 30000 gives cutoff gross 15000.00;
   current software produces deductions 1728.70 and net 13271.30.
4. Payroll officer submits; self-approval is refused; distinct checker approves;
   checker release is refused; owner releases through the real HTTP route.
5. Require one linked payslip, exact gross/deduction/net text and a downloaded PDF.
   Generate dry-run and final files with an explicitly fictional three-column CSV
   mapping; require exact employee/account/amount bytes and matching total. A second
   final file returns `FINAL_BANK_FILE_ALREADY_ISSUED` (409).
6. Refuse recalculation of the released run. Replay the original creation intent
   after release; require the same run and unchanged calculated entry IDs/values.
7. Real Chromium at 1280 and 390 pixels loads the actual owner dashboard and
   navigates to payroll details. Require the exact-cent pilot total, no page
   exceptions, and capture screenshots.

## Acceptance and limits

`scripts/qa/first-payroll-full-http.mjs` emits a sanitized result and screenshots
under `outputs/`. The dedicated `first-payroll-full-http.yml` repeats the guarded
scenario on disposable PG16 in CI. Unit tests independently reject one-cent drift,
duplicates, wrong-run entries, malformed amounts and nonlocal/provider settings.

This is **HTTP-driven lifecycle testing with browser verification afterward**,
not a completed click-through data-entry/sign-in test. Fixture sessions include
fictional MFA timestamps; no real password, MFA credential or human identity is
used. Browser requests use those fixture sessions. No real employer reconciliation,
statutory/rate certification, external bank specification/UAT, agency filing,
provider operation or settlement was performed. The fictional adapter remains
`draft` / `unknown`; it is never represented as a verified real bank adapter.
Existing production guards and live flags are unchanged. Independent operator
pilot signoff is not fabricated or submitted.

Local checks and final tested revision are recorded in the draft PR. Exact-head
CI remains required; a local PASS is not deployment or real-money authorization.
