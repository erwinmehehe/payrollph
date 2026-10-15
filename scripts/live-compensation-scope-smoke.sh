#!/usr/bin/env bash
# Exact-main, production-aliased, fictional-demo-only compensation acceptance.
# The token-gated demo login idempotently seeds ONLY the already-isolated
# fictional sample; all compensation HTTP probes themselves use GET.
set -euo pipefail
umask 077

if [[ "$(printenv CI 2>/dev/null || true)" != "true" ||
      "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != "true" ||
      "$(printenv GITHUB_REF 2>/dev/null || true)" != "refs/heads/main" ||
      "$(printenv BASE_URL 2>/dev/null || true)" != "https://erwinmehehe-payrollph.vercel.app" ||
      ! "$(printenv EXPECTED_COMMIT_SHA 2>/dev/null || true)" =~ ^[0-9a-f]{40}$ ||
      "$(printenv PRODUCTION_READINESS_TOKEN 2>/dev/null | wc -c)" -lt 32 ]]; then
  echo "::error::Compensation production acceptance requires protected, exact-main GitHub Actions context."
  exit 2
fi

work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT

unit_cookie="$work_dir/unit-cookies.txt"
global_cookie="$work_dir/global-cookies.txt"
unit_login="$work_dir/unit-login.json"
global_login="$work_dir/global-login.json"
unit_response="$work_dir/unit-response.json"
global_response="$work_dir/global-response.json"
deny_response="$work_dir/denied.json"

login() {
  local kind="$1" cookie_file="$2" output="$3"
  local data status
  if [[ "$kind" == "unit" ]]; then
    # Readiness secret is already used for private SHA proof in this workflow.
    # This enables only a fictional HR account, never existing HR role elevation.
    data='{"role":"hr","scope":"unit"}'
    status=$(curl -sS --max-time 20 --proto '=https' \
      -c "$cookie_file" -o "$output" -w '%{http_code}' \
      -X POST "$BASE_URL/api/auth/demo-switch" \
      -H "Origin: $BASE_URL" -H "Sec-Fetch-Site: same-origin" \
      -H "Content-Type: application/json" \
      -H "x-readiness-token: $PRODUCTION_READINESS_TOKEN" \
      --data "$data" || true)
  else
    data='{"role":"hr"}'
    status=$(curl -sS --max-time 20 --proto '=https' \
      -c "$cookie_file" -o "$output" -w '%{http_code}' \
      -X POST "$BASE_URL/api/auth/demo-switch" \
      -H "Origin: $BASE_URL" -H "Sec-Fetch-Site: same-origin" \
      -H "Content-Type: application/json" --data "$data" || true)
  fi
  echo "compensation role=$kind auth_http=$status"
  if [[ "$status" != "200" || ! -s "$cookie_file" ]] ||
     ! jq -e --arg scope "$kind" '
       type == "object" and .ok == true and .scope == $scope and
       .demoDataMode == "synthetic-redacted" and
       .sensitiveFieldsPersisted == false and
       .user.role == "hr" and .redirectTo == "/app?demoRole=hr" and
       (.organizationId | type == "number" and . > 0 and . == floor)
     ' "$output" >/dev/null 2>&1; then
    echo "::error::Fictional $kind HR authentication failed; response withheld."
    exit 1
  fi
}

# Provision the fictional unit fixture before company HR reads the shared
# fictional compensation cycle. Two sessions never share cookies.
login unit "$unit_cookie" "$unit_login"
login company "$global_cookie" "$global_login"
unit_org_id=$(jq -r '.organizationId' "$unit_login")
global_org_id=$(jq -r '.organizationId' "$global_login")
if [[ "$unit_org_id" != "$global_org_id" || ! "$unit_org_id" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::The two fictional HR accounts are not in the same employer."
  exit 1
fi

get_compensation() {
  local label="$1" cookie_file="$2" org_id="$3" output="$4" expected="$5"
  local status
  if [[ -n "$cookie_file" ]]; then
    status=$(curl -sS --max-time 20 --proto '=https' \
      -b "$cookie_file" -o "$output" -w '%{http_code}' \
      "$BASE_URL/api/compensation?organizationId=$org_id" || true)
  else
    status=$(curl -sS --max-time 20 --proto '=https' \
      -o "$output" -w '%{http_code}' \
      "$BASE_URL/api/compensation?organizationId=$org_id" || true)
  fi
  echo "compensation role=$label read_http=$status expected=$expected"
  if [[ "$status" != "$expected" ]]; then
    echo "::error::Compensation HTTP role-scope status mismatch; body withheld."
    exit 1
  fi
}

get_compensation company "$global_cookie" "$global_org_id" "$global_response" 200
get_compensation unit "$unit_cookie" "$unit_org_id" "$unit_response" 200
node scripts/verify-live-compensation-scope.mjs "$global_response" "$unit_response"

# Anonymous and foreign-employer reads must fail closed without row evidence.
get_compensation anonymous "" "$unit_org_id" "$deny_response" 401
jq -e 'type == "object" and (.error | type == "string") and
  (has("employees") | not) and (has("cycles") | not) and
  (has("proposals") | not)' "$deny_response" >/dev/null || {
    echo "::error::Anonymous denial shape invalid; response withheld."
    exit 1
  }

foreign_org_id=$((unit_org_id + 1000000))
get_compensation unit-nonmember "$unit_cookie" "$foreign_org_id" "$deny_response" 403
jq -e 'type == "object" and (.error | type == "string") and
  (has("employees") | not) and (has("cycles") | not) and
  (has("proposals") | not)' "$deny_response" >/dev/null || {
    echo "::error::Foreign-employer denial shape invalid; response withheld."
    exit 1
  }
echo "PASS: exact-deployment fictional compensation privacy (company HR, unit HR, anonymous, nonmember)."
