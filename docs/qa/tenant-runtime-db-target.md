# Runtime Database Target: private diagnostics, source identity and tenant non-disclosure

**DRAFT / NOT ACCEPTED / ZERO NEW API COVERAGE CREDITS.** Dedicated EDG-01 operator-only readiness privacy regression for **GET /api/readiness/database-target**. This route is not an employer-scoped data read. The reviewed boundary is the readiness-token gate, authenticated PostgreSQL runtime-session metadata, response minimization and zero changes to underlying employer records.

## Exclusive scope — five new files

- .github/workflows/tenant-runtime-db-target-http.yml
- scripts/qa/tenant-runtime-db-target-contract.mjs
- scripts/qa/tenant-runtime-db-target-http.mjs
- tests/tenant-runtime-db-target.test.mjs
- docs/qa/tenant-runtime-db-target.md

No existing runtime route, package, schema, migrations, shared tenant manifest, ledger, provider configuration or current PR file is modified. The source identity guard pins the existing three critical Git blobs:

- src/app/api/readiness/database-target/route.ts — bda08317ec9600d9434491a1376908d36d978b92
- src/lib/runtime-database-identity.ts — 2969b7d2371434d1e146184413f29b28e1fe73bc
- src/lib/operational-secret.ts — 02d83b4c996e7934c9c3838dcc4cedb85e42c168

This is separate from open PRs addressing HCM SLA escalation, enterprise admin, marketing operator leads, workforce planning scenarios, payroll rehearsal/tax classification, account email, private document vault and subscription ledger. Recheck all active PRs before merge.

## Required real-HTTP / disposable PG16 evidence

1. Start clean fictional local PostgreSQL 16 app_db and a production-mode Next server bound to 127.0.0.1:3000; send no request to any external host.
2. Seed three independent fictional employers with owners, real session records, workers and pay profiles. Third victim is persisted last with genuinely higher organization ID. Read their complete employer, employee, membership, pay-profile, payroll, audit and outbox snapshots.
3. Without the token, with an incorrect token, or with a valid employer's browser cookie but no token, require identical hidden 404, no-store, no employer metadata and no data mutation.
4. With a one-time CI-generated readiness token, require 200 with strictly defined private metadata only. Verify the PostgreSQL session's reported database, role, synthetic metadata and schema table counts with independent read-only catalog/session SQL.
5. Supplying either a signed-in employer cookie or forged query selector alongside the valid token must not introduce employer-specific data; all three authorized responses must be identical apart from generatedAt.
6. Re-read all three employers' SQL snapshots and require byte-equivalent business data with zero mutations or audit/outbox writes.
7. Upload an aggregate, non-PII JSON receipt only. A passing source test without actual HTTP/PG16 execution does not count as successful evidence.

The production endpoint expects Neon-style session metadata (project/branch/endpoint identifiers) and otherwise returns 503 on a plain PostgreSQL server. This **fictional CI-only** workflow sets local PostgreSQL custom GUCs through PGOPTIONS with intentionally fake ci-fictional values. The test explicitly reports fabricatedNeonSessionMetadata=true and verifiedActualNeon=false. The fixture is **not proof of Neon production configuration, migration execution, release approval, or operational health**.

## Safety and release boundaries

- Private ephemeral GitHub Actions tokens only; never accept production READINESS_TOKEN, database credentials, Neon URLs or real tenant content.
- All data fictional, with synthetic email suffix @example.invalid. Worker/scheduler and provider/payment flags disabled.
- No background jobs, external provider/API calls, bank files, payroll releases, real email, notifications, migrations on production, deployment, or merge.
- No manifest promotion, security certification, tenant-wide acceptance, or release authority.

## Merge/review gates

- [ ] Exact final head passes dedicated real HTTP and PostgreSQL 16 job with valid receipt.
- [ ] Full CI/typecheck, CodeQL and security checks pass.
- [ ] Independent security/privacy reviewer verifies response shape and tenant non-disclosure, including the synthetic-GUC limitation.
- [ ] Reconcile current main, source pins and all open PR file overlap.
- [ ] Keep any coverage promotion and real provider validation separate until independently accepted.

Not tested: actual Neon sessions or production connectivity, proxy/cache misconfiguration outside localhost, invalid production credentials, environmental rollout, and independent human sign-off.
