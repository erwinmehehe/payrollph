# Workforce Demand Governance — two-method tenant isolation batch

**Scope:** Only two **GAP** reads, each protected by a different exact-employer allowlist and existing signed-in workforce manager privileges:

- \`GET /api/workforce/demand-observations/issued?organizationId=...&worksiteId=...\`
- \`GET /api/workforce/demand-staffing/policies?organizationId=...&worksiteId=...&jobProfileId=any&metricKind=transactions&intervalMinutes=60&mode=manage\`

This is a **new, distinct two-method read batch**, not a continuation of Recruitment, Year-End, Multi-Entity Registration, Asset Custody, Leave Preview or earlier personnel-operation PRs. At selection time **no open PRs** existed in \`erwinmehehe/payrollph\`. The authoritative manifest still lists both methods as **GAP**.

## What the batch actually does

The existing \`allowlisted-reads\` CI profile inserts two separately authenticated employer owners, a third **actual higher-ID victim**, and a fourth deliberately excluded employer, before the app boots. The two new fixture rows run in **disposable PostgreSQL 16 and localhost production-mode Next.js** only:

| Proof | Actual seeded source | Own employer HTTP | Cross-employer / negative |
| --- | --- | --- | --- |
| Issued forecast history | One persisted source-reported **fictional** issued snapshot record, employer-unique worksite, hash and aggregate count. No actual forecast algorithm or provider is run. | 200, a single employer-specific issued record, hash matches stored snapshot, exact worksite/org/source/point, \`score=null\` | Victim employer+actual victim worksite → 403; wrong employer's real response fails; tampered hash, amount, scope, extra fields and victim marker fail |
| Draft demand staffing policy | One persisted, employer-specific **unapproved draft** policy and worksite, with canonical hash but **no approval** or effective operational authority | 200, exactly the own draft policy in \`mode=manage\`, canonical hash, requested scope, \`approvedAt=null\`, no approval receipt | Victim employer+actual victim worksite → 403; wrong employer's real response fails; forged rate, status, reason, extra fields and victim marker fail |

Each row's returned real database ID must exceed both attacker-owned IDs for the victim. The shared read runner asserts the victim's **organization, employees, org units, legal entities and audit rows** are unchanged, and that both attacker responses fail the other employer's own-data proof. It does **not** add table-specific before/after snapshots of the issued forecast or policy source tables; security reviewers may require those independently.

The fourth signed-in excluded employer must receive **404** from **both** pilot-gated endpoints. Dynamic allowlist IDs are generated from the disposable bootstrap's actual organization IDs; there are no hardcoded tenant IDs or wildcard enablements. Both new flags are enabled **only** in the disposable \`allowlisted-reads\` profile. No production flag or employer grant changes.

## Boundaries and acceptance

- This is **read isolation** of seeded fictional data. Seeding an apparent issued record directly is **not proof of authentic forecast issuance, training evidence integrity, independent source review or a legitimate frozen score**. The no-approval staffing draft is deliberately not active. Nothing here schedules workers or calculates, releases or moves payroll.
- This proof does **not** cover operational \`POST\`/approval/\`PATCH\` methods, same-tenant unauthorized org units or job profiles, tamper of a stored record after proof, source provider API calls, live customer data or production release flags.
- A focused source suite (\`tests/tenant-demand-governance-batch.test.mjs\`) tests two exact method contracts, hash determinism, fake-DB seed bindings, discriminating positives, malicious response mutations, static allowlist guards and continued GAP state. **Do not assert this suite passed unless an execution receipt exists.**
- Required before acceptance: exact-head **Tenant table proof** on disposable PG16/localhost HTTP for the \`allowlisted-reads\` profile, unchanged other profiles, fourth-employer denial, focused source tests, full CI, tenant GAP factory, security/CodeQL checks, and independent security review. Any CI failure remains a blocker and must be understood on its own merits.
- Do **not** alter either manifest status to COVERED merely because the source row or a CI job exists. Any eventual credit requires a separate independent manifest reconciliation and proof against actual exact-head HTTP + database evidence.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO COVERAGE CREDITS.** This batch makes no changes to application routes, schema, migrations, employee identity, forecasts issued to customers, schedules, payouts, money movement or production flags. Global tenant isolation and live payroll readiness remain NO-GO.
