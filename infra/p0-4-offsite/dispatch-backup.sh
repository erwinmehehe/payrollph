#!/usr/bin/env bash
set -euo pipefail
: "${CHANGE_REF:?An approved P0-4 change record is required}"
[[ "$CHANGE_REF" =~ ^P0-4-[A-Za-z0-9-]{8,100}$ ]] || { echo 'Invalid change ref' >&2; exit 1; }
command -v gh >/dev/null || { echo 'gh CLI required' >&2; exit 1; }
repo=erwinmehehe/payrollph
sha="$(gh api "repos/$repo/commits/main" --jq '.sha')"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
gh workflow run protected-neon-offsite-backup.yml --repo "$repo" --ref main \
  -f reviewed_sha="$sha" -f change_ref="$CHANGE_REF" \
  -f confirmation=ENCRYPT_ONLY_NO_RESTORE
printf 'Backup dispatched at main=%s; require verified S3 VersionId and ciphertext receipt before restore.\n' "$sha"
