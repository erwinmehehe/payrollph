# P0-4 #907 — operator-controlled AWS offsite backup infrastructure

**Status: SOURCE-ONLY CANDIDATE / NOT DEPLOYED / NO BACKUP YET.** This is an optional CloudFormation deployment package for the already-merged manual backup workflow (#906). The template creates infrastructure ONLY when the repository owner, acting as the AWS administrator, explicitly deploys it. A separate hired operations team is not required to run a development-only drill. It does not contain secrets, log employee records, call Neon, or change GitHub environments.

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

**Do not assume these defaults are authenticated.** Before deployment, an authorized GitHub/AWS operator must privately validate the actual OIDC token's `aud` and `sub` through a reviewed, nonsecret diagnostic, and match the exact received subject in the parameter. Never log or store the token. Some older configurations use `repo:erwinmehehe/payrollph:environment:...`, which is accepted as a parameter only after actual token validation. The template does NOT use wildcard trust. Configure each GitHub environment with a main-only branch restriction, separate scoped secrets, and explicit manual workflow dispatch. For a solo operator, required-reviewer rules are optional; do NOT enable **Prevent self-review** when the sole reviewer is also the person dispatching, as the job becomes unapprovable. If your setup cannot supply a separate reviewer, use branch restrictions, exact SHA/change-ticket confirmation, the allowlisted GitHub actor, wait timer where available, and recorded solo-run evidence. Never call this independent approval.

Source: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws


## Solo-developer approval model

This repo is currently in **development with no paying customers**. For an internal P0 recovery rehearsal, there is no need to hire an AWS administrator, DBA or second reviewer simply to satisfy job titles. **One person can perform setup and both workflows**, but not with shared cloud permissions:

1. **Session A — create and verify:** self-review the merged exact SHA; inspect the AWS change set and its costs; configure `payrollph-production-backup` and `payrollph-production-restore` as **different GitHub environments**, restricted to `main`. AWS upload role can write encrypted archives but cannot decrypt; the restore role can read/decrypt but cannot upload or delete. The age private identity is NEVER present in the backup environment.
2. **Session B — run a backup:** manually dispatch only the reviewed backup workflow with the exact SHA, valid `P0-4-` change ticket, and explicit `ENCRYPT_ONLY_NO_RESTORE` string. Preserve metadata-only version, ciphertext digest and lock retention receipts; do not upload raw payroll/PII.
3. **Session C — verify restoration:** in a separate run, manually dispatch offline restore with the other environment/role/age key and `RESTORE_IN_DISPOSABLE_POSTGRES_ONLY`. Use its isolated, networkless Postgres instance. Record separate action logs, source SHA, restored schema/sequence/data fingerprints, results and limitations. A synthetic CI PASS is **not** this live archive recovery drill.
4. **Self-audit and scope:** mark evidence `SOLO_VERIFIED_DEV` or `BLOCKED`, never `INDEPENDENT_APPROVED`. A single successful restore does not certify production recovery RPO/RTO; provider migration, real bank payouts, production go-live and filing acceptance stay independently gated.

**GitHub reviewer setting:** If a required reviewer can be configured as you on this public repository, GitHub allows self-approval only when `Prevent self-review` is disabled. Alternatively, do not use a required-reviewer gate for the solo-development recovery job; retain restricted environment branches, allowlisted actors, exact SHA, manual confirmation inputs and optional wait timer. Never disable or bypass a protection rule silently. See [GitHub deployment environment docs](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Operator authorization before AWS deployment

- [ ] As solo owner, inventory the database's actual data sensitivity and explicitly approve or reject GitHub-hosted ephemeral processing of any genuine employee, payroll and bank information. Prefer fictional test data; do not assume development mode means no sensitive data.
- [ ] As solo AWS account owner, record the selected account, us-east-1 region, estimated S3/KMS charges, and 30-day retention acceptance.
- [ ] Personally acknowledge the 30-day S3 Object Lock **COMPLIANCE** choice: locked object versions cannot be deleted early, including by administrators, and CloudFormation uses `DeletionPolicy=Retain`. Seek legal/compliance advice if real personal information or retention rules warrant it.
- [ ] As AWS administrator, verify the trusted GitHub Actions OIDC provider already exists `https://token.actions.githubusercontent.com` in the correct account, with audience `sts.amazonaws.com`; provide its existing ARN. Do not provision duplicate providers.
- [ ] Verify exact OIDC subjects, separate protected GitHub backup/restore environments, main-only branch rules, and disjoint secret/role permissions. Manual confirmation, actor allowlists and separate runs are required. A second human is OPTIONAL for an internal fictional-data development drill; record **SOLO_OPERATOR**, not **INDEPENDENT_REVIEW**. If you elect self-approval for a required-reviewer rule, leave GitHub's Prevent self-review OFF; do not accidentally configure a deadlock.
- [ ] As AWS account owner, configure/verify CloudTrail control-plane and S3 data-event coverage, alerting, and a private evidence location; the template does not create audit trails.

## Safe local validation (no cloud mutations)

```bash
node --test tests/p0-offsite-aws-template.test.mjs
aws cloudformation validate-template \
  --region us-east-1 \
  --template-body file://infra/p0-offsite-backup/cloudformation.json
```

`validate-template` contacts AWS but does not create resources. Offline node tests are source invariants only, not substitutes for AWS validation, a real archive or a witnessed restore. For a solo-development drill, a documented self-review is acceptable; it must be labeled self-reviewed.

## Reviewed change set, then explicit operator execution

As the solo AWS administrator, choose a **globally unique** name starting `payrollph-backup-` and prepares a reviewed CloudFormation change set for:
`infra/p0-offsite-backup/cloudformation.json`.

Use the actual, verified GitHub OIDC provider ARN and exact subject values, and record how you validated them. **Do not embed AWS keys, Neon passwords, age private keys, employees, or banking data in the template, change-set parameters, GitHub PR or logs.**

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

**Do not copy this command verbatim.** It omits a real account ID, uses a placeholder bucket and relies on the immutable OIDC subject defaults. You must first verify your AWS identity, account, input values and the CloudFormation change set; inspect and approve the resource changes before execution. A stack deployment is NOT part of this PR.

CloudFormation outputs map to protected GitHub environment **nonsecret variables**:
- `BackupBucketName` → `BACKUP_S3_BUCKET` in backup AND restore
- `BackupKmsKeyArn` → `BACKUP_KMS_KEY_ARN` in backup
- `BackupAwsRoleArn` → `BACKUP_AWS_ROLE_ARN` in backup
- `RestoreAwsRoleArn` → `RESTORE_AWS_ROLE_ARN` in restore

Also configure the remaining nonsecret fields exactly as specified by `docs/engineering/p0-4-encrypted-offsite-backup-runbook.md`: `BACKUP_S3_PREFIX=payrollph/immutable-backups`, pinned Neon IDs, direct PG host, DB user, region, explicit allowed actors, and the offline-generated age PUBLIC recipient. Keep `BACKUP_PG_PASSWORD` only in the backup environment and `RESTORE_AGE_PRIVATE_KEY` only in the separately approved restore environment. Use the smallest supported scopes. Never place age decryption keys in the upload environment.

As the solo Neon administrator, create and verify a **separate** least-privilege backup-only Postgres role against the exact intended database; independently exercise automated negative privilege assertions for every required schema/table/sequence. Distinct credentials and verified permissions matter even when there is only one human. **Do not reuse the application DB owner; do not try to apply source migration SQL to production.**

## Solo-developer execution and evidence sequence — remains NOT_RUN until actually performed

1. **Infrastructure attest:** record privately stack ID, account/region, nonpublic bucket, object-lock 30-day compliance, versioning, KMS enabled/key rotation, actual OIDC subject matching, upload/restore IAM grant simulation, environmental approval rules and audit logging evidence.
2. **Manual encrypted backup:** you dispatch the merged backup workflow on reviewed `main` with its exact 40-char SHA, `P0-4-...` reference and confirmation `ENCRYPT_ONLY_NO_RESTORE`. Before contacting Neon data rows, the workflow checks target identity, restricted DB role, S3 immutable controls and KMS. Record ONLY the versioned encrypted S3 object key, checksum, byte size, retention expiry, immutable version ID, UTC timestamp and a private evidence reference labeled `SOLO_OPERATOR`.
3. **Separate restore identity and session:** as the same human operator, end the backup session, recheck its evidence, and separately dispatch the merged offline restore workflow with verified exact source SHA, S3 object key/version ID/ciphertext digest and `RESTORE_IN_DISPOSABLE_POSTGRES_ONLY`. The verifier decrypts within an ephemeral networkless PostgreSQL 18 runner. **No production default/endpoint swap, snapshot restore or payroll transfer.**
4. **Parity and recovery verification:** you verify schema, sequences, and data/constraint fidelity using reproducible checks without disclosing private rows; repeat from an isolated restore identity. A second human would strengthen assurance but is not required for fictional-data internal development. Compare restored hashes/counts, perform a separately authorized application continuity drill and record observed RPO/RTO. The merged restore script's public-table count alone is not enough to certify complete recovery.
5. **Operational acceptance:** after the real archive and separately run offline restore pass, record a `SOLO_VERIFIED_DEV_RECOVERY` receipt (operator, commit SHA, object version/digest, restore hash comparisons, observed durations and limitations). Do not call this `INDEPENDENTLY_VERIFIED` or production recovery certified. #907 stays open until the agreed environment-specific acceptance criteria are demonstrably met. A real-customer launch may warrant independent review, depending on privacy/compliance risk. Keep #899, #908, #735 and #579 independently blocked.

## Safety / limits

This infrastructure does not verify GitHub environment access settings, create the GitHub environments, provide an AWS account, execute CloudFormation, create a Neon backup DB role, run a backup or restore, prove RPO/RTO, or authorize payroll or bank releases. CloudFormation is opt-in only and is designed to fail without the independently provided AWS/OIDC/secret configuration.

**Decision: source implementation GO; live infrastructure deployment and backup/restore remain OPERATOR-GATED and NO-GO until the above evidence exists.**
