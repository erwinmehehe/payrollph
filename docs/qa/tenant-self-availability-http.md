# Independent employee availability tenant HTTP proof (provisional)

This source-only QA change adds a **separate** synthetic PostgreSQL 16 / real Next.js HTTP job for `GET` and `POST /api/self/availability`. It does not alter the endpoint, a runtime flag, the shared tenant table, the tenant isolation coverage manifest, migrations, payroll data or other draft PRs.

The job seeds three **fictional** employers (two distinct attacking employee sessions and a separately populated higher-ID victim), plus a second worker inside each attacker's employer. Real authorized GET and create/remove POSTs must succeed for each worker, while forged query/JSON employer and employee IDs, foreign rule removal, and same-employer peer rule removal are denied. The test also verifies that the victim's entire rule, employee, audit and payroll snapshots remain unchanged and that other workers' rules remain unchanged.

All use an isolated, empty `127.0.0.1:5432/app_db`, a local `127.0.0.1:3000` server, synthetic session cookies, disabled payout providers and a **job-only** `WFM_EMPLOYEE_AVAILABILITY_ENABLED=true` flag. The browser/UI rollout flag remains OFF. The proof refuses any nonempty test database, external host, missing CI mode, or provider credentials.

**Coverage accounting:** the manifest's `GET` and `POST` GAP statuses remain GAP. Passing isolated CI would be new *provisional HTTP evidence*, not a certified source-manifest credit, production security acceptance, or authorization to enable the feature. A separate manifest reconciliation/review can occur after the current overlapping tenant-manifest PRs merge. Do not represent green source tests as executed real-device, real-employer, financial, or independent reviewer signoff.

**Expected review:** inspect exact-head job outcome and the source changes for lack of payment, time-punch, or roster writes. Keep draft until current-head security checks and independent reviewer requirements are satisfied. Rollback is deletion/revert of this isolated QA workflow and script files.
