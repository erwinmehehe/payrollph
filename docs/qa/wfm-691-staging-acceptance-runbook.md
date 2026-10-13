# WFM #691 — executable staging acceptance packet

**Prepared:** 2026-10-13. **Status:** engineering evidence assembled; *independent staging UAT NOT RUN / NO-GO*. This packet complements, not replaces, [the canonical WFM-01..14 matrix](../wfm-pilot-acceptance-matrix.md), [the owner-local UAT recorder](local-owner-wfm-journey-uat.md) and [issue #691](https://github.com/erwinmehehe/payrollph/issues/691).

## Goal and exact release boundary

Prove with fictional PH employers that **create seven-day roster → preview rules → publish with authorization → open gap / shift swap → employee schedule → clock / offline queue → independent attendance review → corrected timecard → checker-approved payroll preview** works on the *same authoritative worker and time records*. Source merge, synthetic PostgreSQL results and a Vercel preview are **not independent usability, device, DPO, DBA or payroll sign-off**.

The benchmark is Rippling for unified time/payroll *architecture*, Deputy for roster/swap UX and UKG for progressively deeper demand forecasting. [Current gap audit](../wfm-rippling-deputy-ukg-gap-audit.md) records the reviewed components and later enhancements. **Do not expand feature scope to close #691.**

## Stage 0 — environment, personnel and safety (must be witnessed)

- Freeze **exact commit SHA**, deployed build, tenant scope, feature flags, browser/device versions, payroll cutoff, Manila time and migration/rollback manifests. A new deployment invalidates an earlier evidence set.
- Use a **protected, nonproduction application** and a **disposable PostgreSQL 16/18** database with no real employee, location, payroll, bank or identity records. Two fictional employers; three fictional worksites; distinct employee, site-scoped manager, HR, Payroll Officer, Checker, Owner and tenant-B negative-test users. Never connect disposable `db:push` or seeded payroll automation to Neon production.
- The existing Neon WFM rehearsal branch has extra WFM tables but derives from a real project branch; **do not assume it is sanitized** or use it for app UAT without DBA verification and an authorized isolated synthetic clone. Live Neon main still lacks optional WFM policy/photo tables; do not apply migrations there.
- Explicitly disable payments, real providers/notifications, external wage filings and production identity integrations. Run an authorized staging-only scheduler under a fenced lease with synthetic data; verify liveness, idempotency and stop/restart recovery. Do not activate photo capture without AppSec/DPO review.
- Record actual reviewers (not fictional names), independent roles, test start/end time and privileged access proof in the **private evidence vault**. Only synthetic opaque IDs and sanitized PASS/FAIL summaries go to GitHub.

## Automated foundation — reproducible but NOT human UAT

Use the existing [WFM Synthetic Evidence workflow](../../.github/workflows/wfm-pilot-synthetic-evidence.yml) against **the exact candidate SHA**; retain its `wfm-14-scenario-synthetic-evidence` artifact. For a local disposable loopback PostgreSQL with isolated CI secrets and the **validated** repository `db:push` guard, focused tests are:

```bash
# Start a dedicated disposable PostgreSQL 16/18 app_db on localhost first.
# Do not reuse any environment that contains employer/payroll data.
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/app_db'
export CI='true'
export GITHUB_ACTIONS='true'
export BANK_DATA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export PII_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm ci
npm run db:push  # repository guard must confirm 127.0.0.1/app_db
npx tsx --test --test-concurrency=1 tests/wfm-roster-scale-postgres.test.ts tests/workforce-roster-scale-rules.test.ts
node --test tests/wfm-pilot-synthetic-evidence.test.mjs
```

Do not execute those commands against any non-disposable `DATABASE_URL`. The existing 1,000-row DB test verifies 1,000 tenant-A assignments, six keyset pages (five pages of 200 plus empty terminal), ten 100-worker schedule batches, and a tenant-B exclusion sentinel. The roster-rule test verifies a 13-hour day followed by five hours' rest produces exactly two **blocking** findings: `MAX_DAILY_HOURS` and `MIN_REST_BETWEEN_SHIFTS`. [PR #936](https://github.com/erwinmehehe/payrollph/pull/936) extends the WFM-12 synthetic *matrix mapping* to run those tests. **A green automation receipt is not a WFM-12 staging PASS**.

## Stage 1 — WFM-12 1,000-assignment staging script

1. Authorized operator confirms isolated DB, active 1,000 fictional assignments at site/tenant A, a tenant-B negative sentinel, a 14-day-or-shorter date window, proper payroll roles and the **staging-only** roster-scale gate.
2. SRE records scheduler run ID, lease holder, start/finish timestamp, deadline, query count and p50/p95 latency. Run *one observed leased tick*; confirm the entire 1,000-row population is scanned before **any** advisory notification event can be emitted. Capture page cursors and counts without person identifiers.
3. Assert **exactly 1,000 unique A assignments**, no B data or cross-tenant notification, no duplicate worker after effective-history overlap and no "complete" claim if page 3 fails or the limit is reached. Validate lock loss mid-run, restart/retry event deduplication and 20,000 ceiling fail-closed behavior.
4. Manager uses **actual staging UI** (not component-fixture alone) to page and change dates, test late requests and role restrictions, then opens the 13-hour/5-hour shift fixture. Assert exactly the two named blockers, separated from holiday/rest-day **warnings**. No unauthorized override, no published schedule from a suggested draft, no payroll deduction.
5. Independent WFM manager, SRE and security reviewers compare expected versus actual, attach redacted trace links and decide WFM-12 `PASS`, `NEEDS_FIX`, or `NOT_RUN`. Performance targets must be explicitly approved **before** declaring pass; record measured numbers, not invented thresholds.

## Stage 2 — WFM-01..14 end-to-end acceptance

Follow the [canonical scenario table](../wfm-pilot-acceptance-matrix.md) exactly. Required P0 WFM-01..10: tenant swap / server denial; 7-day roster and site scope; concurrent overlapping publish; leave/credential constraints; punches and partial/overnight time; Philippine night/rest/holiday/OT previews; corrections versus cutoff and immutable payroll; maker/checker; default-OFF provider/notification failure. Required P1 WFM-11..14: unreliable network / mobile; WFM-12 at 1,000; employee 375px flow; physical/offline device clock drift/duplicate/withdrawal.

For the sensitive photo/offline path also follow [punch acceptance](../workforce-punch-evidence-acceptance.md): once-per-employee lawful-basis and withdrawal, EXIF stripping, scan-before-storage, encrypted evidence, 90-day purge/legal hold, offline queued action with original UUID, device/server time choice by independent reviewer, cross-account isolation and no automatic face recognition, absence decision or pay effect. PR #930's purge boundary CI is **not** a DPO or device witness.

## Stage 3 — actual shift-to-pay proof and outcome

For every scenario use an evidence row:

| Field | Required |
| --- | --- |
| Scenario / exact SHA | WFM-##, commit and build |
| Fictional environment | tenant/site alias, browser/device and effective flags |
| Expected / observed | precise action and actual response, time, status and role |
| Evidence | private redacted link/opaque reference, optional CI run |
| Decision | PASS / NEEDS_FIX / NOT_RUN (never auto-upgraded from CI) |
| Independent tester | actual role and private identity, witnessed date |
| Finding | bug/ref, corrected commit, rerun and reviewer decision |

Independent Payroll Officer/Checker must verify the timesheet and payroll preview for overnight, corrected, OT, premium and rest/holiday work; no funds move. Real-employer **shadow payroll #579** remains a later, explicitly authorized no-money gate with zero unexplained per-employee differences > PHP 0.01. The Owner records GO / NO-GO with exact deploy SHA and rollback. **Until all P0 tests and approvals are actually witnessed: NO-GO.**

## Parallel operations, not a staging dependency

- [#910](https://github.com/erwinmehehe/payrollph/issues/910): DBA reconstructs historical source/checksum prerequisites and tests the 0121 multi-entity backfill separately. It must **not** be replayed to run fictional WFM-12 paging.
- [#899](https://github.com/erwinmehehe/payrollph/issues/899): SRE/DBA independently disposition the Neon restore/routing incident before production release. Missing retained HTTP telemetry is a documented evidence gap, not proof of zero writes.
- [#112](https://github.com/erwinmehehe/payrollph/issues/112): secrets, bank encryption, email and production launch approval are separate. Never interpret green staging or merged WFM source as a release authorization.

**Next human action:** nominate the actual WFM manager, SRE/DBA, HR/PH payroll, privacy/AppSec and mobile tester, provide a protected synthetic staging application, freeze its SHA, then execute WFM-12 and the 14 scenarios. No synthetic artifact can supply those approvals.
