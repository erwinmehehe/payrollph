# Workforce Demand Governance GET API GAP recovery

**DRAFT / NOT ACCEPTED / ZERO COVERAGE CREDITS / DO NOT MERGE WITHOUT REVIEW.**

## Exact methods and known gaps

- GET /api/workforce/demand-observations/issued
- GET /api/workforce/demand-staffing/policies

Both methods are **GAP** in the current-main API coverage manifest. Merged PR #1474 established initial fictional PostgreSQL 16/localhost HTTP own-vs-foreign reads. Draft PR #1509 explicitly **excluded both from its 16-method credit proposal**: the shared runner did not snapshot the demand-issue/score and staffing-policy/event source tables or prove all forged scopes. A historical HTTP success is not complete source-bound method acceptance.

This PR adds a standalone supplemental proof using #1474's exact existing source-row factory, without changing its source-hash-sensitive code, the shared table runner, read-recovery snapshot, existing receipts, production routes, schema, flags or manifest. It avoids conflicts with PR #1509's global reconciliation files.

## Disposable real-HTTP/PostgreSQL 16 evidence

The dedicated workflow imports the original allowlisted-reads QA profile, prepares an **empty disposable PostgreSQL 16**, applies the reviewed isolated baseline and SQL-only HCM work-item fixture, then runs the private-fixture bootstrap **before the localhost Next server starts**. The bootstrap creates two authenticated fictional owner employers (A and B), a real later/higher-ID victim employer, and a fourth excluded employer. The WFM allowlists are derived exclusively from the actual three allowed database IDs. The executable guard rejects non-CI, hosted databases, unknown targets, enabled workers/money paths and provider credentials before any database or app module is loaded.

For both GET methods, each attacker A/B must prove:

1. **200 own persisted source**: HTTP JSON ties to actual SQL row ID, organization, worksite, source hash, status and original strict row acceptance. A's real result fails B's proof, and vice versa.
2. **403 foreign tenant**: Attacker cookie plus the victim's real allowlisted organization and higher-ID worksite. The victim is allowlisted so a disabled-feature 404 is **not** a substitute for true authorization denial.
3. **403 stolen worksite under own organization**: The real higher-ID victim worksite cannot be selected by an attacker supplying its own legitimate employer ID.
4. **Forged source selectors**: Extra victim issueId, policyId or sourceKey parameters on a legitimate own-worksite URL cannot change the SQL-backed own result or expose the victim.
5. **Bounded negative responses**: Anonymous user 401, malformed scope 400, and fourth real nonallowlisted employer 404, with no source document, marker or credential leaked.
6. **Role-scoped policies**: A genuine own active job profile and a separate fictional draft policy return exact own SQL data. The higher-ID victim job profile under the attacker's own organization gets 403. The approved-mode read must **exclude** the unapproved draft rather than promoting it.
7. **Full source and audit immutability**: All four employers' before/after PostgreSQL records match for organizations, workers, pay profiles, memberships, worksites, job profiles, forecast issues/scores/observation revisions, staffing policies/events, schedules, audit, and payroll records.

The runner uses existing INSERT RETURNING values and keeps source rows fictional and unapproved. It reports proof counts only, with productionTested:false, certified:false and coverageCredits:0. No session cookie is logged.

## Exactly five new independent files

- scripts/qa/tenant-demand-governance-recovery-contract.mjs
- scripts/qa/tenant-demand-governance-recovery-http.mjs
- tests/tenant-demand-governance-recovery-contract.test.mjs
- .github/workflows/tenant-demand-governance-recovery-http.yml
- docs/qa/tenant-demand-governance-gap-recovery.md

## Acceptance gates

- [ ] Exact-head JavaScript syntax and adversarial unit tests pass.
- [ ] Exact-head dedicated PG16/production-mode localhost HTTP proves all own, victim, forged selector, missing/anonymous, role scope, SQL-bound hash and unchanged audit evidence.
- [ ] Standard full CI, CodeQL, Security HTTP Smoke and shared tenant-table proof are checked, and any failures are triaged rather than waived.
- [ ] Independent security/workforce reviewer verifies the accepted scope. **An empty approved-mode view proves draft exclusion, not a real approved-policy positive path.** Any required remaining positive variants must be exercised before whole-method coverage certification.
- [ ] Only a separately authorized manifest reconciliation, after sufficient independent acceptance, may change these methods from GAP to COVERED. Never auto-credit either based only on this draft PR.

**Safety:** No Neon, production database, real payroll, live worksite/shift, government filing, provider network call, money, deployment or production flag activation. This is not acceptance of global tenant isolation or release readiness.
