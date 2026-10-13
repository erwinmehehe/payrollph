#!/usr/bin/env bash
# Explicitly independent operator action after a successful encrypted archive.
set -euo pipefail
: "${CHANGE_REF:?A separate approved P0-4 restore change is required}"
: "${ARCHIVE_SOURCE_SHA:?Exact SHA from backup receipt required}"
: "${ARCHIVE_OBJECT_KEY:?Encrypted S3 object key from receipt required}"
: "${ARCHIVE_S3_VERSION_ID:?Immutable S3 version from receipt required}"
: "${ARCHIVE_CIPHERTEXT_SHA256:?Verified ciphertext SHA256 required}"
[[ "$CHANGE_REF" =~ ^P0-4-[A-Za-z0-9-]{8,100}$ ]] || exit 2
[[ "$ARCHIVE_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$ARCHIVE_CIPHERTEXT_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 2
[[ "$ARCHIVE_S3_VERSION_ID" =~ ^[A-Za-z0-9+/_=-]{1,256}$ ]] || exit 2
case "$ARCHIVE_OBJECT_KEY" in
  payrollph/immutable-backups/backup-run-*.pgdump.age|payrollph/immutable-backups/*/backup-run-*.pgdump.age) ;;
  *) echo 'Unsupported S3 archive path' >&2; exit 2 ;;
esac
command -v gh >/dev/null || exit 1
repo=erwinmehehe/payrollph
sha="$(gh api "repos/$repo/commits/main" --jq '.sha')"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
# Never reaches a Neon database; the workflow's Docker restore has --network none.
gh workflow run protected-neon-offsite-restore.yml --repo "$repo" --ref main \
  -f reviewed_sha="$sha" \
  -f archive_source_sha="$ARCHIVE_SOURCE_SHA" \
  -f object_key="$ARCHIVE_OBJECT_KEY" \
  -f object_version_id="$ARCHIVE_S3_VERSION_ID" \
  -f encrypted_sha256="$ARCHIVE_CIPHERTEXT_SHA256" \
  -f change_ref="$CHANGE_REF" \
  -f confirmation=RESTORE_IN_DISPOSABLE_POSTGRES_ONLY
printf 'Offline restore dispatched at main=%s. Inspect actual run before certifying recovery.\n' "$sha"
