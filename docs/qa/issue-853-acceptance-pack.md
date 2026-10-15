# Payroll PH — Issue #853 two-employer acceptance pack

A **zero-subscription**, development-only manual acceptance kit for the fictional Payroll PH employer-to-payroll journey.

The substantive runbook is [`docs/qa/issue-853-two-employer-operator-acceptance.md`](issue-853-two-employer-operator-acceptance.md). It covers two fictional employers, six segregated personas, 18 nine-stage checks, nine cross-tenant/mobile/error-recovery checks, isolated/private evidence and safe sign-off criteria.

The **automated scope audit** (`scripts/qa/issue-853-synthetic-coverage.mjs`) validates the existing connected nine-stage and Chromium reports before writing sanitized evidence that is explicit: Employer A completed 9/9 synthetic stages, Employer B is a shadow tenant for isolation, and **0/27 human-observed cases were performed**. Both full employer journeys must be observed separately by human operators before acceptance.

The Node 22 **v2** ledger helper (`scripts/qa/issue-853-evidence-ledger.mjs`) generates a blank, private evidence JSON outside the repository, never calls the application, and validates claims fail-closed. All runtime payout, filing, and real-data safety flags start **`null` (UNVERIFIED)**, never prechecked `false`. A real human must first inspect the running app and record a dated, private safety-verification reference before marking any case observed. The v1 evidence schema is rejected rather than silently upgraded; archive old packets privately and initialize a new session. Regression tests are included and can be run with:

```sh
node --test tests/issue-853-evidence-ledger.test.mjs tests/issue-853-synthetic-coverage.test.mjs
```

Use the **actual** development app, verified deployed SHA and separate human participants to execute the guide. This kit does **not** log in, simulate a real person, manipulate production Neon, migrate database schemas, disburse money, or submit statutory filings.

**Initial evidence status:** 0/27 human scenarios run. Record actual observed `PASS` or `NEEDS_FIX` with UTC time, different operator/reviewer pseudonyms and unique encrypted-private proof references. `NEEDS_FIX` requires a `BUG-...` defect ID; `BLOCKED` requires a reason code; `NOT_RUN` retains empty observation fields. The validator is strictly an **unverified self-report completeness check**. It does not verify witness identities, physical hardware, actual app deployment, encryption, or regulatory/payroll correctness. No independent human acceptance can be marked completed from this package alone. Never commit the generated ledger or private evidence to GitHub.

PR #1010 was merged on October 14, 2026. This pack is proposed as a separate source-only PR for issue #853, subject to exact-head CI and review; it does not itself grant release approval.
