# PR #1116 — Preview isolation and DBA handoff (2026-10-16)

> **DRAFT / NO-GO. Inert Preview database/auth endpoints plus separate branch-only encryption keys.** No production or active QA database changes, releases, payroll payments or statutory filings are authorized.

## New checkpoint — PR branch sync and Preview-only crypto (2026-10-16)

**Step 1 — merged `main` into the DRAFT PR review branch only.** An explicit two-parent merge commit `b3b4fb0a8ae3dd1ca8641a6a3b83d7b2563bce7d` combines prior PR review head `f7bea597a54cea68314090e42ee6107c06c1c8c7` with then-current main `6a2c31fc08601f7f48b4ecda795bbdc3e5c64dc2`. Its tree retains the exact eight `docs/`-only review files on main's source tree. This **did not merge PR #1116 into `main`**. Main advances independently; compare PR ancestry again before any next release decision. CI results must be checked against the *final* head, never prior heads.

**Step 2 — added four independently generated, branch-scoped sensitive crypto/auth keys.** Following read-only identity attestation on the existing isolated rehearsal Neon branch `br-mute-mode-b740q5zx`, generated independent 32-byte hex-formatted keys using SHA-256 over multiple PostgreSQL cryptographic UUID sources, then sent them directly to Vercel through the connected secret-management action. No key material was printed in this report or returned in chat. Vercel confirmed four **`sensitive` Preview-only** records scoped exclusively to `qa/issue1113-schema-recovery-review-20261016`:

- `TOTP_ENCRYPTION_KEY` — preview-local authentication encryption source.
- `PII_ENCRYPTION_KEY` — separately generated sensitive-identifier encryption key.
- `BANK_DATA_ENCRYPTION_KEY` — separately generated bank-field encryption key.
- `ENTERPRISE_IDENTITY_ENCRYPTION_KEY` — separately generated enterprise identity-secret key.

Read-only branch-scoped Vercel metadata then returned **26/26** assignments, all with `target: [preview]` and the exact PR Git branch: **18 database/authentication aliases deliberately inert** (including both `DATABASE_URL` values), **4 workload/payment/demo switches set to `false`**, and **4 dedicated `sensitive` crypto/auth keys**. This confirms their *assignment scopes* only, not live secret validity, ciphertext migration compatibility or effective production isolation. Fresh keys cannot be assumed to decrypt inherited legacy ciphertext; any such records require separately approved provenance and key-custody validation. No real Neon credentials were provisioned.

**Vercel access gate:** The checked-in `vercel.json` continues to block automatic non-main Git deployments (`preview: false`, `staging: false`, `**: false`); the Vercel project currently reports SSO protection enabled for non-custom deployments. There were zero PR-branch deployments and zero project connector connections at inspection. No signed-in application or database Preview test has been performed.

**Outstanding project-wide blocker:** The unfiltered Vercel environment inventory contains trailing truncated records, so **global assignment completeness and freedom from Production-shared variables are NOT certified**. The existing project-wide dual-target assignments must be independently audited/removed from Preview by an authorized Vercel administrator without disturbing Production, and an approved, branch-bound Neon/auth integration must replace inert URLs. The [Preview target isolation guard](../../scripts/verify-preview-isolation.mjs) is stricter than branch-only overrides: it fails if *any* variable targets both Preview and Production. Do not claim its success without an untruncated full inventory and a credential-protected manual `workflow_dispatch` run.

**Gate:** source review and Preview-only secret scoping progressed; actual Preview connectivity, broad global isolation, DB/DBA acceptance, historical receipts, payroll release and PR merge remain **NO-GO**. No existing Neon branch was migrated or modified by these configuration steps.

## Actions performed

- Identified Vercel project `erwinmehehe-payrollph` (`prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh`) belonging to team `team_5oyNk06BhdkUCcPJLzHPRpvK`.
- The PR branch `qa/issue1113-schema-recovery-review-20261016` previously had two deliberately nonworking encrypted Preview overrides: `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
- Added **20 more encrypted Preview overrides scoped exclusively to this Git branch**. Sixteen quarantine other database and authentication aliases (`POSTGRES_URL_NON_POOLING`, `POSTGRES_HOST`, `POSTGRES_URL`, `POSTGRES_DATABASE`, `PGDATABASE`, `PGPASSWORD`, `POSTGRES_USER`, `NEON_PROJECT_ID`, `PGHOST`, `VITE_NEON_AUTH_URL`, `POSTGRES_PASSWORD`, `POSTGRES_URL_NO_SSL`, `PGHOST_UNPOOLED`, `PGUSER`, `POSTGRES_PRISMA_URL`, `NEON_AUTH_BASE_URL`). Each new override is deliberately **inert**, not a real credential.
- Four branch-scoped release/workload overrides are explicitly `false`: `WORKER_ENABLED`, `CENTRAL_SCHEDULER_ENABLED`, `PAYMONGO_DISBURSEMENTS_ENABLED`, `DEMO_MODE`.
- This leaves **22 branch-scoped overrides** in total. Global shared Preview+Production variables were not edited or deleted.
- Read-only Vercel project connector inspection returned **zero configured project connector connections**. No working branch-specific Neon connection has been provisioned.
- The PR branch deployment query returned **zero deployments** at inspection. No deployed signed-in app request or runtime branch attestation can be claimed.
- Important metadata caveat: Vercel's unfiltered environment-list response truncates some trailing entries, so a **complete post-change global assignment audit has not passed**. Do not equate newly added overrides with verified total environment isolation.

## Neon identity and migration journals — independently observed, read only

Project `calm-wave-70219564`, database `neondb`:

| Branch | Identity | Public tables | Cutover or execution journal |
| --- | --- | ---: | --- |
| Original | `br-lucky-sound-b79i56jw` | 136 | Absent |
| Rehearsal | `br-mute-mode-b740q5zx` | 148 | Absent |

The catalog checked `payrollph_migration_cutover`, `payrollph_schema_migrations` and `__drizzle_migrations`; **none was found** on either target. This does not prove a historical migration was or was not applied. It proves the required adopted journal cannot currently be validated there.

## Historical source reconciliation

Pinned GitHub tree at `6f3b7b985a3fb16712aedad68fdde052a357e78a` contained **142 SQL files total under `drizzle/`: 141 numbered files and the distinct unnumbered `baseline.sql`**. A prior PR description informally called all 142 “archived SQL files”; that is not the count of *numbered* files. There are **13 duplicate numeric-prefix groups**; the highest prefix observed is `0127`.

The source's `scripts/lib/migration-receipt-audit.mjs` canonicalizes the *numbered* files by full path and exact-byte SHA-256. For an independently reproducible, authoritative manifest, execute on an exact pinned, trusted local checkout:

```bash
node scripts/audit-production-migration-receipts.mjs --inventory
node scripts/run-reviewed-migration.mjs --manifest --through 0127
```

Both are source-only inspection paths. Do not generate or import receipt dispositions from inventory alone; `baseline.sql` and historical `db:push` require separate inspection. Do not replay `drizzle/` sequentially or create new migrations based solely on absence of objects.

## Required next actions, still blocked

1. Independently confirm the exact Vercel project, connection association and every inherited Preview+Production variable without truncation. Never expose secret values; replace only the PR-specific inert overrides with securely managed credentials for **rehearsal branch `br-mute-mode-b740q5zx`**, after independent authorization.
2. Configure branch-scoped Preview auth, encryption and internal endpoint protections with synthetic-only test identities. Keep background work, payments, external notifications and government filing effects disabled. Do not deploy with inherited Production credentials.
3. Once branch identity is attested using an authenticated, protected Preview health check, run GET-only application acceptance before separately approved fictional write-path tests.
4. DBA independently reviews all numbered historical source receipts, unnumbered baseline provenance and complete current schema/catalog parity; supplies signed change and restore evidence before adoption of a forward-only cutover.
5. Complete demo payroll seed repair (#1102), centavo-per-employee reconciliation, WFM 14-scenario independent acceptance, filing-format acceptance and review/security release gates.

**Decision: PR remains DRAFT / NO-GO; no production merge, migration, payroll disbursement or statutory filing.**
