# Post-cutover smoke: real database roles, fictional CI and owner-only live verification

**Scope:** `payrollph_clean_baseline` from the protected #1241 clean-baseline cutover. This smoke is **not** an instruction to perform another cutover, approve production migration, activate a payout provider, or move money. It does not modify the existing cutover runner, migration artifacts or release flags.

## What the disposable GitHub Actions job proves

Workflow: `.github/workflows/post-cutover-real-role-smoke.yml`. It runs on relevant PRs, pushes to `main`, or an explicitly dispatched `main` run, on an isolated PostgreSQL 18 service with no production environment or Neon credentials.

1. `npm ci`, `npx tsc --noEmit`, `npm run lint` and `npm test` execute before the new journey. The **source schema** is built exactly like the existing clean-baseline-cutover rehearsal: `npm run db:push`, isolated 0109 audit migration, source baseline supplement and a schema-only `pg_dump`. All of this is disposable CI work, **not** a live migration.
2. The unchanged `scripts/run-clean-baseline-cutover.mjs` performs dry-run then apply against the **simulated Neon owner** and the empty allowlisted `payrollph_clean_baseline`. The existing cutover verifier runs as `payrollph_migration_planner`. The CI-only provisioning helper exports an additional masked, randomly provisioned `SIM_SEALER_URL` alongside the existing app and planner session URLs. No passwords or connection URLs are printed or included in artifacts.
3. The **real production-mode** Next.js build/server runs as `payrollph_app` (`DATABASE_URL`), using only `payrollph_sealer_login` (`AUDIT_SEALER_DATABASE_URL`) for dedicated chain sealing. Runtime schema checks use the preexisting read-only cutover mode. Payment/payout flags remain disabled. The test never calls a bank, payout, mail, billing, or Neon provider. Test accounts and bank/mobile references are unmistakably fictional and use the `.invalid` email domain.
4. Before doing any payroll, actual PostgreSQL sessions verify identity, role attributes, catalog grants, ledger and cutover receipts, the `btree_gist` extension, and DML-versus-DDL restrictions. Negative probes execute **writable transactions that always roll back**; a denied query must actually return an authorization/guard failure. A role escalation, including an app-role `UPDATE audit_events`, is a **hard stop** before fictional HTTP mutations. Planner writes, reads of PostgreSQL's protected credential catalog, and the sealer login's direct history mutations are also denied. After dedicated sealing, the sealer group's attempted actor rewrite and sealed-chain rewrite must also fail. No privilege change or database repair is attempted by the test.
5. The localhost HTTP journey exercises first-run employer bootstrap, login, a separately invited fictional employer signup/login, employees, payroll draft, calculate, submit review, independent checker approval, record-only release, payslip, **bank-file dry-run**, and **statutory draft**. It checks five cross-tenant read/write attempts before payroll, including A-to-B and B-to-A writes, and three more after. Distinct fictional maker/checker identities and an explicitly marked **CI-only synthetic MFA session fixture** test existing MFA and maker/checker server guards. It does **not** certify genuine human TOTP enrollment.
6. For business steps the smoke compares actual before/after audit-event counts. A successful password login writes a sanitized audit event for each **active** workspace membership, in one transaction, **before** the session cookie is issued. An audit append failure revokes the undelivered session; no passwords, MFA codes, cookies, tokens or IPs are included. The dedicated sealer login seals the chain, and a database-recomputed chain-hash check validates stored heads, continuity and zero missing tail. Separately, in-memory alterations/deleted-tail variants **must fail** verification without touching audit history. The test also asserts an unapproved release is rejected and preserves the entry snapshot. A successful record release does **not** mean wages were paid, dispatched or uploaded.
7. GitHub Actions terminates and restarts the same real Next.js server without replacing the database, then asserts that the payroll remains released with exactly one run, two register entries and two payslips and that the persisted audit head remains valid. A fresh HTTP login must see the one original run. Because that login creates a fresh audit row, the separate restricted sealer must seal this **post-restart** event and the final chain verification must again show zero unsealed tail.

### Reports and blocking behavior

The workflow publishes the sanitized reports at **Actions → Post-Cutover Real-Role Smoke → selected run → Artifacts → `post-cutover-real-role-smoke`**:

- `ci-report.json`: one `PASS` or `FAIL` per check, exact assertion code, commit SHA and a **catalog snapshot** with the real CI-built table count and schema fingerprint (SHA-256 of stable PostgreSQL catalog metadata).
- `restart-report.json`: separate HTTP/server restart, persistence, no-duplicate and audit-head checks.
- The job summary prints the same PASS/FAIL check table; uploaded files contain no connection URLs, session cookies, passwords, bank files or payroll data.

A role/grant or privilege probe failing is an immediate blocker. **Do not weaken guards, grant new app privileges, edit audit history or retry against a real database** to make a test green. Open an owner security finding first. Functional failures stay visible as precise failing assertions in the CI report and likewise must not be converted to skips.

## Owner: read-only verification against the already-cut-over live clean database

**This is a manual operator procedure, not CI and not agent work.** The script `scripts/qa/post-cutover-live-smoke.mjs` has **no write implementation**. Supplying `--write`, `--fictional-write` or `--confirm` is rejected. No throwaway employer is created on live. There are no Neon management operations, migrations, SQL writes, flag changes or provider calls.

### Preconditions

1. Confirm the protected cutover has already completed and the runtime attestation (issue #1316) is green for the **exact deployed commit**, independent expected project, branch, endpoint, database and app login. Do not derive expected values from the database connection URL or from the result of the smoke itself.
2. Wait for the **post-cutover smoke workflow on `main`** for exactly that deployed commit to complete with **all checks green**, including restart. Download `ci-report.json` from that workflow's artifact to a private local directory. A PR-merge SHA is not a substitute for a successful workflow run on the deployed `main` SHA.
3. Check out and fast-forward local `main`, confirm no uncommitted modifications, and independently compare its 40-character SHA with the live Vercel deployment and the downloaded CI report. The live script enforces a `main` checkout, the SHA match, the CI report match and the same schema fingerprint and table count.
4. Arrange **only** the existing `payrollph_app`, `payrollph_migration_planner` and `payrollph_sealer_login` restricted PostgreSQL login URLs, from the owner's approved secret store. **Do not supply a Neon owner, migrator, superuser or secret-bearing admin URL.** All three URLs must point to the same clean-baseline Neon host/port/database, have TLS `sslmode=verify-full` (or its verified legacy equivalent), and carry no startup overrides or query parameters other than `sslmode`.
5. Use the independently owned readiness token from the deployed app and keep terminal tracing disabled (`set +x`). Never put any database URL or token on the command line, in command history, into a PR or into a CI variable.

### Operator steps

From a secure terminal in the reviewed repository, set **these variable names** using the owner's private secret manager. The placeholders here are descriptions, **not** credentials to run verbatim.

```sh
git switch main
git pull --ff-only origin main
git status --porcelain
git rev-parse HEAD
set +x

# From independent owner-verified production deployment settings:
export EXPECTED_PRODUCTION_COMMIT_SHA=REVIEWED_40_CHARACTER_MAIN_SHA
export EXPECTED_PRODUCTION_DATABASE_NAME=payrollph_clean_baseline
export EXPECTED_PRODUCTION_NEON_PROJECT_ID=calm-wave-70219564
export EXPECTED_PRODUCTION_NEON_BRANCH_ID=OWNER_VERIFIED_CLEAN_BRANCH_ID
export EXPECTED_PRODUCTION_NEON_ENDPOINT_ID=OWNER_VERIFIED_CLEAN_ENDPOINT_ID
export EXPECTED_PRODUCTION_RUNTIME_DB_ROLE=payrollph_app

# Export via your secret manager's non-echoing environment injection:
# POST_CUTOVER_APP_DATABASE_URL
# POST_CUTOVER_PLANNER_DATABASE_URL
# POST_CUTOVER_SEALER_DATABASE_URL
# PRODUCTION_READINESS_TOKEN
# Never echo these values.

node scripts/qa/post-cutover-live-smoke.mjs --ci-report /private/path/ci-report.json
```

The script refuses incomplete/mismatched pins **before opening a database connection**, then calls the same fixed **read-only** private deployment identity endpoint as the runtime attestation. It establishes each real restricted login and performs only `BEGIN ... READ ONLY` / `ROLLBACK` transactions. The checks assert:

- Login identity and independently pinned Neon session metadata: project, branch, endpoint, `payrollph_clean_baseline`, role and primary writer (not a read replica).
- Role attributes, effective DML/schema grants and the inability to edit `audit_events`, audit heads and the three migration-control ledgers.
- `btree_gist`, the migration-cutover row, exact manifest SHA and all baseline-included receipts.
- Table count and full public table/column fingerprint **identical** to the successful CI-built database, not an assumed hardcoded count.
- Audit event hashes recomputed by the database and compared with the stored chain heads; any break or pending/unsealed tail produces a failure, including missing sealed tail.
- Anonymous public liveness and authorized `/api/readiness` states, including the audit-chain-protection readiness gate. A general `not-launch-ready` state can still be correct when unrelated external evidence is absent.

The output is printed and stored as `qa-artifacts/post-cutover-smoke/live-report.json`, with mode `0600` and PASS/FAIL assertion codes. It includes **no tenant rows, URLs, credentials or money details**. Any blocker means **stop** and escalate for owner review; do not switch logins, repair DDL, add grants or run the full fictional journey on live.

The live run is intentionally narrower than CI: **no signup, no synthetic test employers, no session writes, no retries that modify rows, no sealer invocation, no provider calls, no migrations, no data cleanup.** Adding a live write path requires a separately reviewed explicit flag **and** typed confirmation with a documented exact fictional insert receipt. That capability is **not implemented by this PR**.

## Known evidence boundaries

- A simulated Neon owner and local PostgreSQL 18 are not a proof of the hosting vendor's network, pooling, TLS authentication or real-provider health.
- The CI's fictional MFA session evidence proves server-side guards but not real-world device enrollment. Do not relabel it as full MFA acceptance.
- The negative unapproved release is a financial **preflight** check. A separate controlled app-role transaction deliberately fails after a payroll draft and first entry insert, confirming atomic rollback with no partial rows. Neither substitutes for injecting an exception into the actual payroll calculation worker; doing that would require separately reviewed disposable-only instrumentation.
- Business route audit completeness is tested rather than assumed; missing events, incorrect states or schema mismatches are findings, not expected skips.
- Do not run this owner-only live script from any GitHub Actions job. Its built-in `CI` and `GITHUB_ACTIONS` guards reject doing so.

## Source review follow-up

Successful local-login audit writes are gated by `LOCAL_LOGIN_AUDIT_ENABLED`, registered default-off in the critical release inventory. Missing, false and non-exact values preserve the prior login path without opening an audit transaction. The isolated Security HTTP Smoke and post-cutover workflows explicitly enable the flag; enabled writes still must succeed before the cookie is delivered. Production activation is separate and has not been performed. The flag-off/no-transaction, sanitized write and rejected-write behavior is executed in `tests/local-login-audit-flag.test.ts`. Existing real PostgreSQL HTTP coverage remains required for active-membership isolation, session containment and restart sealing.
