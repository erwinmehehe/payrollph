# P0-4 protected offsite backup and independent offline restore

**Status: source-only / NOT CONFIGURED / NOT EXECUTED ON PRODUCTION.**

This proposal provides an alternative to relying solely on Neon Free's
six-hour restore history or a single manual snapshot. It does **not**
upgrade a Neon plan, supply an AWS account/bucket, create database accounts,
execute an actual backup, or authorize live schema migrations.

The only historical backup verification on `main` is a **synthetic
PostgreSQL CI drill**. The workflows below are manual, require GitHub
protected environments and separately scoped credentials, and fail closed.

## Identity and confidentiality boundary

The backed-up source is pinned to the owner-confirmed Neon project
`calm-wave-70219564`, production branch
`br-lucky-sound-b79i56jw`, endpoint
`ep-cool-hat-b7e7gpoo`, database `neondb`, direct hostname
`ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech`, PostgreSQL 18.
A wrong source SHA, project, endpoint, host, database, DB role, AWS
region or encryption destination is rejected before backup.

A **dedicated backup-only database reader** needs SELECT on all tables
and sequences in order to dump complete financial and banking records.
It must NOT be superuser, bypass RLS, CREATE a schema/table or INSERT,
UPDATE, DELETE, TRUNCATE or modify triggers. Do not reuse the application's
privileged database URL. The fixed
`scripts/sql/protected-neon-backup-source.sql` tests live Neon
project/branch/endpoint GUCs plus privileges, using metadata only. If
those GUCs are unavailable, the workflow refuses to run.

The archive is encrypted with an offline-custodied age X25519 public
recipient as it streams from `pg_dump`; **no plaintext backup is stored
as a CI file or artifact**. The ciphertext is uploaded to a private AWS
S3 bucket with versioning, Object Lock **COMPLIANCE 30-day retention**
and SSE-KMS. A distinct read-only AWS role and age decryption private
key are used later, in a separate approved restore job. An S3 upload
is not equivalent to a witnessed restore.

## Prerequisites — operator must set up, not ChatGPT

1. Have an authorized administrator create an **independent private,
   access-logged S3 bucket** in `us-east-1` with public access fully
   blocked, versioning and Object Lock ENABLED, a private KMS key, and
   an agreed retention/cost policy. COMPLIANCE mode prevents early
   deletion of uploaded archives, including by administrators; evaluate
   storage cost, legal hold and retention policy BEFORE running.
2. Provision **two separate OIDC IAM roles** constrained to the exact
   `erwinmehehe/payrollph` GitHub environment identities:
   `payrollph-production-backup` for immutable PutObject, bucket
   versioning/Object Lock checks, KMS encrypt/data-key and head-object;
   `payrollph-production-restore` for GetObject/object retention and
   KMS decrypt. Neither role gets broad bucket listing or delete access.
   Use an AWS account trust policy that pins the repository and
   environment `sub`; a branch-only policy is insufficient.
3. Create GitHub environments with explicit operator restrictions and
   required reviewer/approval policies where supported. **Never assume
   an environment is protected just because it has a name.** Branch
   main must be trusted. Keep all workflow files under change control.
4. Generate the **age private key offline**; separately custody and
   test recovery access. Share only its PUBLIC `age1...` recipient
   with the backup environment. The private age key MUST NOT be
   exposed to the backup/upload environment.
5. Create a least-privilege PostgreSQL reader for consistent `pg_dump`
   and verify grant coverage, TLS `verify-full`, project/branch GUCs,
   role identity and table confidentiality with an authorized DBA.
   Review this credential scope because `pg_dump` necessarily
   accesses sensitive payroll and bank records.
6. Configure these non-secret GitHub environment variables under
   `payrollph-production-backup`:
   `BACKUP_NEON_PROJECT_ID`,
   `BACKUP_NEON_BRANCH_ID`, `BACKUP_NEON_ENDPOINT_ID`,
   `BACKUP_PGHOST`, `BACKUP_PGUSER`,
   `BACKUP_AWS_REGION` (= `us-east-1`),
   `BACKUP_AWS_ROLE_ARN`, `BACKUP_ALLOWED_ACTORS` (explicit comma-separated GitHub usernames), `BACKUP_S3_BUCKET`,
   `BACKUP_S3_PREFIX` (e.g. `payrollph/immutable-backups`),
   `BACKUP_KMS_KEY_ARN` and `BACKUP_AGE_RECIPIENT`.
   Its only Neon password secret is `BACKUP_PG_PASSWORD`.
7. In the independent protected
   `payrollph-production-restore` environment, configure
   `BACKUP_S3_BUCKET`, `RESTORE_AWS_ROLE_ARN`, `RESTORE_ALLOWED_ACTORS` and private
   `RESTORE_AGE_PRIVATE_KEY`, plus explicit authorization for
   sensitive data to be processed on a private ephemeral GitHub runner.
   Do not enable this restore job without security/privacy approval.

## Manual process

**Backup:** Dispatch
`.github/workflows/protected-neon-offsite-backup.yml` on exact reviewed
`main` with its 40-character commit SHA, an `P0-4-...` change ticket
and `ENCRYPT_ONLY_NO_RESTORE`. The job refuses unpinned targets and
checks storage immutability/role identity BEFORE calling `pg_dump`.
Only the encrypted S3 object, its SHA-256, size and expiry metadata
remain; no private rows are logged or attached.

**Restore verification:** In a separate authorized session, dispatch
`.github/workflows/protected-neon-offsite-restore.yml` on reviewed main
with the earlier archive source commit, S3 object key, encrypted-object
SHA-256, ticket and the confirmation
`RESTORE_IN_DISPOSABLE_POSTGRES_ONLY`. It downloads ciphertext using
read-only IAM, independently checks metadata and SHA, decrypts using
the separately protected private age key, and streams the decrypted
archive directly into a **network-disconnected, ephemeral PostgreSQL 18
Docker container**. Neither production nor synthetic restore writes a
plaintext pg_dump archive to the CI runner filesystem. The private age
identity and encrypted archive remain temporary restricted files.
It never calls the Neon snapshot or production database APIs, never
opens a production connection, and does not upload restored employee,
payroll or bank records as artifacts.

On success, the restore verifier reports only restored public-table
count and measured local restore duration. This is **still not full
production RPO/RTO certification**: operational recovery requires
witnessed backup intervals, complete source-to-restored data/sequence
hash parity, ongoing scheduled retention tests, independent operator
sign-off and an application-level service continuity drill.

## Existing incident #899 and migration release remain blocked

On Oct 12, a Neon snapshot restore unintentionally redirected the
production endpoint briefly. The original default and endpoint were
restored; a later read-only comparison found **112/112 table data
fingerprints, 112/112 sequence states and catalog digests matching**
between production and the recovered snapshot. The incident has no
observed persistent divergence, but HTTP request/retry effects remain
unverified. Do not mark #899 conclusively closed without operational
request-log evidence.

P0-4 historical receipt adoption is also still unverified; source-only
PRs #865/#867, merged structural-rehearsal #903 and actual isolated
Neon 0050 SQL testing do not constitute receipts that existing
historical files executed. Never create a fake `applied` ledger entry,
replay legacy numbered SQL on main or enable real payout transfers on
the strength of these offsite backup scripts.

**No production backup has been run by this PR. No AWS resources, Neon
database objects, schema migration, or money-transfer settings are changed.**
