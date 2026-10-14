# P0-4 #907 — operator-controlled AWS offsite backup infrastructure

**Status: SOURCE-ONLY CANDIDATE / NOT DEPLOYED / NO BACKUP YET.** This is an optional CloudFormation deployment package for the already-merged manual backup workflow (#906). The template creates infrastructure ONLY if an authorized AWS administrator explicitly deploys it. It does not contain secrets, log employee records, call Neon, or change GitHub environments.

## Why this is needed

The verified Neon default branch `br-lucky-sound-b79i56jw` is currently unprotected and the only visible manual snapshot expires 2026-10-19. There is no independently verified, durable encrypted offsite archive. A snapshot is NOT a tested offsite backup.

Already merged on `main`:
- `.github/workflows/protected-neon-offsite-backup.yml`
- `.github/workflows/protected-neon-offsite-restore.yml`
- `scripts/backup-neon-offsite-encrypted.sh`
- `scripts/verify-protected-offsite-restore.sh`
- `docs/engineering/p0-4-encrypted-offsite-backup-runbook.md`

The new `infra/p0-offsite-backup/cloudformation.json` creates **an isolated S3 bucket**, a retained **KMS customer key**, a write-only-purpose **encrypted upload role**, and an independently scoped **restore read/decrypt role**. The upload role has limited S3 GetObject/HeadObject permission for receipt verification but has **no KMS Decrypt**. Neither role has object deletion or bucket-policy editing permissions.

## Critical trust-policy detail: September 2026 GitHub repository

The connected repository was created on 2026-09-27, with owner ID `20321511` and repo ID `1389899403`. GitHub's current OIDC guidance says repositories created after 2026-07-15 use immutable owner/repository ID subjects. Therefore the stack's exact-match OIDC subject defaults are:

- Backup: `repo:erwinmehehe@20321511/payrollph@1389899403:environment:payrollph-production-backup`
- Restore: `repo:erwinmehehe@20321511/payrollph@1389899403:environment:payrollph-production-restore`

**Do not assume these defaults are authenticated.** Before deployment, an authorized GitHub/AWS operator must privately validate the actual OIDC token's `aud` and `sub` through a reviewed, nonsecret diagnostic, and match the exact received subject in the parameter. Never log or store the token. Some older configurations use `repo:erwinmehehe/payrollph:environment:...`, which is accepted as a parameter only after actual token validation. The template does NOT use wildcard trust. GitHub environments MUST independently restrict deployment to main and require appropriate human reviewers.

Source: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

## Operator authorization before AWS deployment

- [ ] Security/privacy officer approves a GitHub-hosted ephemeral runner handling a copy of real employee, payroll and banking information for upload and later recovery.
- [ ] AWS account, dedicated us-east-1 region, expected archive volume, estimated S3/KMS charges and 30-day retention are approved.
- [ ] Legal/data-retention owner signs off on S3 Object Lock **COMPLIANCE**: it cannot be disabled and locked objects cannot be deleted early, including by administrators. CloudFormation uses `DeletionPolicy=Retain`.
- [ ] An AWS administrator has already installed the trusted GitHub Actions OIDC provider `https://token.actions.githubusercontent.com` in the correct account, with audience `sts.amazonaws.com`; provide its existing ARN. Do not provision duplicate providers.
- [ ] Confirm exact OIDC subject(s), protected GitHub environments, main-only branch rules, required human reviewers and two-person restore approval. Environment names alone are NOT controls.
- [ ] AWS audit owner confirms CloudTrail control-plane and S3 data-event coverage, alerts and a private evidence vault; the template does not claim to configure logging trails.

## Safe local validation (no cloud mutations)

```bash
node --test tests/p0-offsite-aws-template.test.mjs
aws cloudformation validate-template \
  --region us-east-1 \
  --template-body file://infra/p0-offsite-backup/cloudformation.json
```

`validate-template` contacts AWS but does not create resources. Offline node tests are source invariants only, not substitute for AWS validation or security review.

## Reviewed change set, then explicit operator execution

A cloud administrator chooses a **globally unique** name starting `payrollph-backup-` and prepares a reviewed CloudFormation change set for:
`infra/p0-offsite-backup/cloudformation.json`.

Use the actual, separately verified GitHub OIDC provider ARN and approved exact subject values. **Do not embed AWS keys, Neon passwords, age private keys, employees, or banking data in the template, change-set parameters, GitHub PR or logs.**

Example operator-only command (after written approvals):

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name payrollph-p0-immutable-backup \
  --capabilities CAPABILITY_IAM \
  --template-file infra/p0-offsite-backup/cloudformation.json \
  --parameter-overrides \
    BackupBucketName=payrollph-backup-REPLACE-WITH-UNIQUE-ID \
    GitHubOidcProviderArn=arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
```

**Do not copy this command verbatim.** It omits a real account ID, uses a placeholder bucket and relies on the immutable OIDC subject defaults. The operator must first verify their identity, account, input values and CloudFormation change set and explicitly approve execution. A stack deployment is NOT part of this PR.

CloudFormation outputs map to protected GitHub environment **nonsecret variables**:
- `BackupBucketName` → `BACKUP_S3_BUCKET` in backup AND restore
- `BackupKmsKeyArn` → `BACKUP_KMS_KEY_ARN` in backup
- `BackupAwsRoleArn` → `BACKUP_AWS_ROLE_ARN` in backup
- `RestoreAwsRoleArn` → `RESTORE_AWS_ROLE_ARN` in restore

Also configure the remaining nonsecret fields exactly as specified by `docs/engineering/p0-4-encrypted-offsite-backup-runbook.md`: `BACKUP_S3_PREFIX=payrollph/immutable-backups`, pinned Neon IDs, direct PG host, DB user, region, explicit allowed actors, and the offline-generated age PUBLIC recipient. Keep `BACKUP_PG_PASSWORD` only in the backup environment and `RESTORE_AGE_PRIVATE_KEY` only in the separately approved restore environment. Use the smallest supported scopes. Never place age decryption keys in the upload environment.

An independent DBA must create/prove a least-privilege backup-only Neon Postgres role and cover every required schema/table/sequence without write, DDL or bypass-RLS rights. **Do not reuse the application DB owner; do not try to apply source migration SQL to production.**

## Independent evidence sequence — remains NOT_RUN until witnessed

1. **Infrastructure attest:** authorized admin privately records stack ID, account/region, nonpublic bucket, object-lock 30-day compliance, versioning, KMS enabled/key rotation, actual OIDC subject matching, upload/restore IAM grant simulation, environmental approval rules and audit logging evidence.
2. **Manual encrypted backup:** approved operator dispatches the merged backup workflow on reviewed `main` with its exact 40-char SHA, `P0-4-...` reference and confirmation `ENCRYPT_ONLY_NO_RESTORE`. Before contacting Neon data rows, the workflow checks target identity, restricted DB role, S3 immutable controls and KMS. Record ONLY the versioned encrypted S3 object key, checksum, byte size, retention expiry, immutable version ID, UTC timestamp and private reviewer reference.
3. **Different approved reviewer and restore identity:** separately dispatch the merged offline restore workflow with verified exact source SHA, S3 object key/version ID/ciphertext digest and `RESTORE_IN_DISPOSABLE_POSTGRES_ONLY`. The verifier decrypts within an ephemeral networkless PostgreSQL 18 runner. **No production default/endpoint swap, snapshot restore or payroll transfer.**
4. **Parity and recovery sign-off:** independent DBA/security operators verify schema, sequences, data/constraint fidelity without disclosing private rows. Compare restored hashes/counts, perform a separately authorized application continuity drill and record observed RPO/RTO. The merged restore script's public-table count alone is not enough to certify complete recovery.
5. **Operational acceptance:** only after a successful witnessed drill can a cadence, alert policy, backup capacity controls and periodic re-tests be proposed. Keep #907 open until private backup+restore evidence and signed acceptance exist. Keep #899, #908, #735 and #579 independently blocked.

## Safety / limits

This infrastructure does not verify GitHub environment reviewer settings, create the GitHub environments, provide an AWS account, execute CloudFormation, create a Neon backup DB role, run a backup or restore, prove RPO/RTO, or authorize payroll or bank releases. CloudFormation is opt-in only and is designed to fail without the independently provided AWS/OIDC/secret configuration.

**Decision: source implementation GO; live infrastructure deployment and backup/restore remain OPERATOR-GATED and NO-GO until the above evidence exists.**
