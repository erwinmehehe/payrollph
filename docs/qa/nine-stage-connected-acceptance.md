# #853 — Connected nine-stage first-payroll development acceptance

This workflow uses the **same fictional worker and same Manila calendar day** for actual
Web Bundy capture, independently reviewed source correction, WFM timecard, calculated
payroll, record release and four draft filing worksheets. It must never pass because
unrelated stage tests succeeded. It explicitly reports FAIL/NOT_RUN when a stage fails.

Run on the PR via **Nine-Stage Connected Payroll Development Acceptance (No Money)**.
The job is restricted to GitHub-hosted PostgreSQL 16 on 127.0.0.1/app_db and an
empty database. It explicitly refuses provider keys, payout and filing submission
flags, demo mode, remote hostnames and arbitrary production connections. The job
builds the exact checked-out commit and uploads only sanitized JSON. Synthetic login
handoff is removed before artifact upload. The browser job uses 375px/390px
Chromium, not a real mobile device.

The historical September QA in `scripts/pilot-payroll-qa.ts` is useful regression
evidence but its *live* Web Bundy punch occurs outside its historical payroll period.
It must not be represented as one time-connected workflow. This harness uses a fresh
same-day source punch instead. Prior-payroll, overnight, holiday, rest-day, and OT
premiums are covered by other existing synthetic suites, **not** automatically
certified by this new one-worker live-capture journey.

Individual PASS here is only synthetic engineering evidence. Independent employer
operator UAT, 14 WFM human/device scenarios, real employer centavo reconciliation,
actual statutory agency import acceptance and banking provider acceptance
remain separately NOT_RUN. Nothing authorizes production or real payouts.

Failure reports are not a reason to weaken permission gates or application
security. A failure marks overall acceptance FAIL, preserves sanitized stage evidence,
and prevents promoting this draft PR as accepted.
