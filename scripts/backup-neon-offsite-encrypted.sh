#!/usr/bin/env bash
set -euo pipefail
umask 077
# Manual, protected workflow only. NOT a restore operation, migration, or
# payroll release. The archive is age-encrypted BEFORE leaving the runner.
# Never enable shell tracing: credentials and business data must not enter CI logs.
test "${GITHUB_ACTIONS:-}" = true
test "${CI:-}" = true
test "${GITHUB_EVENT_NAME:-}" = workflow_dispatch
test "${GITHUB_REF:-}" = refs/heads/main
test "${PGSSLMODE:-}" = verify-full
test "${PGSSLROOTCERT:-}" = system
node scripts/validate-protected-offsite-backup.mjs >/dev/null

for cmd in age aws docker sha256sum; do
  command -v "$cmd" >/dev/null || { echo "BACKUP_MISSING_LOCAL_TOOL" >&2; exit 1; }
done

# Require versioning, Object Lock and KMS before reading Neon.
versioning="$(aws s3api get-bucket-versioning --bucket "$BACKUP_S3_BUCKET" --query Status --output text)"
object_lock="$(aws s3api get-object-lock-configuration --bucket "$BACKUP_S3_BUCKET" \
  --query ObjectLockConfiguration.ObjectLockEnabled --output text)"
if [[ "$versioning" != Enabled || "$object_lock" != Enabled ]]; then
  echo "BACKUP_IMMUTABLE_BUCKET_REQUIRED" >&2
  exit 1
fi
aws kms describe-key --key-id "$BACKUP_KMS_KEY_ARN" \
  --query KeyMetadata.Enabled --output text | grep -qx True ||
    { echo "BACKUP_KMS_KEY_NOT_ENABLED" >&2; exit 1; }

# SELECT-only backup role with NO SQL write or DDL powers. Verify original
# project/branch/endpoint identity from the database session, not just DNS.
read_only_identity="$(docker run --rm --network host \
  -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  -e PGSSLMODE -e PGSSLROOTCERT \
  -v "${PWD}/scripts/sql/protected-neon-backup-source.sql:/guard.sql:ro" \
  postgres:18 psql -XAtq -v ON_ERROR_STOP=1 -f /guard.sql | tr -d '\r\n')"
if [[ "$read_only_identity" != PINNED_READ_ONLY_SOURCE ]]; then
  echo "BACKUP_SOURCE_ROLE_OR_BRANCH_UNVERIFIED" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="$work/offsite.pgdump.age"
object_key="$BACKUP_S3_PREFIX/backup-run-$GITHUB_RUN_ID-attempt-$GITHUB_RUN_ATTEMPT-${GITHUB_SHA:0:12}.pgdump.age"

# pg_dump writes only to stdout, directly age-encrypted. No plaintext dump
# file is created locally or uploaded to GitHub artifacts.
docker run --rm --network host \
  -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  -e PGSSLMODE -e PGSSLROOTCERT \
  postgres:18 pg_dump --format=custom --no-owner --no-acl \
    --serializable-deferrable --lock-wait-timeout=10s \
  | age -r "$BACKUP_AGE_RECIPIENT" > "$archive"

test -s "$archive" || { echo "BACKUP_EMPTY_ENCRYPTED_ARCHIVE" >&2; exit 1; }
encrypted_size="$(stat -c %s "$archive")"
encrypted_sha="$(sha256sum "$archive" | cut -d ' ' -f1)"
retention_until="$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)"

# S3 Object Lock COMPLIANCE + SSE-KMS protects the outer age ciphertext.
aws s3api put-object \
  --bucket "$BACKUP_S3_BUCKET" --key "$object_key" \
  --body "$archive" \
  --server-side-encryption aws:kms \
  --ssekms-key-id "$BACKUP_KMS_KEY_ARN" \
  --object-lock-mode COMPLIANCE \
  --object-lock-retain-until-date "$retention_until" \
  --metadata "encrypted-sha256=$encrypted_sha,source-commit=$GITHUB_SHA" \
  --no-cli-pager >/dev/null

saved_size="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query ContentLength --output text)"
saved_sha="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query 'Metadata."encrypted-sha256"' --output text)"
# Verify the actual immutable stored version, not only the requested PUT options.
# A key can have several immutable versions; the restore must pin VersionId.
saved_version="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query VersionId --output text)"
saved_lock="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query ObjectLockMode --output text)"
saved_retention="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query ObjectLockRetainUntilDate --output text)"
saved_encryption="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query ServerSideEncryption --output text)"
saved_kms="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$object_key" --query SSEKMSKeyId --output text)"
if [[ -z "$saved_version" || "$saved_version" == None || "$saved_version" == null ||
      "$saved_lock" != COMPLIANCE || "$saved_encryption" != aws:kms ||
      "$saved_kms" != "$BACKUP_KMS_KEY_ARN" ||
      "$saved_retention" == None || "$saved_retention" == null ]]; then
  echo "BACKUP_STORED_OBJECT_CONTROLS_NOT_VERIFIED" >&2
  exit 1
fi
stored_until="$(date -u -d "$saved_retention" +%s)" ||
  { echo "BACKUP_RETAIN_UNTIL_INVALID" >&2; exit 1; }
requested_until="$(date -u -d "$retention_until" +%s)"
if (( stored_until < requested_until )); then
  echo "BACKUP_RETENTION_SHORTER_THAN_REQUESTED" >&2
  exit 1
fi

if [[ "$saved_size" != "$encrypted_size" || "$saved_sha" != "$encrypted_sha" ]]; then
  echo "BACKUP_UPLOADED_OBJECT_VERIFICATION_FAILED" >&2
  exit 1
fi

# Metadata-only receipt; no database contents, decrypted artifacts or keys.
printf '{"kind":"p0-4-encrypted-offsite-backup","status":"encrypted-archived-not-restored","sourceCommit":"%s","objectKey":"%s","encryptedBytes":%s,"encryptedSha256":"%s","objectLockUntil":"%s","s3VersionId":"%s","productionRestorePerformed":false,"recoveryCertified":false}\n' \
  "$GITHUB_SHA" "$object_key" "$encrypted_size" "$encrypted_sha" "$retention_until" "$saved_version"
