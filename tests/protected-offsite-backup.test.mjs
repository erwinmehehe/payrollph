import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PINNED_SOURCE, validateProtectedBackupRequest,
} from "../scripts/lib/protected-offsite-backup-policy.mjs";

const SHA="a".repeat(40);
const fixture=()=>({
  eventName:"workflow_dispatch",repository:PINNED_SOURCE.repository,
  ref:PINNED_SOURCE.ref,githubSha:SHA,reviewedSha:SHA,
  runId:"123456789",runAttempt:"1",
  workflowEnvironment:PINNED_SOURCE.environment,
  actor:"erwinmehehe",allowedActors:"erwinmehehe,backupoperator",
  changeRef:"P0-4-CHANGE-20261012-001",
  neonProjectId:PINNED_SOURCE.projectId,
  neonBranchId:PINNED_SOURCE.branchId,
  neonEndpointId:PINNED_SOURCE.endpointId,
  dbHost:PINNED_SOURCE.host,dbPort:PINNED_SOURCE.port,
  dbName:PINNED_SOURCE.database,dbUser:"readonly_backup_account",
  awsRegion:"us-east-1",s3Bucket:"payrollph-locked-backup-test",
  s3Prefix:"payrollph/immutable-backups",
  kmsKeyArn:"arn:aws:kms:us-east-1:123456789012:key/00000000-1111-2222-3333-444444444444",
  ageRecipient:"age1"+"q".repeat(58),
});

function rejects(changes,part){
  assert.throws(()=>validateProtectedBackupRequest({...fixture(),...changes}),
    new RegExp("P0_4_BACKUP_"+part));
}

test("reviewed manual request is pinned to exact source, immutable S3 and no release claims",()=>{
  const result=validateProtectedBackupRequest(fixture());
  assert.equal(result.objectKey,
    "payrollph/immutable-backups/backup-run-123456789-attempt-1-aaaaaaaaaaaa.pgdump.age");
  assert.equal(result.source.branchId,PINNED_SOURCE.branchId);
  assert.equal(result.source.endpointId,PINNED_SOURCE.endpointId);
  assert.equal(result.encryption,"age-x25519+S3-SSE-KMS");
  assert.equal(result.backupCompleted,false);
  assert.equal(result.recoveryCertified,false);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.source),true);
});

test("wrong branch, repo, event, environment, or reviewed SHA never reaches backup",()=>{
  rejects({ref:"refs/heads/feature"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({repository:"other/repo"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({eventName:"schedule"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({workflowEnvironment:"development"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({reviewedSha:"b".repeat(40)},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({githubSha:"latest"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({changeRef:"untracked"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({actor:"unknown"},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
  rejects({allowedActors:""},"UNPROTECTED_OR_UNREVIEWED_SOURCE");
});

test("wrong Neon project/branch/endpoint/hostname, pooled host or elevated reader blocked",()=>{
  rejects({neonProjectId:"wrong-project"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({neonBranchId:"br-other-id"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({neonEndpointId:"ep-other-id"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({dbHost:"ep-other.c-13.us-east-1.aws.neon.tech"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({dbHost:PINNED_SOURCE.host.replace(".c-13.","-pooler.c-13.")},
    "WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({dbName:"postgres"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({dbPort:"6543"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({dbUser:"postgres"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
  rejects({dbUser:"production_admin"},"WRONG_DATABASE_OR_ELEVATED_ROLE");
});

test("S3 bucket, object prefix, encryption recipient, KMS ARN and region are mandatory",()=>{
  rejects({s3Bucket:"../../untrusted"},"OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  rejects({s3Bucket:"123.123.123.123"},"OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  rejects({s3Prefix:"other"}, "OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  rejects({s3Prefix:"payrollph/immutable-backups/../../other"},
    "OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  rejects({kmsKeyArn:"arn:aws:kms:us-west-2:123456789012:key/nope"},
    "OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  rejects({ageRecipient:"user-supplied-symmetric-key"},
    "OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
  rejects({awsRegion:"us-west-2"},
    "OFFSITE_ENCRYPTION_OR_RETENTION_NOT_CONFIGURED");
});

test("backup script uses direct Neon reader, encryption pipe, immutable object lock and ciphertext hash",()=>{
  const sh=readFileSync("scripts/backup-neon-offsite-encrypted.sh","utf8");
  const sql=readFileSync("scripts/sql/protected-neon-backup-source.sql","utf8");
  assert.match(sh,/node scripts\/validate-protected-offsite-backup\.mjs/);
  assert.match(sh,/pg_dump --format=custom/);
  assert.match(sh,/\| age -r "\$BACKUP_AGE_RECIPIENT" > "\$archive"/);
  assert.match(sh,/aws s3api get-object-lock-configuration/);
  assert.match(sh,/aws s3api get-public-access-block/);
  for (const flag of ["BlockPublicAcls","IgnorePublicAcls","BlockPublicPolicy","RestrictPublicBuckets"]) {
    assert.match(sh,new RegExp(flag));
  }
  assert.match(sh,/BACKUP_S3_PUBLIC_ACCESS_NOT_BLOCKED/);
  assert.match(sh,/--object-lock-mode COMPLIANCE/);
  // Object Lock requires the raw archive SHA-256 as a base64 checksum.
  assert.match(sh,/--checksum-algorithm SHA256/);
  assert.match(sh,/--checksum-sha256/);
  assert.match(sh,/Buffer\.from\(process\.argv\[1\], "hex"\)\.toString\("base64"\)/);
  assert.match(sh,/saved_version=/);
  assert.match(sh,/BACKUP_STORED_OBJECT_CONTROLS_NOT_VERIFIED/);
  assert.match(sh,/BACKUP_RETENTION_SHORTER_THAN_REQUESTED/);
  assert.match(sh,/s3VersionId/);
  assert.match(sh,/--server-side-encryption aws:kms/);
  assert.match(sh,/--serializable-deferrable/);
  assert.doesNotMatch(sh,/set -x|\bworkflow_dispatch.*\brestore\s/i);
  assert.match(sql,/current_setting\('neon\.branch_id',true\)/);
  assert.match(sql,/current_setting\('neon\.project_id',true\)/);
  assert.match(sql,/current_setting\('neon\.endpoint_id',true\)/);
  assert.match(sql,/rolbypassrls/);
  assert.match(sql,/PINNED_READ_ONLY_SOURCE/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INTO|FROM|public\.)/i);
});

test("workflow cannot auto-run and cannot omit protected GitHub environment",()=>{
  const workflow=readFileSync(".github/workflows/protected-neon-offsite-backup.yml","utf8");
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s*schedule:\s*$/m);
  assert.match(workflow,/environment: payrollph-production-backup/);
  assert.match(workflow,/role-to-assume:/);
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/secrets\.BACKUP_PG_PASSWORD/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow,/\$\{\{[^\n}]*\}(?!\})/);
});
