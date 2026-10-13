# PayrollPH P0-4 — actual offsite backup and isolated restore bootstrap

**Status: source committed to draft PR #906; NOT applied to AWS; no production archive or independent restore has been executed.**

This is infrastructure as code for issue #907. It is intentionally **never applied in CI**. The validation workflow checks Terraform syntax only and has no AWS credentials. Apply using an explicitly authorized AWS account after confirming financial/employee-data residency, costs, access and retention.

## Safety model

- The S3 bucket is private, uses versioning, Block Public Access, AWS KMS, and 30-day **COMPLIANCE Object Lock** (cannot remove protected versions early, even as administrator).
- A dedicated GitHub OIDC role may upload only into `payrollph/immutable-backups/`. Its KMS permissions do NOT include decrypt.
- An entirely separate role may download pinned, immutable encrypted S3 versions and decrypt their SSE-KMS layer. It cannot upload, overwrite or delete.
- The inner archive is age-encrypted **before S3 upload** using only its PUBLIC recipient. The age private identity belongs exclusively to the protected restore environment.
- Restore job decrypts into an ephemeral Docker PostgreSQL 18 container with **`--network none`**. No restored data, keys or raw pg_dump archive are stored as GitHub Actions artifacts.
- The database source is pinned to Neon project `calm-wave-70219564`, main branch `br-lucky-sound-b79i56jw`, endpoint `ep-cool-hat-b7e7gpoo`, `neondb`; no pooled DB connection allowed.

## Operator deployment — only on an AWS-authorized workstation

1. Install `terraform`, `aws`, `gh`, `psql`, `age` and their dependencies; authenticate **locally**. Never expose secrets to chat, git commits or PR comments.
2. Confirm intended AWS account/region and compliance retention. If GitHub OIDC provider already exists in AWS, pass it as `-var github_oidc_provider_arn=arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com`. Otherwise Terraform creates it. Store state in a protected encrypted, access-controlled Terraform backend; `*.tfstate` is gitignored.
3. From this directory: `terraform init`, `terraform validate`, `terraform plan -out=approved.tfplan`. Have authorized operators review S3 COMPLIANCE immutability and IAM policy. **Then** `terraform apply approved.tfplan`. This creates costs and irreversible retention commitments for subsequently uploaded objects.
4. Provision a dedicated Neon reader from the **direct admin URL** using `ADMIN_DIRECT_DATABASE_URL` and a newly generated `BACKUP_PG_PASSWORD`: `bash create-neon-backup-reader.sh`. It fails on existing roles and verifies no DDL/DML rights plus SELECT coverage. Verify `pg_dump`, row-level-security, TLS `verify-full`, and sequence access independently before archiving. The production database is never changed by Terraform alone.
5. Configure GitHub environments `payrollph-production-backup` and `payrollph-production-restore`, both restricted to **only main** and requiring operator approval. Protect their secrets and ensure approval restrictions are real rather than inferred from names.
6. Generate an **age identity offline** and escrow the private key. Export only `BACKUP_AGE_RECIPIENT` (age public recipient), `BACKUP_ALLOWED_ACTORS`, and `RESTORE_ALLOWED_ACTORS` as nonsecret variables on the operator machine. Run `bash configure-github-env-vars.sh` from here; this script refuses unrestricted environments and sets only NONSECRET vars from Terraform outputs.
7. Install protected GitHub secrets manually: `BACKUP_PG_PASSWORD` in **backup** environment only, and `RESTORE_AGE_PRIVATE_KEY` in **restore** environment only. Do not share or duplicate the age private identity into backup.
8. Merge the reviewed P0-4 source PR #906 into trusted `main` through normal protected release controls. Its two workflows have `workflow_dispatch` only; nothing auto-backs up or restores.
9. With a real approved `P0-4-...` change reference, run `CHANGE_REF=P0-4-APPROVED-... bash dispatch-backup.sh`. Verify the resulting GitHub Actions **success** and metadata-only receipt containing S3 key, immutable VersionId, ciphertext SHA-256, bytes, source SHA, KMS ARN/retention and observed source branch. No receipts should contain PII.
10. With **a separate** approval, provide `CHANGE_REF`, `ARCHIVE_SOURCE_SHA`, `ARCHIVE_OBJECT_KEY`, `ARCHIVE_S3_VERSION_ID`, and `ARCHIVE_CIPHERTEXT_SHA256` from that actual receipt to `bash dispatch-restore.sh`. The script submits only the isolated, offline restore workflow. Confirm restored object/version/checksum, tables, constraints, row counts and sequence parity, and measured elapsed time before marking #907 accepted.

## Hard stops

- If Terraform IAM/account/retention verification fails, **do not apply**.
- If the production source reader is elevated, missing SELECT on any required table, or blocked by RLS, **do not archive**.
- If immutable S3 version+checksum+SSE-KMS+retention cannot be confirmed, **do not restore**.
- If the restore run is not isolated or doesn't match original row/sequence/constraint counts, **do not certify**.
- Neon snapshots and a synthetic CI encryption drill are **not** substitutes for this independent AWS offsite recovery evidence.
- Backup completion is not authorization for production migration #910, release/payout #813, WFM acceptance #691 or moving money.
