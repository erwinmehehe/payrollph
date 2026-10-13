/**
 * Strict, non-executing policy for manually dispatched off-site backups.
 * The protected workflow independently pins Neon identity and DB privileges.
 * This module never receives credentials or reads employee/payroll rows.
 */
export const PINNED_SOURCE = Object.freeze({
  repository: "erwinmehehe/payrollph",
  ref: "refs/heads/main",
  projectId: "calm-wave-70219564",
  branchId: "br-lucky-sound-b79i56jw",
  endpointId: "ep-cool-hat-b7e7gpoo",
  host: "ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech",
  database: "neondb",
  port: "5432",
  awsRegion: "us-east-1",
  environment: "payrollph-production-backup",
});
function reject(code) { throw new Error("P0_4_BACKUP_" + code); }
function matches(s,pattern) { return typeof s === "string" && pattern.test(s); }

export function validateProtectedBackupRequest(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    reject("REQUEST_MISSING");
  }
  const {
    eventName, repository, ref, githubSha, reviewedSha, runId, runAttempt,
    workflowEnvironment, changeRef, actor, allowedActors, neonProjectId, neonBranchId,
    neonEndpointId, dbHost, dbPort, dbName, dbUser, awsRegion,
    s3Bucket, s3Prefix, kmsKeyArn, ageRecipient,
  } = values;
  if (eventName !== "workflow_dispatch" || repository !== PINNED_SOURCE.repository ||
      ref !== PINNED_SOURCE.ref || workflowEnvironment !== PINNED_SOURCE.environment ||
      !matches(githubSha,/^[0-9a-f]{40}$/) || githubSha!==reviewedSha ||
      !matches(changeRef,/^P0-4-[A-Za-z0-9-]{8,100}$/) ||
      !matches(runId,/^[0-9]{1,16}$/) ||
      !matches(runAttempt,/^[1-9][0-9]{0,4}$/) ||
      !matches(actor,/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/) ||
      !matches(allowedActors,/^[A-Za-z0-9][A-Za-z0-9,-]{0,256}$/) ||
      !allowedActors.split(",").includes(actor)) {
    reject("UNPROTECTED_OR_UNREVIEWED_SOURCE");
  }
  if (neonProjectId!==PINNED_SOURCE.projectId ||
      neonBranchId!==PINNED_SOURCE.branchId ||
      neonEndpointId!==PINNED_SOURCE.endpointId ||
      dbHost!==PINNED_SOURCE.host || dbPort!==PINNED_SOURCE.port ||
      dbName!==PINNED_SOURCE.database ||
      !matches(dbUser,/^[a-z][a-z0-9_]{2,62}$/) ||
      /postgres|admin|owner|root|superuser/i.test(dbUser)) {
    reject("WRONG_DATABASE_OR_ELEVATED_ROLE");
  }
  if (awsRegion!==PINNED_SOURCE.awsRegion ||
      !matches(s3Bucket,/^(?![0-9.]+$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/) ||
      !matches(s3Prefix,/^payrollph\/immutable-backups(?:\/[a-z0-9-]{1,40})?$/) ||
      !matches(kmsKeyArn,/^arn:aws:kms:us-east-1:[0-9]{12}:key\/[a-f0-9-]{30,50}$/) ||
      !matches(ageRecipient,/^age1[023456789acdefghjklmnpqrstuvwxyz]{50,70}$/)) {
    reject("OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  }
  const objectKey = s3Prefix + "/backup-run-" + runId + "-attempt-" +
    runAttempt + "-" + githubSha.slice(0,12) + ".pgdump.age";
  return Object.freeze({
    objectKey,
    source: Object.freeze({...PINNED_SOURCE}),
    encryption: "age-x25519+S3-SSE-KMS",
    requiresS3Versioning: true,
    requiresS3ObjectLock: true,
    requiresExplicitRetention: true,
    sourceDataRead: false,
    backupCompleted: false,
    recoveryCertified: false,
  });
}
