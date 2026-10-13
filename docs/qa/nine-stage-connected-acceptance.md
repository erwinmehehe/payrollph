# #853 — Connected nine-stage first-payroll development acceptance

This workflow uses the **same fictional worker and same *simulated* Manila calendar day** for actual
Web Bundy capture, independently reviewed source correction, WFM timecard, calculated
payroll, record release and four draft filing worksheets. It must never pass because
unrelated stage tests succeeded. It explicitly reports FAIL/NOT_RUN when a stage fails.

Run on the PR via **Nine-Stage Connected Payroll Development Acceptance (No Money)**.
The job is restricted to GitHub-hosted PostgreSQL 16 on 127.0.0.1/app_db and an
empty database. It explicitly refuses provider keys, payout and filing submission
flags, demo mode, remote hostnames and arbitrary production connections. The job
builds the exact checked-out commit and uploads sanitized JSON and fictional UI screenshots.
Synthetic login handoff is removed before artifact upload. The browser job uses
1440px desktop and 375px/390px Chromium, not a real mobile device.

The mobile header correction is behind `COMPACT_MOBILE_HEADER_ENABLED`, registered
default OFF. Only the enabled server marks its shell for the scoped CSS. A separate
localhost app keeps the flag OFF; authenticated browser checks and screenshots prove
the marker is absent and the legacy flex layout remains. Actual workspace React
rendering also proves absent/false flag markup is identical. The disabled comparison
preserves the legacy layout, including its known narrow-screen overflow; it does not
silently activate the fix or hide overflowing content.

The historical September QA in `scripts/pilot-payroll-qa.ts` is useful regression
evidence but its live Web Bundy punch falls outside its seeded September payroll period.
This harness instead uses real authenticated Web Bundy IN/OUT HTTP operations under a
**guarded virtual Manila clock of September 30, 2026 at 16:00**, so the punch, timesheet,
final monthly cutoff, released ledger, and draft BIR/SSS/PhilHealth/Pag-IBIG worksheets
share the same *simulated* payroll work date. The API-created punch is not seeded.
It is **not actual October 13 wall-clock attendance or a real device event**.
The guarded virtual date runs in the localhost Next.js process and connected test
process. GitHub CI exports one fresh real-time anchor (milliseconds), which both
Node and the synthetic Chromium page convert to the same fictional September 30
instant. This avoids creating independent virtual clocks at each process start.
The browser context explicitly uses the Asia/Manila timezone and an isolated Date
shim; full React hydration/page-error assertions remain active. An absent, invalid
or more-than-30-minute-old anchor fails closed. This is not actual wall-clock
attendance or a physical phone.
Postgres itself, other CI checks and production continue using their real clocks.
The preload refuses anything except GitHub CI with a local empty PG16 database, payout
flags OFF and provider keys absent. Its time advances monotonically to retain ordering.

Final-month statutory drafts are intentionally NOT generated for a mid-month cutoff,
and the existing filing guard is not modified. Prior-payroll, overnight, holiday,
rest-day, and OT premium tests run separately and do not certify that those scenarios
occurred in this particular source-connected one-worker journey.

Individual PASS here is only synthetic engineering evidence. Independent employer
operator UAT, 14 WFM human/device scenarios, real employer centavo reconciliation,
actual statutory agency import acceptance and banking provider acceptance
remain separately NOT_RUN. Nothing authorizes production or real payouts.

Failure reports are not a reason to weaken permission gates or application
security. A failure marks overall acceptance FAIL, preserves sanitized stage evidence,
and prevents promoting this draft PR as accepted.

The acceptance fixture creates a **same-date newly hired worker** (2026-09-30) and
asserts that the HRIS start date matches the simulated work day. An existing
employee on a final monthly cutoff would need a released earlier-cutoff ledger
for statutory true-up; the test must not invent that prior ledger or disable
the statutory exception.

The evidence test also runs in the ordinary sharded regression inventory. In
ordinary CI, where there is intentionally no connected-journey report, it
checks negative acceptance cases and skips artifact conformance without
claiming any pass. Only the dedicated workflow sets
`NINE_STAGE_EVIDENCE_REQUIRED=true`; there, missing, failed, wrong-commit,
or incomplete connected evidence **must fail**.

## Development-run finding (2026-10-13)

The first exact-head connected synthetic run passed Hire through Release Payroll Records (8/9) and generated all four draft files, but the ninth stage failed on an **incorrect expected HTTP status** in the test harness. The post-release correction is already covered by an active payroll-cutoff lock, so `decide_request` returns HTTP **423** with `ATTENDANCE_PERIOD_LOCKED` before the separate immutable-payroll-run 409 guard. The initial harness incorrectly expected 409. It has been corrected to assert **HTTP 423 and `ATTENDANCE_PERIOD_LOCKED`** at the active cutoff; the separate immutable-payroll guard remains unchanged. The first run remains **FAIL** and cannot be promoted; the updated exact-head workflow must pass the connected journey and mobile checks before this source is integrated. No human/customer acceptance is claimed by these initial results.
