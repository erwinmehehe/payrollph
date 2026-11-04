# Company export tenant boundary hardening — draft, zero coverage credits

## Separate family
Only `GET /api/exports` and its own export-kind parser, test and note. No shared tenant manifest, coverage guard, existing QA, migrations, payout, payroll engine, provider, or files changed by open PRs.

## Changes
- Require exactly one explicit, canonical positive `organizationId`, never implicit tenant 1.
- Authorize the authenticated session, active workspace membership and export role before employer-data reads. No GET-triggered `ensureSeedData()` write before authorization.
- Push organizational-unit restrictions into employee SELECT, and continue to apply existing legal-employer predicates.
- Select only employee, payroll or audit tables required by each export kind. The full JSON export still selects all three, with existing MFA and masking.
- Serve all CSV/JSON downloads with private/no-store and nosniff headers.

## Remaining proof and acceptance
Run `npx tsx --test tests/company-export-tenant-boundary.test.ts` and applicable CI at the exact PR head. These are parser, route source and query contract tests, **not a PostgreSQL tenant-isolation acceptance proof**.

Before promoting `GET /api/exports` from **GAP**, require a separate fictional disposable PostgreSQL 16 production-mode HTTP run with two authenticated owners, owned exports, a genuine higher-ID victim, forged/duplicate selectors, revoked access, no victim disclosure or mutation, and exact-head CI and independent security review. **Zero method credits now.** No real provider connections, money, production DB, release or deployment are authorized.
