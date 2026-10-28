# Approval task PATCH: independent tenant-isolation GAP candidate

**Status: DRAFT / NOT ACCEPTED / zero coverage credits.**

## Selection and overlap

- Exact authoritative method: PATCH /api/approvals/[id] (canonical PATCH approvals/[id]). Main's coverage manifest marks it **GAP**, not COVERED.
- Checked the currently open PRs and their changed paths. None owns this method or the new tenant-approval-task QA, CI, tests or documentation files.
- No shared coverage manifest, inventory, tenant-table catalog, credit writer, existing test fixture, application route, provider configuration, migration or other PR-owned file is modified.

## What the dedicated GitHub Actions job must demonstrate

1. Start freshly empty disposable PostgreSQL 16 on 127.0.0.1:5432/app_db and a production-mode Next server on 127.0.0.1:3000. The pre-import guard refuses non-CI targets, nonlocal connections, nonempty source tables, active workers, provider switches or secrets.
2. Persist three independent fictional employers with distinct IDs, real employees/pay profiles, owner memberships and authenticated MFA-verified sessions. Seed real pending generic role:owner approval tasks. The victim's path ID must be larger than both attackers' real task IDs.
3. Before any attack, require a successful genuine victim-owner approval on a separate task, confirming that the method is reachable and useful. The targeted higher-ID victim task must remain Pending.
4. Using both signed-in attacker employers, PATCH the existing victim's path and the peer employer's path, require a generic HTTP 404 and ensure neither response body nor headers leak the victim marker, task title or any session token.
5. Test a nonexistent ID (404), a signed-in same-name foreign owner (404), a nonowner within the attacker's own employer (403), a revoked employer membership (denial), anonymous access (401), invalid decision input (400) and cross-site mutation (403).
6. Compare actual PostgreSQL snapshots of all employers' approval tasks, audits, memberships, employees, pay profiles, payroll runs and payroll entries before and after the entire denial phase. No denial may change business or audit rows.
7. Require each legitimate attacker owner to decide a real *own* task with HTTP 200 and persisted Declined/Approved status, a matching user-bound audit row and no payroll action. Pass forged organization/task/approver fields in the request body and prove they cannot redirect the path-based decision.
8. Reject one attacker's genuine HTTP result under the other's own-object proof. Replaying a decided task must return 409 without adding audits or changing DB rows. The victim's complete snapshot must remain unchanged after all attacker actions.

## Boundaries and acceptance

- This method-specific proposal exercises **only generic, unlinked owner-role approval tasks**. It does not certify payroll checker decisions, payroll release, HCM/leave decisions, approval chains, dynamic groups, delegation, all entity scopes or other routes.
- Synthetic contract tests are not a replacement for real localhost HTTP requests and PostgreSQL verification. No live employer, employee, provider, funds, payroll approval, statutory filing, production DB or deployment is touched.
- There is no confirmed exploitable leak or claimed fix. The manifest's GAP stays unchanged; the proof is **provisional until exact final-head PG16/HTTP CI passes and an independent reviewer accepts the bounded evidence**.
- No release flag activation, automatic coverage credit, auto-merge or deployment approval is requested.

## Execution

- Contract: node --test tests/tenant-approval-task-contract.test.mjs
- GitHub Actions: Approval task PATCH tenant boundary (fictional PG16 HTTP; no money)
- HTTP runner in that job: node --import tsx scripts/qa/tenant-approval-task-http.mjs

**Do not run this runner against existing, external or production databases.**
