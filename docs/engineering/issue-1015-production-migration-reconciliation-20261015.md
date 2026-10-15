# PayrollPH #1015 — production migration reconciliation (October 15, 2026)

**Classification: READ-ONLY evidence / no production repair performed.** This document is not a historical migration execution receipt, verified offsite restore, signed approval, or permission to enable real payroll/payout.

## Exact sources and targets

- Reviewed GitHub source `main` SHA: `0b331708e178a09952a5d841703a908bb5162e49`. The source directory has **138 numbered SQL files and 13 historic duplicate-prefix groups**. Every eventual source receipt must use a complete path and its exact-byte SHA-256.
- Live Neon inventory target: project `calm-wave-70219564`, primary/default branch `br-lucky-sound-b79i56jw`, `neondb` (endpoint `ep-cool-hat-b7e7gpoo`). Database identity was observed inside this explicitly selected Neon connection.
- Recovery branch: `br-sweet-wildflower-b7hlzuen`, created directly from primary 2026-10-15 08:41:15 UTC, nonprimary. The same read-only metadata query gave an identical result; this does **not** establish that Vercel's actual runtime uses the selected target.
- Reproducible generator in this PR: `node scripts/generate-issue-1015-catalog-inventory.mjs > issue1015.sql`. The generator connects to **no** database and emits one fixed-value `pg_catalog`-only SELECT. Have a restricted catalog reader execute the generated SQL on an explicitly confirmed target. Its result is labeled `CATALOG_EVIDENCE_ONLY_NOT_HISTORICAL_RECEIPT_OR_RELEASE_APPROVAL`.

## Live ordered-migration structural evidence

Against both primary and recovery: **169 source-declared object checks, 42 present and 127 missing**.

| Numbered source prefix | Present / checked | Missing |
| --- | ---: | ---: |
| `0110` | 0 / 3 | 3 |
| `0111` | 0 / 2 | 2 |
| `0112` | 0 / 6 | 6 |
| `0113` | 0 / 6 | 6 |
| `0114` | 0 / 7 | 7 |
| `0115` | 0 / 3 | 3 |
| `0116` | 0 / 13 | 13 |
| `0117` | 0 / 2 | 2 |
| `0118` | 0 / 4 | 4 |
| `0119` | 0 / 4 | 4 |
| `0120` | 0 / 12 | 12 |
| `0121` | 0 / 13 | 13 |
| `0122` | 0 / 2 | 2 |
| `0123` | 42 / 86 | 44 |
| `0124` | 0 / 6 | 6 |

Coverage is intentionally a **partial structural inventory**: CREATE TABLE declarations, CREATE INDEX names with table ownership/validity/uniqueness, four named CHECK constraints from 0119, and the two named organization columns from 0122. It does not verify full index signatures, all column types/defaults, altered-table backfills, existing data, payroll money values, or historical execution proof. Presence of older 0123 objects can reflect other sources or compatibility DDL and must **not** be promoted to an `applied` receipt.

### Historical cutover and forward-order status

- On the selected Neon primary, `public.payrollph_release_migration_receipts`, `public.payrollph_migration_cutover`, `public.payrollph_schema_migrations` and `public.attendance_exception_events` are all missing.
- The protected runner (`scripts/lib/reviewed-migration-runner.mjs`) deliberately rejects missing adopted cutover, missing full-path historical receipts, invalid forward journal and out-of-order migration requests. Forcing migration 0124 without reconciling 0110–0123 would invalidate the audit trail.
- Prefixes `0110`–`0114` have missing critical historical catalog objects (provider events and governed demand/staffing). Prefix `0123` has a mixed object state, so neither blanket `applied` nor blanket `not-applied` can be inferred.
- `0119` and `0122` are additive/change SQL rather than table-creation scripts; absence of the checked named constraints/columns proves only those specific expected catalog artifacts are absent.
- No migration receipt was invented, no ledger was bootstrapped, and no source number was skipped.

### Application and recovery readiness

- Vercel project `prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh` has ready production deployments, but the connected environment reader masks sensitive `DATABASE_URL` values. The exact *runtime* host/project/branch/database/role match remains unverified. Do not print passwords or URLs in GitHub.
- PR #1057 (`drizzle/0124_attendance_exception_forward_repair.sql`) is merged. On Neon PostgreSQL 18, its exact eight statements were rehearsed on a nonprimary branch inside one explicit `ROLLBACK` transaction, with **36/36** expected final-state attendance catalog objects passing; separate SELECT proved no persistent attendance table remained in the rehearsal target.
- Current recovery branch is a verified current-state **copy-on-write fork**, not a witnessed isolated restore or an encrypted offsite backup. The only existing manual snapshot was created October 12, 2026 (expiration extended to October 22); the primary snapshot cadence is empty. Neon free-tier limits prevent creating another snapshot or protecting the recovery branch. Never delete this copy, delete the older snapshot, or swap default branches as a shortcut.
- Prior Vercel runtime error groups included PostgreSQL `42P01` for `GET /api/workforce/attendance-exception-events`. The presence or absence of new logs does not establish live recovery without authenticated synthetic tenant tests.

## Next controlled migration milestones

1. Verify the deployed application's exact effective Neon endpoint/database/role identity through approved private deployment records or a restricted, reviewed server-side read-only diagnostic. Record IDs, not credentials.
2. Produce an independently verified historical adoption packet for all 138 complete paths and SHA-256 hashes; differentiate actual source-executed receipts, demonstrably baseline-included state, truly not-applied source, and partial/unproven changes. Reconcile the 13 duplicate-prefix groups rather than renumber them. **Do not manufacture receipt rows.**
3. Establish an offsite/recoverable backup and rehearse an isolated restore with independently recorded recovery evidence. Do not rely solely on an unprotected copy-on-write branch or a stale snapshot.
4. Under the existing **Production Reviewed SQL Migration (Manual, Protected)** workflow, establish and approve the cutover/journal and execute each required missing forward migration in verified dependency order, with one exact SHA receipt per transaction. Do not enable payouts, payroll release, government filing or live employee processing to clear schema errors.
5. Only when its predecessors are receipted and the approved deployment/restore gates pass, run the exact 0124 candidate via the protected workflow. Independently run `docs/sql/issue-1015-attendance-exception-catalog-preflight.sql` and require **36/36 PASS** on the verified live target.
6. Retest authenticated Owner/HR/Payroll allow/deny and cross-tenant outcomes for `GET /api/workforce/attendance-exception-events`, error/Retry UI behavior, and observed runtime 500 clearance. Attach accepted evidence before closing [#1015](https://github.com/erwinmehehe/payrollph/issues/1015).

## Disposition

**NO-GO for production SQL execution.** The audit narrowed the concrete gaps; it did not change any primary database schema or payroll data. The sole purpose of this proposed source change is a repeatable, safe reconciliation input, not a new production migration path or a bypass of existing release controls.
