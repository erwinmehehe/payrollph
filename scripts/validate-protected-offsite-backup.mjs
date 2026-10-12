#!/usr/bin/env node
import { validateProtectedBackupRequest, PINNED_SOURCE } from "./lib/protected-offsite-backup-policy.mjs";

try {
  const e = process.env;
  const x = validateProtectedBackupRequest({
    eventName:e.GITHUB_EVENT_NAME, repository:e.GITHUB_REPOSITORY,
    ref:e.GITHUB_REF, githubSha:e.GITHUB_SHA, reviewedSha:e.BACKUP_REVIEWED_SHA,
    runId:e.GITHUB_RUN_ID, runAttempt:e.GITHUB_RUN_ATTEMPT,
    workflowEnvironment:e.BACKUP_WORKFLOW_ENVIRONMENT,
    changeRef:e.BACKUP_CHANGE_REF,
    neonProjectId:e.BACKUP_NEON_PROJECT_ID,
    neonBranchId:e.BACKUP_NEON_BRANCH_ID,
    neonEndpointId:e.BACKUP_NEON_ENDPOINT_ID,
    dbHost:e.PGHOST, dbPort:e.PGPORT, dbName:e.PGDATABASE,
    dbUser:e.PGUSER, awsRegion:e.AWS_REGION,
    s3Bucket:e.BACKUP_S3_BUCKET, s3Prefix:e.BACKUP_S3_PREFIX,
    kmsKeyArn:e.BACKUP_KMS_KEY_ARN, ageRecipient:e.BACKUP_AGE_RECIPIENT,
  });
  if (e.GITHUB_ACTIONS !== "true" || e.CI !== "true" ||
      e.BACKUP_MANUAL_CONFIRM !== "ENCRYPT_ONLY_NO_RESTORE" ||
      e.PGSSLMODE !== "verify-full" || e.PGSSLROOTCERT !== "system" ||
      e.BACKUP_WORKFLOW_ENVIRONMENT !== PINNED_SOURCE.environment) {
    throw new Error("P0_4_BACKUP_ENVIRONMENT_OR_CONFIRMATION_MISSING");
  }
  // GITHUB_OUTPUT is handled by the host. Keep the only output metadata-only.
  console.log(JSON.stringify({
    ...x, source: {
      projectId:x.source.projectId, branchId:x.source.branchId,
      endpointId:x.source.endpointId, database:x.source.database,
    },
    status:"PINNED_MANUAL_REQUEST_ONLY",
  }));
} catch (error) {
  const code = error?.message && /^P0_4_BACKUP_[A-Z_]+$/.test(error.message)
    ? error.message : "P0_4_BACKUP_VALIDATION_FAILED";
  console.error(code);
  process.exitCode = 1;
}
