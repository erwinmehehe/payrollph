#!/usr/bin/env bash
# Read-only guard for the historical A1-A6 database rehearsal.
# Does not validate production migrations or authorize activation.
set -euo pipefail

blocked() {
  local reason="$1"
  printf 'A1-A6 disposable baseline BLOCKED: %s\n' "$reason" >&2
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    printf '::error title=A1-A6 baseline blocked::%s\n' "$reason"
  fi
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '### A1-A6 disposable rehearsal: BLOCKED\n\n%s\n\nThis is not an A1-A6 release or migration certification. Do not drop existing tables to make the historical rehearsal pass.\n' "$reason" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 1
}

[[ "${CI:-}" == "true" ]] || blocked 'CI=true is required'
[[ "${A1_A6_DISPOSABLE_MIGRATION_MODE:-}" == "isolated-ci-only" ]] || blocked 'Disposable rehearsal mode is required'
base_sha="${A1_A6_BASE_SHA:-}"
head_sha="${A1_A6_HEAD_SHA:-}"
[[ "$base_sha" =~ ^[0-9a-f]{40}$ ]] || blocked 'Missing or invalid exact base SHA'
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || blocked 'Missing or invalid exact head SHA'
git cat-file -e "${base_sha}^{commit}" 2>/dev/null || blocked 'Base commit is not available locally'
git cat-file -e "${head_sha}^{commit}" 2>/dev/null || blocked 'Head commit is not available locally'

# Use the real PR head, not the synthetic checkout merge commit, which
# contains the base as a parent even when the feature branch is stale.
git merge-base --is-ancestor "$base_sha" "$head_sha" || blocked \
  "Integration head ${head_sha:0:12} does not contain main base ${base_sha:0:12}; reconcile on fresh main before running PostgreSQL QA"

schema_file="$(mktemp)"
trap 'rm -f "$schema_file"' EXIT
git show "${base_sha}:src/db/schema.ts" > "$schema_file" 2>/dev/null || blocked 'Cannot read pinned base Drizzle schema'
[[ -s "$schema_file" ]] || blocked 'Pinned base Drizzle schema is empty'
command -v python3 >/dev/null 2>&1 || blocked 'python3 is required for multiline schema preflight'

# Drizzle table declarations are formatted across multiple lines in newer
# sources. A line-oriented grep silently misses `pgTable(\n "table_name"`
# and could bootstrap an obsolete pre-A2/A3 database migration on fresh main.
# Inspect the whole BASE schema, not untrusted head/check-out merge contents.
# A missing parser, unreadable schema or a merged table must remain a hard deny.
if python3 - "$schema_file" <<'PY'
import pathlib
import re
import sys
schema = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
merged_feature_table = re.compile(
    r"""\bpgTable\s*\(\s*["'](?:employee_hr_cases|applicant_privacy_evidence)["']""",
    re.MULTILINE,
)
sys.exit(0 if merged_feature_table.search(schema) else 1)
PY
then
  blocked 'Main schema already defines HR-case and/or applicant-privacy tables; legacy A1-A6 proposal replay is incompatible. Build a fresh-main A4/A5-only rehearsal.'
fi

printf 'A1-A6 legacy baseline preflight passed for %s..%s (synthetic only, not release-certified)\n' "${base_sha:0:12}" "${head_sha:0:12}"
