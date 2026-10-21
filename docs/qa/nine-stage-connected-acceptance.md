# #853 — Connected nine-stage first-payroll development acceptance

## First-payroll verification scope — October 20, 2026

For the owner first-payroll check, rerun this existing workflow on the reviewed
source commit rather than using the production owner's practice workspace.
Require all four matrix cases: PG16 direct, PG16 governed, PG18 governed and
PG16 governed year-end. Each case must preserve maker/checker segregation,
two-employer isolation and the no-money/provider-key guards below.

Accept only same-commit artifacts showing both employers complete attendance
capture/correction, separate time approval, calculation, separate payroll review,
record release, and reconciled payslip/PDF/journal outputs. Retain denied
self-approval, denied checker release, duplicate-release and post-release source
rewrite evidence. The direct case also verifies ten fictional workers over two
cutoffs. A green component preview alone is insufficient.

Keep the evidence boundaries explicit: payroll lifecycle mutations execute
through authenticated real HTTP against disposable PostgreSQL; the desktop and
375px/390px browser checks exercise actual application rendering, role and
employer switching, failed-read recovery, saved-run resume and employee access.
Those browser checks do not claim that every lifecycle mutation was clicked in
the UI. Record any uncovered UI action as remaining work, not a browser pass.

The production owner's MFA enrollment, bank details and checker invitations are
outside this synthetic run. No production settings, credentials, business rows,
payments or backups are changed by running this verification.

This workflow tests **two separate fictional employers** in one disposable PostgreSQL database. Each has its **own fictional worker and the same *simulated* Manila calendar day** for actual
Web Bundy capture, independently reviewed source correction, WFM timecard, calculated
payroll, record release and four draft filing worksheets. It must never pass because
unrelated stage tests succeeded. It explicitly reports FAIL/NOT_RUN when a stage fails.

Run on the PR via **Nine-Stage Connected Payroll Development Acceptance (No Money)**.
The workflow runs PostgreSQL 16 direct/governed Hire plus PostgreSQL 18 governed Hire
on **separate** GitHub-hosted disposable 127.0.0.1/app_db databases. The PG18 case
first proves an empty catalog, creates the current Drizzle schema, fingerprints
its tables/columns/indexes/constraints, and fails closed on first-push
SQL errors, even if Drizzle exits successfully. Repeat pushes are separately
BLOCKED by an unresolved Drizzle constraint-diff issue; this does not prove
idempotent migrations. See [PG18 fresh development rebuild](../engineering/fresh-pg18-dev-rebuild-20261014.md). It explicitly refuses provider keys, payout and filing submission
flags, demo mode, remote hostnames and arbitrary production connections. The job
builds the exact checked-out commit and uploads sanitized JSON and fictional UI screenshots.
PG18 additionally uploads a catalog-only schema fingerprint; artifact names identify PG major.
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
**guarded virtual Manila clock at 16:00 on the current Manila calendar month-end**, so the punch, timesheet,
final monthly cutoff, released ledger, and draft BIR/SSS/PhilHealth/Pag-IBIG worksheets
share the same *simulated* payroll work date. The API-created punch is not seeded.
It is **not real wall-clock attendance or a physical device event**.
The guarded virtual date runs in the localhost Next.js process and connected test
process. GitHub CI exports one fresh real-time anchor (milliseconds), which both
Node and the synthetic Chromium page convert to the same selected month-end
instant. This avoids creating independent virtual clocks at each process start.
The browser context explicitly uses the Asia/Manila timezone and an isolated Date
shim; full React hydration/page-error assertions remain active. An absent, invalid
or more-than-30-minute-old anchor fails closed. This is not actual wall-clock
attendance or a physical phone.
Postgres itself, other CI checks and production continue using their real clocks.
The preload refuses anything except GitHub CI with local disposable PG16 or PG18,
payout flags OFF and provider keys absent. The PG18 catalog check explicitly
verifies the original empty state before initialization. Its time advances monotonically to retain ordering.

Final-month statutory drafts are intentionally NOT generated for a mid-month cutoff,
and the existing filing guard is not modified. Prior-payroll, overnight, holiday,
rest-day, and OT premium tests run separately and do not certify that those scenarios
occurred in this particular source-connected one-worker journey.

Both A and B must complete Hire, Onboard, Schedule, Clock In, Approve Time, Run Payroll, Review, Release Records and Prepare Draft Filing Evidence using their own scoped source records. Employer B is no longer permitted to be only a shadow tenant. The connected report retains A and B stage arrays, distinct source-punch/run IDs and four hashes per employer; its fail-closed validator rejects any missing B stage.

Individual PASS here is only synthetic engineering evidence. Independent employer
operator UAT, 14 WFM human/device scenarios, real employer centavo reconciliation,
actual statutory agency import acceptance and banking provider acceptance
remain separately NOT_RUN. Nothing authorizes production or real payouts.

Failure reports are not a reason to weaken permission gates or application
security. A failure marks overall acceptance FAIL, preserves sanitized stage evidence,
and prevents promoting this draft PR as accepted.

The acceptance fixture creates a **same-date newly hired worker** on the selected
Manila month-end and
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


### Why the cutoff is selected at runtime

The simulated server date previously remained fixed at September 30, 2026.
After fourteen real days, Chromium's genuine cookie store considered the
server-issued fourteen-day login cookie already expired, redirecting the
otherwise authenticated synthetic UI test to `/login`. The server and browser
were using different underlying cookie clocks. No application login, MFA,
session-expiration or permission policy is changed to address this.

The workflow now chooses the **current Manila month's actual final calendar
day** once, before any application startup, using
`scripts/qa/synthetic-month-end.cjs`. It exports that exact value to the
isolated server, integration script, browser and evidence validator; the clock
preload verifies that it is a genuine Manila month-end and that the connection
is disposable localhost PostgreSQL. The browser and server simulate 16:00 on
that date. The short-lived synthetic login therefore retains normal real
browser cookie behavior, while the same source-created punch, timesheet,
payroll run and final-period draft-filing checks remain tied to the **same**
selected cutoff. Source acceptance at one virtual cutoff does not certify
other actual payroll periods or real devices.

## Development-run finding (2026-10-13)

The first exact-head connected synthetic run passed Hire through Release Payroll Records (8/9) and generated all four draft files, but the ninth stage failed on an **incorrect expected HTTP status** in the test harness. The post-release correction is already covered by an active payroll-cutoff lock, so `decide_request` returns HTTP **423** with `ATTENDANCE_PERIOD_LOCKED` before the separate immutable-payroll-run 409 guard. The initial harness incorrectly expected 409. It has been corrected to assert **HTTP 423 and `ATTENDANCE_PERIOD_LOCKED`** at the active cutoff; the separate immutable-payroll guard remains unchanged. The first run remains **FAIL** and cannot be promoted; the updated exact-head workflow must pass the connected journey and mobile checks before this source is integrated. No human/customer acceptance is claimed by these initial results.


## P0 governed Hire bridge — separate additional synthetic proof

The source-connected **nine-stage payroll worker still originates from the direct
authorized HRIS employee-create API**. That original same-worker payroll lineage
is intentionally unchanged. The new post-browser **governed Hire sidecar** tests
a *different fictional future-start worker* in the same isolated employer A.
It must **never** be reported as if the reviewed candidate was also the released
original nine-stage payroll worker.

The additive test is \`scripts/qa/governed-hire-853-bridge.ts\` and runs **after**
all nine payroll stages and A → B → A mobile browser tenant checks so that the
mobile harness's original single-worker assumptions remain true. It runs in
the same disposable localhost database, then confirms the original released
payroll entries remain byte-for-byte unchanged.

The test seeds only an approved fictional job profile/position, the employer
Hire BP definition and a separate HR initiator. It then drives **real protected
application APIs** for opening the requisition, applicant stage progression,
recording a monthly offer, requesting Hire BP, independent HR and owner
approval, and final candidate-to-worker conversion. It asserts:

- Direct employee creation is blocked once an employer Hire process exists.
- The initiator cannot approve their own request; tenant B cannot even view
  tenant A's approval; HR cannot impersonate Owner approval.
- The repeated request reuses one frozen process; no employee exists before
  both approvals and final authorized conversion.
- One resulting worker, pay profile, position assignment, candidate linkage,
  employee history event and employee-specific onboarding tasks all agree.
- Duplicate conversion is rejected, and the prior fictional released payroll
  register remains unchanged.

**Coverage boundary:** the position and BP policy are seeded as isolated
fictional fixture preconditions, not proved through a published workforce plan
or a real setup UI. This sidecar proves the application Hire business-process
API bridge, **not** candidate-to-payroll lineage, novice HR navigation, physical
device testing, customer onboarding acceptance or a real employer pilot.
Report: \`qa-artifacts/governed-hire-853-report.json\`.
Validator: \`tests/governed-hire-853-evidence.test.mjs\`.
The validator fails closed on missing/wrong-source/nonpassing sidecar results
when \`NINE_STAGE_GOVERNED_HIRE_REQUIRED=true\` in dedicated CI.

### Session clock alignment and governed-sidecar credentials

The disposable PG16 job now aligns only the `sessions.created_at` default
before any organization, user or session exists. PostgreSQL uses real wall
time plus the same bounded virtual-month-end offset as Node and Chromium.
The setup rejects remote/query-overridden URLs, wrong database/version,
stale anchors, provider credentials and populated fixtures. Existing sessions
are never rewritten, and production schema/authentication/expiry/MFA code is
unchanged. An isolated-schema behavior test calls actual `createSession`,
reproduces the original age mismatch, proves the aligned creation timestamps,
and verifies existing sessions and policy limits remain unchanged.

The governed-Hire sidecar creates independent fictional initiator/reviewer/
owner/foreign-owner actors with a freshly generated in-memory password. It
queries the exact two fictional employer names from the disposable store and
never reads the browser credential handoff file. HTTP redirects are refused.
No production record or credential is read, and the actor split still tests
maker-checker/tenant/role denial through actual authenticated APIs.

## 2026-10-17 — Owner-confirmed fictional development database recovery re-acceptance

The owner confirmed **zero customers and fictional payroll data only**, so #907 production-class external recovery is a **pre-launch** milestone, not an obstacle to development. The connected dev Neon branch had 136 public tables; isolated rollback-rehearsed additive SQL now restores seven attendance/compensation tables, the source-defined worksite decision column, and the first-payroll progress table. The development branch is at **149 public tables**, with **125 of 271 source-declared table names still absent**; this is NOT full connected Neon schema parity. All original synthetic business row counts (8 employees, 3 runs, 18 entries, 6 memberships) remained unchanged; no payout and no government filing.

This QA document is an explicit input to the existing **Nine-Stage Connected Payroll Development Acceptance (No Money)** GitHub workflow. Changes to this file trigger the real, disposable PostgreSQL **16 direct hire, 16 governed hire, 18 governed hire and year-end governed** matrix with fictional employers. The PG18 case must bootstrap the **complete current Drizzle schema from a verified empty disposable localhost database**, then exercise authenticated role-separated hire, onboarding, schedule/punch/time approval, payroll review, records release and draft filing evidence. All financial-provider flags remain disabled. Every failing check must block the PR; a queued or partially running job is **not** acceptance.

The fact that this green synthetic full-schema journey can rebuild **all** current source models does **not** mean the older connected Neon development branch has the same tables or that owner/HR/Payroll UI route defects are fixed. Separate authenticated dev checks remain required for attendance ownership, Live Floor, compensation unit scope, first-payroll resume, and independent mobile/UAT cases. See [actual guarded dev-catalog evidence](../engineering/fictional-dev-schema-restoration-20261017.md). Do not convert synthetic CI into a customer release guarantee or require paid backups for test-only data.

### 2026-10-17 superseding reader-path development checkpoint

Additional read-only source-to-catalog inspection found two unconditionally referenced missing WFM attendance lock tables and 17 absent columns in the two first-payroll reader modules. Exact archived additive DDL for WFM schedule guardrails and attendance cutoff policies plus selected reviewed loan, benefit, expense, de-minimis and year-end columns was rehearsed on an unchanged isolated Neon clone with deliberate rollback, then applied to the **owner-confirmed fictional connected dev database** only. The benefit HMO backfill `UPDATE` was excluded (affected tables had zero rows); no customer data, payroll money or filings were moved.

Final direct read-shape evidence: **35/35 first-payroll table names, 505/505 source column names present**, with 149 actual public tables and 125 remaining source-declared relation names absent. **8 fictional employees / 3 payroll runs / 18 payroll entries / 6 organization memberships preserved.** This is catalog compatibility only; manual signed-in HTTP, feature-flag gating, full release parity and separate customer launch safeguards are not certified by it. The exact source identifiers, clone rollback and schema metadata are in [the evidence addendum](../engineering/fictional-dev-schema-restoration-20261017.md).
