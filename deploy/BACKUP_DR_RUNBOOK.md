# Backup and Disaster-Recovery Rehearsal — Operator Runbook

**Status: PLAN ONLY; NOT EXECUTED.** No production backup, encrypted archive, restore, database role, external storage, deployment, schedule, app operation, or money movement is performed by this document. The instructions below are conditional on actual owner/DBA/security approval. This runbook does not certify recovery or authorize real-customer go-live.

**Issue pointers checked:** [#907](https://github.com/erwinmehehe/payrollph/issues/907) remains **OPEN and explicitly deferred to PRE-LAUNCH** while the owner confirms no customers and fictional/test records. Its source-only workflows do *not* prove operational recoverability. The owner's earlier **no AWS account / no recurring AWS spend** decision remains recorded; **do not dispatch a funded AWS workflow until the owner changes that decision**. [#899](https://github.com/erwinmehehe/payrollph/issues/899) remains **OPEN** after the October 12, 2026 restore unexpectedly redirected Neon default/production routing. Later nonpromoting tests do not establish the original incident's lost-write/request impact. Both issues are pointers, not permission to act on production.

## 1. Source inventory and strict separation of drills

The named files exist on `main` and must be re-read at the exact reviewed commit before a real operation:

| Verified file | Actual purpose and safety boundary |
| --- | --- |
| `scripts/backup-neon-offsite-encrypted.sh` | **Manually protected real-source backup**: PG18 `pg_dump --format=custom` streams **directly to `age`**; only `.pgdump.age` ciphertext is written, then a versioned immutable S3 object. No plaintext dump file. |
| `scripts/rehearse-encrypted-offsite-backup.sh` | Fictional **isolated CI only**, gated by `CI=true`, `GITHUB_ACTIONS=true`, `DR_OFFSITE_SMOKE=isolated-ci-only` and `PG_CONTAINER`. It tests ciphertext SHA, copied ciphertext, deliberate ciphertext tamper, wrong age key, fresh `--network none` PG18 restore, exact fictional row/value hashes, sequence, and constraints. No real-data recovery certification. |
| `scripts/verify-backup-restore.sh` | Legacy **disposable synthetic CI only**, gated by `DR_REHEARSAL_MODE=isolated-ci-only`, `CI=true` and `PG_CONTAINER`. **It temporarily creates an unencrypted `backup.dump` in a disposable CI directory. Do not invoke it in this protected offsite/production rehearsal, copy its dump pattern, or use it with confidential data.** It is described solely to prevent mistaken reuse. |
| `scripts/verify-protected-offsite-restore.sh` | **Manual protected offline restore**: downloads only version-pinned encrypted S3 object, compares ciphertext SHA and source metadata, decrypts **in a pipe into** a fresh **network-disconnected PG18 Docker** database, records public-table count and restore duration, then destroys the container. It **does not** keep a recovered DB alive for app boot or verify all row/sequence hashes. |
| `scripts/validate-protected-offsite-backup.mjs`; `scripts/validate-protected-offsite-restore.mjs` | Read-only request guards calling `scripts/lib/protected-offsite-backup-policy.mjs` and `scripts/lib/protected-offsite-restore-policy.mjs`; reject unpinned identity, SHA, inputs, environment and actor. |
| `.github/workflows/protected-neon-offsite-backup.yml` | Protected, **manual-only** workflow on exact `main`, backup environment `payrollph-production-backup`. No schedule, no implicit schema operation. |
| `.github/workflows/backup-restore-rehearsal.yml` | Synthetic PG16 test invoking `scripts/verify-backup-restore.sh`. **Not an offsite archive procedure** and not a valid real-data instruction because of its synthetic plaintext dump. |
| `.github/workflows/encrypted-offsite-backup-ci.yml` | Synthetic PG18 contract/integrity test invoking `scripts/rehearse-encrypted-offsite-backup.sh`. Uses fictional data, no AWS/Neon credentials, and uploads JSON evidence **only**. |

**Additional verified integration paths:** `.github/workflows/protected-neon-offsite-restore.yml`, `scripts/sql/protected-neon-backup-source.sql`, `scripts/live-production-readiness.ts`, `scripts/golden-payroll-certification.ts` (`npm run payroll:golden`), `docs/engineering/p0-4-backup-reader-activation-and-zero-aws-handoff.md`, `docs/engineering/p0-4-live-catalog-and-control-gates-20261017.md`, `docs/engineering/p0-4-release-readiness-and-dba-handoff-20261017.md`, `docs/engineering/p0-4-encrypted-offsite-backup-runbook.md`, and `docs/engineering/neon-restore-no-promote-runbook.md`.

**Strict rule:** **NO plaintext backup archive anywhere** in the authorized real-data path: not on the runner, host, removable media, GitHub artifact, S3 object, PR, or log. The approved protected scripts use a `pg_dump | age` or `age -d | pg_restore` **stream**; do not replace either pipe with a file redirect of decrypted bytes. Only ciphertext and metadata receipts may persist. Never bypass environment/credential/fingerprint guards for convenience.

## 2. Preconditions: owner's decisions and audited backup reader

**OWNER DECISION REQUIRED — no purchase or setup authorized by this runbook.** The owner must decide and record (without secrets in an issue): the approved offsite **storage account/provider and custodian**, which jurisdiction/**region**, whether to fund AWS S3/KMS given the currently documented **no-AWS budget decision**, who independently holds/escrows the **age private decryption identity**, custody of a separate recovery copy, **retention** and deletion/legal-hold policy, recovery RPO and RTO objectives, backup/restore cadence, trusted recovery compute, and two named authorized humans (operator and **independent witness**). If no acceptable independent storage exists, mark the real-data rehearsal **BLOCKED**, not passed. Fictional-only local development recovery is separately documented in `docs/engineering/p0-4-zero-cost-local-dev-recovery.md`.

**Role NO-GO until live proof:** `docs/engineering/p0-4-backup-reader-activation-and-zero-aws-handoff.md` describes a **proposed NOLOGIN**, non-elevated, SELECT-only `payrollph_backup_reader` (source proposal `scripts/sql/p0-4-proposed-backup-reader-bootstrap.sql`). **NOLOGIN cannot connect.** Activating LOGIN and a credential requires a separately reviewed DBA/privacy change, in-session least-privilege proof and source-target verification. The 2026-10-17 DBA handoff observed no suitable already-active production backup reader. Do not infer one has been installed or reuse an application owner/superuser. The `scripts/sql/protected-neon-backup-source.sql` guard must report exactly `PINNED_READ_ONLY_SOURCE` using real `neon.project_id`, `neon.branch_id` and `neon.endpoint_id` identity, correct `neondb`, SELECT access to application/auth tables, and denied write/DDL/elevation. Obtain separate sequence scope/negative privilege proof before exporting because the SQL guard is not complete sequence certification.

Require actual classification/export permission for the source rows, a real protected Actions environment (its name alone proves nothing), allowlisted operator, 40-character reviewed `main` SHA, source role and target attestations, private account logging, distinct **OIDC backup and restore IAM roles**, age **public recipient only** on the backup side, age private identity **only** on the independent restore side, and a private evidence store. An existing same-provider Neon snapshot is **not** the independent offsite copy. Approval of source code is not approval to spend, create a production role, or export data.

### Storage and transport contract — *exactly what the current code enforces*

The following is the source-enforced contract from `scripts/backup-neon-offsite-encrypted.sh`, `scripts/validate-protected-offsite-backup.mjs` and `scripts/lib/protected-offsite-backup-policy.mjs`. A different provider/region/retention design is **not supported by the current workflow**; require a separately reviewed change if the owner chooses it.

| Guard | Enforced constraint |
| --- | --- |
| S3 bucket versioning | `aws s3api get-bucket-versioning` must return **`Enabled`**. |
| Bucket Object Lock | `aws s3api get-object-lock-configuration` must return **`Enabled`**. |
| Public-access block | **ALL FOUR** bucket flags must be `True`: `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`. |
| KMS | `aws kms describe-key` returns **`Enabled=True`** for `BACKUP_KMS_KEY_ARN`; each uploaded ciphertext object uses `--server-side-encryption aws:kms` with **that** `--ssekms-key-id`. The current script does not independently prove KMS auto-rotation or CloudTrail coverage. |
| Per-object immutability | PUT with `--object-lock-mode COMPLIANCE` and UTC `--object-lock-retain-until-date` requested at **now + 30 days**. HEAD must confirm `COMPLIANCE` and actual retention **not earlier** than requested. This is a 30-day **requested minimum**, not a verified bucket-default policy. |
| Integrity and version | Uploaded `.pgdump.age` ciphertext is nonempty; local SHA-256 is encoded as the real 32 checksum bytes in Base64 for S3 PUT, while a hex `encrypted-sha256` is stored in metadata. HEAD must match encrypted byte length, stored digest, SSE-KMS key, valid lock retention and **nonempty S3 `VersionId`**. The receipt must preserve `s3VersionId`; key name alone is insufficient. |
| Pinned storage identifiers | `AWS_REGION=us-east-1`; `BACKUP_S3_BUCKET` must match `^(?![0-9.]+$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`; `BACKUP_S3_PREFIX` is `payrollph/immutable-backups` optionally followed by one `/[a-z0-9-]{1,40}` segment; `BACKUP_KMS_KEY_ARN` matches the code's `us-east-1` KMS ARN pattern; `BACKUP_AGE_RECIPIENT` must be a validated `age1...` public recipient. |
| Source and TLS | Repository `erwinmehehe/payrollph` at `refs/heads/main`, exact 40-character reviewed SHA equal to `GITHUB_SHA`, `PGSSLMODE=verify-full`, `PGSSLROOTCERT=system`, `PGPORT=5432`; pinned Neon project `calm-wave-70219564`, branch `br-lucky-sound-b79i56jw`, endpoint `ep-cool-hat-b7e7gpoo`, direct host defined in the policy and database `neondb`. Verify these are **still the intended production identities** before any actual use. |
| Operator and source | Manual `workflow_dispatch` only, GitHub Actions `GITHUB_ACTIONS=true` and `CI=true`, `GITHUB_REF=refs/heads/main`, environment `payrollph-production-backup`, allowed actor from `BACKUP_ALLOWED_ACTORS`, approved `BACKUP_CHANGE_REF` matching `^P0-4-[A-Za-z0-9-]{8,100}$`, confirmation `ENCRYPT_ONLY_NO_RESTORE`. |
| Tools | Protected backup needs **Node.js 22**, Bash, `age`, `aws` CLI, `docker`, `sha256sum`, Docker `postgres:18` with `psql`/`pg_dump`, and a functioning scoped AWS OIDC role. `scripts/backup-neon-offsite-encrypted.sh` itself checks `age`, `aws`, `docker`, `sha256sum`; the workflow provides Node 22 and installs age. |
| Secret/config split | Backup environment variables: `BACKUP_ALLOWED_ACTORS`, `BACKUP_NEON_PROJECT_ID`, `BACKUP_NEON_BRANCH_ID`, `BACKUP_NEON_ENDPOINT_ID`, `BACKUP_PGHOST`, `BACKUP_PGUSER`, `BACKUP_AWS_REGION`, `BACKUP_AWS_ROLE_ARN`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, `BACKUP_KMS_KEY_ARN`, `BACKUP_AGE_RECIPIENT`; protected **secret** `BACKUP_PG_PASSWORD`. The workflow injects `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` and TLS settings. **No database connection string is a workflow input.** |

These checks are necessary, not a complete proof of account security, access logs, lifecycle alerts or legal compliance; obtain those independently.

**Version-binding limitation in current source:** `scripts/backup-neon-offsite-encrypted.sh` discards the S3 PUT response and performs its follow-up `head-object` checks **by key, without `--version-id`**. The reported `s3VersionId` is therefore the version visible to HEAD, not an independently checked PUT response version; a competing write between those operations is not ruled out solely by the script. Before approving a real archive, the operator and independent witness must compare a **version-pinned** S3 HEAD (`--version-id` using the separately retained receipt) with the independent ciphertext digest/size ledger, lock retention and SSE-KMS key, and review write restrictions/audit evidence. The protected restore script checks the pinned version's SHA metadata and Object Lock **mode**, but does **not** itself recheck its retain-until date or SSE-KMS key. Capture/checking the PUT response `VersionId` directly would require a separate, reviewed **code** change; this documentation PR does not implement it.

## 3. Protected encrypted backup — conditional manual dispatch

**HUMAN CONFIRMS BEFORE PROCEEDING.** Backup export reads potentially sensitive records. Proceed **only after** the owner reverses/updates the no-AWS restriction *if AWS is selected*, verifies the distinct external storage and cost/privacy policy, supplies the backup reader and protected environment/roles, and records the separately approved `P0-4-...` change ticket. No actual dispatch is part of this runbook-writing task.

Open GitHub Actions → **P0-4 Protected Neon Encrypted Offsite Backup (Manual Only)** (`.github/workflows/protected-neon-offsite-backup.yml`), select `main`, and use the workflow's **three** actual inputs:

| Input | Approved operator-supplied value |
| --- | --- |
| `reviewed_sha` | Exact currently reviewed **40-hex-character `main` SHA**, matching the triggering `GITHUB_SHA` |
| `change_ref` | Human-approved ticket matching `P0-4-[A-Za-z0-9-]{8,100}` |
| `confirmation` | Literal **`ENCRYPT_ONLY_NO_RESTORE`** from the workflow |

The backup workflow: validates pinned actor/role/source, checks immutable bucket/public access/KMS, runs the in-database SELECT-only role/identity guard, then streams **`pg_dump --format=custom --no-owner --no-acl --serializable-deferrable --lock-wait-timeout=10s` directly through `age -r`** into only an encrypted `.pgdump.age` file. It uploads **ciphertext only** with versioning, Object Lock and SSE-KMS. It cannot, and must not, create a plaintext dump artifact.

**Evidence required:** from the metadata-only JSON output, record `sourceCommit`, `objectKey`, `encryptedBytes`, `encryptedSha256` (64 hex), `objectLockUntil`, and `s3VersionId`. Compare retained offsite HEAD `ContentLength` and `Metadata.encrypted-sha256` and save **the encrypted digest in a separate protected evidence ledger** along with the object version ID/retention and job run ID. The expected receipt status is `encrypted-archived-not-restored`, with `productionRestorePerformed=false` and `recoveryCertified=false`. **Do not label this recovery verified until a separate restore passes.** If the metadata, real source identity, SHA, immutable lock, role, private key custody or policy fails, **STOP** without retrying by relaxing the guard.

## 4. Second-human witnessed restore into an ISOLATED environment

**HUMAN CONFIRMS BEFORE PROCEEDING.** Before starting a real-data restore, record the **full name and independent role of a SECOND HUMAN witness** separate from the operator. That person verifies the approved archive metadata, actual isolated destination and decryption-key custody, personally witnesses the run, and signs the evidence. A solo fictional development drill may be labeled `SOLO_DEV_RESTORE_SMOKE` but **does not meet this independent-witness gate**. A public CI pass is not a witness.

Use the **separate** Actions workflow `.github/workflows/protected-neon-offsite-restore.yml` under `payrollph-production-restore`, with **different read-only AWS role and privately escrowed `RESTORE_AGE_PRIVATE_KEY`**, no database URL and no Neon connection. It requires `workflow_dispatch` on reviewed `main` and these exact inputs:

| Input | Value from human review and the immutable backup receipt |
| --- | --- |
| `reviewed_sha` | 40-character SHA of the reviewed `main` restoration verifier (must match its `GITHUB_SHA`) |
| `archive_source_sha` | Original `sourceCommit` from the backed-up archive, **not necessarily** the verifier commit |
| `object_key` | `objectKey` from the encrypted receipt (not a URL) |
| `object_version_id` | Exact immutable `s3VersionId` |
| `encrypted_sha256` | Original `encryptedSha256` ciphertext digest (64 lowercase hex) |
| `change_ref` | Separate approved `P0-4-...` recovery ticket |
| `confirmation` | Literal **`RESTORE_IN_DISPOSABLE_POSTGRES_ONLY`** from the restore workflow |

The unmodified `scripts/validate-protected-offsite-restore.mjs`/policy refuse unapproved sources, actor, archive path, SHA, S3 version or configuration. The unmodified `scripts/verify-protected-offsite-restore.sh` **rejects `DATABASE_URL`, `PGHOST` and `MIGRATION_TARGET_DATABASE_URL`**, checks S3 `VersionId`/source metadata/Object Lock and locally recomputes ciphertext SHA-256 before decryption. Only ciphertext is stored in its temp directory. Decryption is streamed **`age -d | docker exec ... pg_restore`** into a new `postgres:18` container with `--network none` and **`--single-transaction --exit-on-error`**. No plaintext archive is created, no Neon restore API is called, and no production endpoint is touched.

**Ephemeral key custody limitation:** `scripts/verify-protected-offsite-restore.sh` temporarily writes `RESTORE_AGE_PRIVATE_KEY` to a mode-0600 **plaintext private-key file** on the protected runner and deletes its temporary directory on exit. That is **not** a plaintext payroll backup archive, but it is a sensitive on-runner secret, and file deletion is not a claim of independently attested secure erasure. The owner/security reviewer must approve the ephemeral runner, workflow logs/artifact restrictions, key exposure window, separation of backup/restore environments and post-run credential custody before any real-data drill.

**Minimum script proof, not full parity:** the script currently requires **at least 100 restored public relations** and emits `restoredPublicTables`, `restoreSeconds`, `encryptedSha256`, `archiveSourceSha` and `s3VersionId` with `restoredToNeon=false`, `providerTransfersEnabled=false` and `recoveryCertified=false`. The container is **destroyed on exit**. It does **not** prove source-versus-restored row/sequence hashes, application boot, or overall RPO/RTO. Keep those gates **UNVERIFIED** until completed by an independently approved *additional* isolated harness.

**Additional parity and tamper acceptance:** In a separately approved, access-controlled, **disposable-only** inspection, compare actual restored table and sequence counts, sanitized per-table/sequence digests, FK/constraints and selected aggregate payroll consistency with a trusted, independently retained source receipt. Do not log row-level PII or attach table dumps. For a *tamper test*, alter **only an expendable ciphertext copy** in a fictional isolated harness and prove that the stored trusted SHA check rejects it **before** decryption; never modify the immutable S3 object or the sole recoverable copy. `scripts/rehearse-encrypted-offsite-backup.sh` already performs tampered-copy rejection and wrong-age-key rejection using **fictional data**; its synthetic `qa-artifacts/dr-offsite-synthetic.json` is supplementary evidence, not proof a production archive was witnessed.

## 5. Boot the restored app; run the exact payroll golden suite

**Required rehearsal outcome:** the recovered application must **boot using only the isolated restored PostgreSQL data** and support a synthetic, non-paying test request; then `npm run payroll:golden` must pass. Record the restored DB identity, app-build SHA, response/status, suite result, and elapsed time. Disable external mail, webhooks, real disbursement/payment and scheduled workers; never use real employee or payment operations in the rehearsal.

**Current implementation gap — DO NOT BYPASS:** `scripts/verify-protected-offsite-restore.sh` exits after its database-count check, destroys the `--network none` PG18 container, and has **no application-boot callback or network link**. Thus **the current protected restore workflow alone cannot satisfy the app-boot requirement**. Before any full recovery sign-off, a separate **reviewed, approved isolated test harness** must keep the restored PostgreSQL 18 instance temporarily available to an **application runner sharing only its private, no-egress network namespace**, with **no public DB port, no production volumes, no production secrets/endpoints and no plaintext archive on disk**. Use the *same verified age ciphertext stream* to recover into that harness; do not rewrite or weaken the existing protected restore script or fake a successful app boot. If a safe harness does not exist, mark `APP_BOOT=NOT_TESTED` and `RECOVERY_CERTIFIED=false`.

Only **inside** that separately approved isolated, non-production application runner, after checking its entire environment-variable inventory and restored-only database identity, execute existing npm scripts **verbatim**:

~~~bash
npm ci
npm run build
npm run start
~~~

The operator must demonstrate an authenticated fictional/controlled health or read route reads from the **restored** database (not live Neon) and stop the app after proof. `npm run start` is a foreground server command; run/check/stop it through the approved isolated harness. Execute the existing fixture-based payroll certification in the same isolated source checkout:

~~~bash
npm run payroll:golden
~~~

`npm run payroll:golden` is wired to `scripts/golden-payroll-certification.ts` and tests statutory calculations; **it does not itself prove restored business-row fidelity, DB connectivity, correct routing or money-movement readiness**. Accept the recovery application step only when both actual restored-DB app boot proof **and** the golden suite pass. No production keys are necessary for synthetic test fixtures.

## 6. Post-restore safety checks BEFORE any further operation

**HUMAN CONFIRMS BEFORE PROCEEDING.** The operator and **SECOND HUMAN witness** inspect and sign a redacted manifest **before any additional activity**, including any live readiness call:

- **Connection target:** verify the recovered app/runner points **only** to the isolated database; no external `DATABASE_URL`, `PGHOST`, `MIGRATION_TARGET_DATABASE_URL`, pooler alias, Vercel project, Neon default endpoint, network egress or mounted production volume is reachable. Independently verify the live Vercel app, worker, scheduler and any audit-sealer use their intended **original** production Neon endpoint and branch; never paste credentials.
- **Every deployment environment variable:** compare the **complete names/values-by-protected-attestation**, not selected variables, against a separately approved environment manifest **for each runtime** (app, worker, scheduler, audit-sealer and isolated app runner). Confirm DB hosts/roles, service URLs, environment mode, webhook/mailer/payout flags, bank/PII keys, readiness tokens, backup/IAM roles, storage targets, feature flags and scheduled jobs; fail closed on any unknown, unexpectedly inherited or misdirected value. Do not copy production secrets into the restored-app sandbox or publish their contents.
- **Neon default and endpoint unchanged:** independently re-read current Neon **project ID**, exact original production default branch ID `br-lucky-sound-b79i56jw` named `main`, `default=true` and original endpoint ID `ep-cool-hat-b7e7gpoo` mapped to that branch, plus approved production runtime target. These are **historical pinned expectations, not a substitute for current owner/DBA identity proof**. In particular, **do not invoke a Neon snapshot restore that could default to `finalize:true`, use `target_branch_id` on the original, promote a test branch, or change any alias**. If a separately authorized snapshot rehearsal is ever required, follow `docs/engineering/neon-restore-no-promote-runbook.md` with explicit `finalize:false` and independent postflight; it is **not part of the encrypted offline restore path**. Preserve #899 incident evidence and stop on any routing drift.
- **No re-enablement:** no production schema migrations, payroll/transfer release, provider toggles or environment promotion from backup success. A restore test cannot authorize production actions.

Only once the **original** production deployment and environment variables have been independently re-attested, an authorized operator may run the **read-only HTTP** source check `scripts/live-production-readiness.ts` against the **actual intended production HTTPS origin**, using securely injected `PRODUCTION_BASE_URL`, `PRODUCTION_READINESS_TOKEN`, `EXPECTED_COMMIT_SHA` (40-character **deployed** SHA), and `ROLLOUT_MODE=code`. Its exact repo invocation is:

~~~bash
npx tsx scripts/live-production-readiness.ts
~~~

This command **contacts production** (deployment/readiness and public HTTP GET probes) and writes `qa-artifacts/production-rollout-readiness.json`; **do not invoke it during document authoring or before separate read-only operator approval**. It verifies deployed SHA and code-level readiness, **not** recovery certification or a payroll go-live. Protect/review the local JSON report before retaining it. Any mismatch, failing gate or unexpected live routing means **STOP; consult #899**.

## 7. Evidence form — one completed copy per backup AND witnessed restore

**Do not fill blank fields from guesses or CI synthetic results.** Store only metadata/aggregate proofs in the protected evidence system. All real-data recoverability approvals require two distinct named humans.

| Evidence field | Human-recorded value |
| --- | --- |
| Change record / reviewed `main` commit / actual deployed commit | TODO — exact ticket and 40-character SHAs |
| Owner-approved storage account/provider and region / retention decision | TODO — no account or region chosen here |
| Source database project / branch ID / endpoint ID / DB name / effective SELECT-only role | TODO — private identity attestation, **no** URL |
| UTC backup start/end and last consistent source-data timestamp | TODO — don't invent from archive upload time |
| Protected backup GitHub run ID and approved actor | TODO |
| Encrypted S3 `objectKey` / immutable `s3VersionId` / retention expiry / SSE-KMS ID attestation | TODO — include independent `head-object --version-id` check against protected receipt; script's unpinned post-PUT HEAD is not complete version-binding proof |
| **Backup SHA-256 (`encryptedSha256`)** / encrypted byte count / independent SHA witness | TODO — 64-hex ciphertext digest, never a plaintext hash file |
| Restore workflow run ID / `archiveSourceSha` / `encryptedSha256` comparison | TODO |
| Source and restored **public-table counts**, sequence counts, aggregate row counts | TODO — retain sanitized parity summary; script alone records public tables only |
| Source/restored table, record and sequence digest parity / constraints verified | TODO — private audited proof |
| **Tamper check** (modified expendable ciphertext *copy* rejected before decrypt) / wrong-key check | TODO — mark SYNTHETIC_ONLY if sourced from `encrypted-offsite-backup-ci.yml` |
| Restore network `none` / no plaintext archive / no production connection | TODO — verified by operator **and second human** |
| Restored Next.js app boot/isolated DB route proof / `npm run payroll:golden` status | TODO — mark NOT_TESTED until approved app harness exists |
| **RPO achieved** | TODO — compare incident/recovery point to *last recoverable source-data timestamp*; if unknown, **NOT MEASURED**, not a claimed SLA |
| **RTO achieved** | TODO — measure from **declared incident start** to recovered application usable/verified, including validation; `restoreSeconds` alone is not RTO |
| Postflight full environment-variable manifest reviewed / original default branch & endpoint unchanged | TODO |
| `scripts/live-production-readiness.ts` verified against pinned live SHA | TODO — separately authorized read-only check only |
| **FIRST HUMAN operator full name, role, UTC time and sign-off** | TODO |
| **SECOND HUMAN independent witness full name, role, UTC time and signature** | **MANDATORY FOR REAL RECOVERY ACCEPTANCE — TODO** |
| Final acceptance and caveats | `SOURCE_ONLY` / `SYNTHETIC_ONLY` / `BACKUP_ENCRYPTED_NOT_RESTORED` / `ISOLATED_RESTORE_VERIFIED_APP_PENDING` / `WITNESSED_RECOVERY_VERIFIED` / `NO_GO` — choose only with actual receipts |

**STOP conditions:** No approved data classification/storage/media/key custody, dormant no-AWS budget not revised where needed, missing protected environments, privileged backup reader, missing ciphertext digest or immutable VersionId, missing independently attested **version-pinned** HEAD/lock/KMS proof, wrong SHA/source/role/region, bad tamper proof, source/restore count or digest mismatch, inability to boot against isolated DB, missing golden certification, missing RPO/RTO metrics, missing **SECOND HUMAN witness**, or any #899 default/endpoint deviation. Mark NO-GO; never bypass a guard or fabricate a receipt.

## 8. Cadence recommendation (NOT enabled)

**Recommendation only; owner chooses final RPO/RTO, retention, funding and approvals.** After a genuinely accepted independent storage/restore architecture and explicit authorization: run a **recurring encrypted offsite backup** (propose **daily** initially if a worst-case ~24-hour data-loss window is acceptable, or more frequently if the owner requires a smaller RPO); alert if any expected run/receipt is absent, late, or fails immutable-storage/integrity checks. Hold a **recurring recovery exercise** (propose **quarterly**, plus after material backup/credential/restore changes) with distinct human witness and app-boot test. Always obtain a separate **pre-migration encrypted backup and verified recoverability evidence** before a sensitive production migration or source/endpoint cutover; consider a post-migration checkpoint only after identity/schema/reconciliation and read-only readiness revalidation. Keep the backup's actual code-required **30-day COMPLIANCE** retention until a reviewed policy/source change permits another choice.

The current protected offsite backup and restore workflows have `workflow_dispatch` **only** and contain **no recurring schedule**. The listed cadence is **not installed**, and no workflow, cron, IAM, storage subscription, database grant, tag, deployment, or live backup is changed by this runbook. **Owner must decide** storage **account/provider**, **region** (current protected script is hard-pinned to `us-east-1`), **private encryption-key holder and offline recovery escrow**, **retention** (current script explicitly locks versions for 30 days), spending approval, schedule, objective RPO/RTO and independent witness arrangements **before** any real-data dispatch.
