#!/usr/bin/env bash
# Verify the deployed application's actual database SESSION identity, not an
# operator-supplied Neon connector connection. No migrations, DDL or app rows.
# Intended for the protected GitHub main release-verification workflow.
set -euo pipefail
umask 077

BASE_URL="${BASE_URL:-}"
EXPECTED_COMMIT_SHA="${EXPECTED_COMMIT_SHA:-}"
PRODUCTION_READINESS_TOKEN="${PRODUCTION_READINESS_TOKEN:-}"

if [[ "$BASE_URL" != "https://erwinmehehe-payrollph.vercel.app" ]]; then
  echo "::error title=Production identity blocked::Unexpected canonical production origin."
  exit 1
fi
if [[ ! "$EXPECTED_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error title=Production identity blocked::A pinned full production commit SHA is required."
  exit 1
fi
if (( ${#PRODUCTION_READINESS_TOKEN} < 32 )); then
  echo "::error title=Production identity blocked::The protected readiness credential is unavailable."
  exit 1
fi

response_file="$(mktemp)"
trap 'rm -f -- "$response_file"' EXIT
http_status="$(curl --silent --show-error --max-time 15 --proto '=https' \
  -H "x-readiness-token: $PRODUCTION_READINESS_TOKEN" \
  -o "$response_file" -w '%{http_code}' \
  "$BASE_URL/api/readiness/database-target" || true)"

if [[ "$http_status" != "200" ]]; then
  echo "::error title=Production DB identity unavailable::Private probe returned HTTP ${http_status:-unknown}; response withheld."
  exit 1
fi

# Never emit the response body or database identity; validate expected values
# offline in the protected runner. Even errors must fail closed without logs.
if ! jq --exit-status --arg sha "$EXPECTED_COMMIT_SHA" '
  type == "object" and
  .deploymentSha == $sha and
  .deploymentEnvironment == "production" and
  .evidenceScope == "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL" and
  .database.databaseName == "neondb" and
  .database.projectId == "calm-wave-70219564" and
  .database.branchId == "br-lucky-sound-b79i56jw" and
  .database.endpointId == "ep-cool-hat-b7e7gpoo" and
  .database.roleName == "neondb_owner" and
  .database.inRecovery == false
' "$response_file" >/dev/null 2>&1; then
  echo "::error title=Production DB identity mismatch::Effective runtime DB does not match independently reviewed Neon target; details withheld."
  exit 1
fi

echo "Production runtime database identity VERIFIED against reviewed Neon target and exact live commit (identifiers withheld)."
echo "This is connection evidence only; it does not authorize a migration or payroll release."
