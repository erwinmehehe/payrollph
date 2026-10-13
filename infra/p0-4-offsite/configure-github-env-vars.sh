#!/usr/bin/env bash
# Configure ONLY nonsecret environment vars after Terraform has been applied.
# Refuse to set vars in unprotected or wrong-branch GitHub environments.
set -euo pipefail
: "${BACKUP_AGE_RECIPIENT:?Only age public recipient, never its private key}"
: "${BACKUP_ALLOWED_ACTORS:?Allowed GitHub logins}"
: "${RESTORE_ALLOWED_ACTORS:?Allowed GitHub logins}"
command -v gh >/dev/null || { echo 'gh CLI required' >&2; exit 1; }
command -v terraform >/dev/null || { echo 'terraform CLI required' >&2; exit 1; }
repo=erwinmehehe/payrollph
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup=payrollph-production-backup
restore=payrollph-production-restore
for env in "$backup" "$restore"; do
  # Environment must already require operator deployment approval.
  required="$(gh api "repos/$repo/environments/$env" --jq '[.protection_rules[]? | select(.type == "required_reviewers")] | length')"
  [[ "$required" -ge 1 ]] || { echo "STOP: required operator approval missing: $env" >&2; exit 2; }
  # Custom branch policy must allow only main.
  custom="$(gh api "repos/$repo/environments/$env" --jq '.deployment_branch_policy.custom_branch_policies')"
  [[ "$custom" == true ]] || { echo "STOP: branch restrictions missing: $env" >&2; exit 2; }
  patterns="$(gh api "repos/$repo/environments/$env/deployment-branch-policies" --jq '[.branch_policies[]?.name] | join(",")')"
  [[ "$patterns" == main ]] || { echo "STOP: environment $env must allow only main (found $patterns)" >&2; exit 2; }
done
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[023456789acdefghjklmnpqrstuvwxyz]{50,70}$ ]] || {
  echo 'STOP: malformed age recipient' >&2; exit 2;
}
setvar() { gh variable set "$1" -R "$repo" --env "$2" --body "$3" >/dev/null; }
tfout() { terraform -chdir="$root" output -raw "$1"; }
setvar BACKUP_NEON_PROJECT_ID "$backup" calm-wave-70219564
setvar BACKUP_NEON_BRANCH_ID "$backup" br-lucky-sound-b79i56jw
setvar BACKUP_NEON_ENDPOINT_ID "$backup" ep-cool-hat-b7e7gpoo
setvar BACKUP_PGHOST "$backup" ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech
setvar BACKUP_PGUSER "$backup" payrollph_backup_ro
setvar BACKUP_AWS_REGION "$backup" us-east-1
setvar BACKUP_AWS_ROLE_ARN "$backup" "$(tfout backup_role_arn)"
setvar BACKUP_ALLOWED_ACTORS "$backup" "$BACKUP_ALLOWED_ACTORS"
setvar BACKUP_S3_BUCKET "$backup" "$(tfout bucket_name)"
setvar BACKUP_S3_PREFIX "$backup" payrollph/immutable-backups
setvar BACKUP_KMS_KEY_ARN "$backup" "$(tfout kms_key_arn)"
setvar BACKUP_AGE_RECIPIENT "$backup" "$BACKUP_AGE_RECIPIENT"
setvar BACKUP_S3_BUCKET "$restore" "$(tfout bucket_name)"
setvar RESTORE_AWS_ROLE_ARN "$restore" "$(tfout restore_role_arn)"
setvar RESTORE_ALLOWED_ACTORS "$restore" "$RESTORE_ALLOWED_ACTORS"
echo "Nonsecret environment variables configured. Install ONLY protected secrets manually:"
echo "  backup: BACKUP_PG_PASSWORD"
echo "  restore: RESTORE_AGE_PRIVATE_KEY"
echo "Do not copy private age identity into the backup environment."
