#!/usr/bin/env bash
set -euo pipefail
umask 077
# MANUAL, protected, private-data recovery drill. This only restores into
# a temporary OFFLINE Docker PostgreSQL18 on the GitHub-hosted runner.
# It NEVER connects to Neon, publishes a dump, or writes production.
test "${GITHUB_ACTIONS:-}" = true
test "${CI:-}" = true
test "${GITHUB_EVENT_NAME:-}" = workflow_dispatch
test "${GITHUB_REF:-}" = refs/heads/main
if [[ -n "${DATABASE_URL:-}" || -n "${PGHOST:-}" ||
      -n "${MIGRATION_TARGET_DATABASE_URL:-}" ]]; then
  echo "RESTORE_EXTERNAL_DATABASE_ENV_FORBIDDEN" >&2
  exit 2
fi
node scripts/validate-protected-offsite-restore.mjs >/dev/null
for cmd in age aws docker sha256sum; do
  command -v "$cmd" >/dev/null || { echo "RESTORE_MISSING_TOOL" >&2; exit 1; }
done

work="$(mktemp -d)"
container="p04-offline-restore-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
archive="$work/offsite.pgdump.age"
key="$work/identity.txt"

# Read-only OIDC AWS role. Source branch never contacted.
head_sha="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$RESTORE_S3_OBJECT_KEY" --version-id "$RESTORE_S3_VERSION_ID" \
  --query 'Metadata."encrypted-sha256"' --output text)"
head_source="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$RESTORE_S3_OBJECT_KEY" \
  --query 'Metadata."source-commit"' --output text)"
lock_mode="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$RESTORE_S3_OBJECT_KEY" \
  --query ObjectLockMode --output text)"
if [[ "$head_sha" != "$RESTORE_CIPHERTEXT_SHA256" ||
      "$head_source" != "$RESTORE_ARCHIVE_SOURCE_SHA" ||
      "$lock_mode" != COMPLIANCE ]]; then
  echo "RESTORE_ARCHIVE_INTEGRITY_OR_LOCK_MISMATCH" >&2
  exit 1
fi
aws s3api get-object --bucket "$BACKUP_S3_BUCKET" \
  --key "$RESTORE_S3_OBJECT_KEY" --version-id "$RESTORE_S3_VERSION_ID" "$archive" --no-cli-pager >/dev/null
test -s "$archive"
cipher_sha="$(sha256sum "$archive" | cut -d ' ' -f1)"
if [[ "$cipher_sha" != "$RESTORE_CIPHERTEXT_SHA256" ]]; then
  echo "RESTORE_CIPHERTEXT_TAMPERED" >&2; exit 1
fi

# Private age identity exists only in this separate protected restore
# environment. The backup/upload workflow never sees this key.
printf '%s\n' "$RESTORE_AGE_PRIVATE_KEY" > "$key"
chmod 600 "$key"
# Only encrypted ciphertext and the restricted private age identity may be
# staged on the runner. No plaintext dump archive is written to disk.
# No external network OR mounted production volume in the restore target.
start="$(date +%s)"
docker run -d --rm --network none --name "$container" \
  -e POSTGRES_PASSWORD=offline-recovery-ephemeral-only \
  -e POSTGRES_DB=restore_evidence postgres:18 >/dev/null
ready=false
for i in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d restore_evidence >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "RESTORE_EPHEMERAL_POSTGRES_NOT_READY" >&2
  exit 1
fi
# Stream decryption directly to the disconnected PostgreSQL container.
# pipefail and --single-transaction fail closed for wrong keys or truncation.
age -d -i "$key" "$archive" |
  docker exec -i "$container" pg_restore -U postgres -d restore_evidence \
    --no-owner --no-acl --single-transaction --exit-on-error >/dev/null
tables="$(docker exec "$container" psql -XAtq -U postgres -d restore_evidence \
  -v ON_ERROR_STOP=1 -c "SELECT count(*)::int FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')" | tr -d '\r\n')"
if ! [[ "$tables" =~ ^[0-9]+$ ]] || (( tables < 100 )); then
  echo "RESTORE_SCHEMA_TOO_SMALL_OR_INVALID" >&2
  exit 1
fi
duration="$(( $(date +%s) - start ))"

# Aggregate receipt only. Real business rows NEVER appear in logs.
printf '{"kind":"p0-4-offline-encrypted-archive-restore","status":"ephemeral-restore-verified","archiveSourceSha":"%s","encryptedSha256":"%s","s3VersionId":"%s","restoredPublicTables":%s,"restoreSeconds":%s,"restoredToNeon":false,"providerTransfersEnabled":false,"recoveryCertified":false}\n' \
  "$RESTORE_ARCHIVE_SOURCE_SHA" "$cipher_sha" "$RESTORE_S3_VERSION_ID" "$tables" "$duration"
