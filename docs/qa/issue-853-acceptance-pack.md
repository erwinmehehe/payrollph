# Payroll PH — Issue #853 two-employer acceptance pack

A **zero-subscription**, development-only manual acceptance kit for the fictional Payroll PH employer-to-payroll journey.

The substantive runbook is [`docs/qa/issue-853-two-employer-operator-acceptance.md`](issue-853-two-employer-operator-acceptance.md). It covers two fictional employers, six segregated personas, 18 nine-stage checks, nine cross-tenant/mobile/error-recovery checks, isolated/private evidence and safe sign-off criteria.

The **automated scope audit** (`scripts/qa/issue-853-synthetic-coverage.mjs`) validates the existing connected nine-stage and Chromium reports before writing sanitized evidence that is explicit: Employer A and Employer B must each complete 9/9 source-connected synthetic HTTP stages against the same disposable PostgreSQL database, with distinct worker, payroll, timecard and draft worksheet lineage. **0/27 independent human-observed cases were performed**. The validator rejects any B shadow-only receipt. Both full employer journeys must be observed separately by human operators before acceptance.

The Node 22 ledger helper (`scripts/qa/issue-853-evidence-ledger.mjs`) generates a blank, private evidence JSON outside the repository, never calls the application, and validates claims fail-closed. Regression tests are included and can be run with:

```sh
node --test tests/issue-853-evidence-ledger.test.mjs tests/issue-853-synthetic-coverage.test.mjs
```

Use the **actual** development app, verified deployed SHA and separate human participants to execute the guide. This kit does **not** log in, simulate a real person, manipulate production Neon, migrate database schemas, disburse money, or submit statutory filings.

**Initial evidence status:** 0/27 human scenarios run. No independent human acceptance can be marked as completed from this package alone. Never commit the generated ledger or private evidence to GitHub.

The connected two-employer engineering rehearsal is distinct from human acceptance. Even 18/18 green scripted employer stages leave all 27 witnessed operator cases NOT_RUN until independently observed on a verified running development app.
