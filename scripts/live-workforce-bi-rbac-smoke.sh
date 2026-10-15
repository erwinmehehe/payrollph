#!/usr/bin/env bash
# Read-only RBAC HTTP contract for the PUBLIC, FICTIONAL Linaw demo.
# This runs only after the existing workflow proves the deployed exact SHA
# and obtains an actual /api/auth/demo-switch session for each role.
set -euo pipefail
umask 077

if [[ "$(printenv CI 2>/dev/null || true)" != "true" ||
      "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != "true" ||
      "$(printenv GITHUB_REF 2>/dev/null || true)" != "refs/heads/main" ||
      "$(printenv BASE_URL 2>/dev/null || true)" != "https://erwinmehehe-payrollph.vercel.app" ||
      ! "$(printenv EXPECTED_COMMIT_SHA 2>/dev/null || true)" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Live Workforce/BI acceptance is restricted to the exact-main GitHub public sandbox workflow."
  exit 2
fi

# Never emit curl response bodies, headers, session cookies, or test files.
# A failed check prints only the endpoint, role, and numeric HTTP status.
deny_shape() {
  jq -e '
    type == "object"
    and (.error | type == "string")
    and (has("datasets") | not)
    and (has("scopes") | not)
    and (has("plans") | not)
    and (has("positions") | not)
    and (has("allocations") | not)
    and (has("submissions") | not)
    and (has("employees") | not)
  ' "$1" > /dev/null 2>&1
}

verify_http() {
  local endpoint="$1"
  local label="$2"
  local org_id="$3"
  local expected="$4"
  local cookie_file="$5"
  local output="$6"
  local status

  # Do not use -L or log response text; redirections must not pass.
  if [[ -n "$cookie_file" ]]; then
    status=$(curl --silent --show-error --max-time 20 --proto '=https' \
      -b "$cookie_file" -o "$output" -w '%{http_code}' \
      "$BASE_URL$endpoint?organizationId=$org_id" || true)
  else
    status=$(curl --silent --show-error --max-time 20 --proto '=https' \
      -o "$output" -w '%{http_code}' \
      "$BASE_URL$endpoint?organizationId=$org_id" || true)
  fi

  echo "role=$label route=$endpoint http_status=$status expected=$expected"
  if [[ "$status" != "$expected" ]]; then
    echo "::error::Workforce/BI HTTP status mismatch for role=$label route=$endpoint (response withheld)."
    exit 1
  fi

  if [[ "$expected" == "401" || "$expected" == "403" ]]; then
    if ! deny_shape "$output"; then
      echo "::error::Workforce/BI denied response shape invalid (response withheld)."
      exit 1
    fi
  fi
}

if [[ "$#" -eq 1 && "$1" == "--anonymous" ]]; then
  tmp_file=$(mktemp)
  trap 'rm -f -- "$tmp_file"' EXIT
  for endpoint in /api/bi-exports /api/workforce-planning /api/workforce-planning/allocations; do
    verify_http "$endpoint" anonymous 1 401 "" "$tmp_file"
  done
  echo "PASS: all three anonymous Workforce/BI GETs deny with 401."
  exit 0
fi

if [[ "$#" -ne 4 ]]; then
  echo "::error::Expected role, organization ID, private cookie-jar path, and private work-dir."
  exit 2
fi

role="$1"
organization_id="$2"
cookie_jar="$3"
work_dir="$4"

case "$role" in
  owner|hr|payroll|checker|bookkeeper|employee) ;;
  *) echo "::error::Unsupported fictional demo role."; exit 2 ;;
esac

if [[ ! "$organization_id" =~ ^[1-9][0-9]*$ ||
      ! -s "$cookie_jar" ||
      ! -f "$work_dir/demo-switch.json" ]]; then
  echo "::error::Missing validated fictional demo session evidence."
  exit 2
fi

# This is an existing PUBLIC demo-switch session, not a forged cookie or
# administrator impersonation. The normal route verifies its DB session.
if ! jq -e --arg role "$role" --argjson org "$organization_id" '
  type == "object"
  and .ok == true
  and .demoDataMode == "synthetic-redacted"
  and .sensitiveFieldsPersisted == false
  and .organizationId == $org
  and .user.role == $role
' "$work_dir/demo-switch.json" > /dev/null 2>&1; then
  echo "::error::Demo session is not confirmed fictional and redacted."
  exit 2
fi

for endpoint in /api/bi-exports /api/workforce-planning /api/workforce-planning/allocations; do
  expected=403
  case "$endpoint" in
    /api/bi-exports)
      case "$role" in owner|hr|payroll|bookkeeper) expected=200 ;; esac
      ;;
    /api/workforce-planning|/api/workforce-planning/allocations)
      case "$role" in owner|hr|bookkeeper) expected=200 ;; esac
      ;;
  esac

  verify_http "$endpoint" "$role" "$organization_id" "$expected" \
    "$cookie_jar" "$work_dir/workforce-bi-response.json"

  if [[ "$expected" == "200" ]]; then
    case "$endpoint" in
      /api/bi-exports)
        jq -e '
          type == "object"
          and (.datasets | type == "array" and length > 0)
          and (.scopes.legalEntities | type == "array")
          and (.scopes.orgUnits | type == "array")
          and (.scopes.dynamicGroups | type == "array")
          and (.formats | type == "array")
        ' "$work_dir/workforce-bi-response.json" > /dev/null 2>&1
        ;;
      /api/workforce-planning)
        jq -e --arg role "$role" --argjson org "$organization_id" '
          type == "object"
          and (.access.role == $role)
          and (.access.organizationId == $org)
          and (.access.companyWide == true)
          and (.profiles | type == "array")
          and (.plans | type == "array")
          and (.positions | type == "array")
          and (.orgUnits | type == "array")
          and (all(.plans[]; .organizationId == $org))
          and (all(.positions[]; .organizationId == $org))
        ' "$work_dir/workforce-bi-response.json" > /dev/null 2>&1
        ;;
      /api/workforce-planning/allocations)
        jq -e --arg role "$role" --argjson org "$organization_id" '
          type == "object"
          and (.access.role == $role)
          and (.access.companyWide == true)
          and (.allocations | type == "array")
          and (.submissions | type == "array")
          and (all(.allocations[]; .organizationId == $org))
          and (all(.submissions[]; .organizationId == $org))
        ' "$work_dir/workforce-bi-response.json" > /dev/null 2>&1
        ;;
    esac || {
      echo "::error::Workforce/BI 200 response contract or tenant-scoping check failed (body withheld)."
      exit 1
    }
  fi
done

# Negative membership probe only: NOT a two-employer acceptance test.
# A different, unassigned organizationId must not return records.
if [[ "$role" == "owner" ]]; then
  missing_membership_id=$((organization_id + 1000000))
  for endpoint in /api/bi-exports /api/workforce-planning /api/workforce-planning/allocations; do
    verify_http "$endpoint" "owner-nonmember" "$missing_membership_id" 403 \
      "$cookie_jar" "$work_dir/workforce-bi-response.json"
  done
fi

echo "PASS: deployed fictional demo Workforce/BI GET access contract for role=$role."
