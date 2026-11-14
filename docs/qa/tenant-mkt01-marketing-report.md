# MKT-01 - marketing leads GET, operator-scoped aggregate credit

**Credit category:** SOLO_VERIFIED_DEV_RECOVERY - provisional method evidence from a sole-owner fictional PostgreSQL 16 HTTP proof. NOT PUBLIC-BY-DESIGN, NOT independent review, NOT employer-specific data access.

**Source pins:** `src/app/api/marketing/leads/route.ts` at `69a046c25fb59ccc75c47b41d44c26b585e898b3`; `src/lib/marketing-report.ts` at `7371a252be449829b09e7a0ff501d77eb6d811fd`. Neither covered source was modified.

**Successful real-HTTP proof:** [GitHub Actions job 43530460939/132246563132](https://github.com/erwinmehehe/payrollph/actions/runs/43530460939/job/132246563132), executed on exact checked-out head `bfedf16fecf0ff4e918da68972ac7a18488c4a4b`; genuine production-mode localhost Next against disposable PG16 and fictional identities/leads.

## Four mandatory proof results

1. **Authorized positive (200, aggregate only).** Two separately signed-in fictional allowlisted operators succeed when their sessions have recent MFA. Three recent fictitious demo/trial leads aggregate into count-only buckets. Seeded distinctive private names, email addresses, company names, notes and message strings are forbidden from the entire response.
2. **Real denials.** Persisted signed-in higher-ID foreign employer owner outside the allowlist => **403**; anonymous => **401**; allowlisted operator without recent MFA => **403, MFA_REQUIRED**; revoked operator session => **401**. Two additional real production-mode localhost Next servers with an **empty** and **unset** allowlist => **503**.
3. **Read-only database.** Immediately around **every** endpoint request, compare before/after snapshots of all fictional marketing leads and every discovered table with an organization, employer, legal-employer, business, company, or user ownership key; also include organizations, payroll runs, audit events and users. Rows remain identical. Explicit fixture session-MFA/refreshed/revocation changes happen between requests; they are not report side effects.
4. **Forged selectors and days bounds.** Higher-ID foreign `employerId`, `businessId`, `legalEmployerId` and `email` (plus organization/worker ID and raw-format) in the **query**, **headers**, **cookie** and all combined do not alter the aggregate beyond a generated timestamp. Negative/zero `days` clamp to 1, huge values to 365, and NaN/Infinity/malformed values fall back to 90. Every forged request receives an unchanged-database check.

## Coverage and untested boundaries

The shared manifest gives exactly **one provisional COVERED GET method credit** after reconciliation; the standalone proof runner correctly reports `newCoverageCredits: 0` before review. The method is **operator-scoped**: a platform-wide aggregate report protected by the configured operator email allowlist and recent MFA, **not** a public endpoint and **not** evidence of ordinary employer-tenant record access.

**Not tested:** the actual deployed operator allowlist or env configuration; human MFA enrollment/UAT; arbitrary free-text campaign, attribution or landing-path metadata de-identification; marketing consent; independent security/privacy sign-off; production readiness or broader tenant isolation. The aggregator may group free-text campaign/landing dimension labels: this proof establishes exclusion of seeded prospect private fields, not a universal privacy guarantee for every possible attacker-controlled attribution string.

No customer data, production database or SQL, Neon, migrations, provider calls, real secrets, payouts, money, CSP or calculation-history flags were enabled. Owner-only label **SOLO_VERIFIED_DEV_RECOVERY**. Independent review and production acceptance stay **PENDING**. Other method/page gaps are unchanged.

## Deterministic source-linked regeneration

```sh
node --test tests/tenant-mkt01-marketing-report.test.mjs
node scripts/qa/tenant-mkt01-marketing-credit.mjs --write
node scripts/qa/tenant-mkt01-marketing-credit.mjs --check
git diff -- scripts/qa/tenant-isolation-coverage-manifest.json docs/engineering/tenant-isolation-coverage-inventory.md docs/engineering/tenant-isolation-closure-plan.md
```

The tooling derives aggregate method counts and the frozen twelve-batch subtotal from current source-linked method statuses, never from hand-entered counts. Preserve the passing route/report/runner/contract/workflow blob pins, and rerun real HTTP on any changed covered source. This proposal requires a passing exact **final PR head** run before review or merge.
