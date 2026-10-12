import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProtectedRestoreRequest } from "../scripts/lib/protected-offsite-restore-policy.mjs";

const SHA="a".repeat(40);
const sourceSHA="b".repeat(40);
function fixture(){
 return {
   eventName:"workflow_dispatch",repository:"erwinmehehe/payrollph",
   ref:"refs/heads/main",githubSha:SHA,reviewedSha:SHA,
   workflowEnvironment:"payrollph-production-restore",
   actor:"erwinmehehe",allowedActors:"erwinmehehe,restoreoperator",
   changeRef:"P0-4-RESTORE-20261012-001",
   confirmation:"RESTORE_IN_DISPOSABLE_POSTGRES_ONLY",
   archiveSourceSha:sourceSHA,
   objectKey:"payrollph/immutable-backups/backup-run-123-attempt-1-"+sourceSHA.slice(0,12)+".pgdump.age",
   expectedEncryptedSha256:"c".repeat(64),
   awsRegion:"us-east-1",s3Bucket:"payrollph-private-locked-archive",
 };
}
function blocks(change,code) {
 assert.throws(()=>validateProtectedRestoreRequest({...fixture(),...change}),
  new RegExp("P0_4_RESTORE_"+code));
}
test("fully pinned offline restore request never claims production recovery",()=>{
 const result=validateProtectedRestoreRequest(fixture());
 assert.equal(result.mode,"isolated-local-postgres-18-only");
 assert.equal(result.productionConnectionAllowed,false);
 assert.equal(result.usesNeonRestoreAPI,false);
 assert.equal(result.recoveryCertified,false);
 assert.equal(result.decryptsOnlyAfterCiphertextDigestVerification,true);
 assert.equal(Object.isFrozen(result),true);
});

test("unreviewed GitHub source, wrong environment and accidental promotion fail",()=>{
 blocks({eventName:"schedule"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({ref:"refs/heads/restore"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({repository:"evil/repo"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({reviewedSha:sourceSHA},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({workflowEnvironment:"payrollph-production-backup"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({confirmation:"RESTORE_TO_NEON_MAIN"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({changeRef:"no-ticket"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({actor:"unknown"},"UNAPPROVED_OPERATOR_OR_SOURCE");
 blocks({allowedActors:""},"UNAPPROVED_OPERATOR_OR_SOURCE");
});

test("tampered object key, source hash, bucket, archive hash and AWS region fail",()=>{
 blocks({objectKey:"../backup-run-1.pgdump.age"},"UNTRUSTED_ENCRYPTED_ARCHIVE");
 blocks({objectKey:"payrollph/immutable-backups/backup-run-123-attempt-1-ffffffffffff.pgdump.age"},
    "UNTRUSTED_ENCRYPTED_ARCHIVE");
 blocks({objectKey:"payrollph/immutable-backups/../../production.dump"},
    "UNTRUSTED_ENCRYPTED_ARCHIVE");
 blocks({expectedEncryptedSha256:"missing"},"UNTRUSTED_ENCRYPTED_ARCHIVE");
 blocks({archiveSourceSha:"short"},"UNTRUSTED_ENCRYPTED_ARCHIVE");
 blocks({s3Bucket:"some.bucket/other"},"UNTRUSTED_ENCRYPTED_ARCHIVE");
 blocks({awsRegion:"us-east-2"},"UNTRUSTED_ENCRYPTED_ARCHIVE");
});

test("restore is networkless ephemeral PG18, cipher verified before any decryption",()=>{
 const sh=readFileSync("scripts/verify-protected-offsite-restore.sh","utf8");
 assert.match(sh,/--network none/);
 assert.match(sh,/postgres:18/);
 assert.match(sh,/RESTORE_CIPHERTEXT_TAMPERED/);
 assert.match(sh,/RESTORE_ARCHIVE_SOURCE_SHA/);
 assert.match(sh,/age -d -i/);
 assert.match(sh,/age -d -i "\$key" "\$archive"\s*\|\s*docker exec -i "\$container" pg_restore/);
 assert.doesNotMatch(sh,/decrypted\.pgdump|decrypted\.dump|\$work\/decrypted/);
 assert.doesNotMatch(sh,/age -d[^\n]*>\s*["']?\$work/);
 assert.match(sh,/--single-transaction --exit-on-error/);
 assert.match(sh,/RESTORE_EXTERNAL_DATABASE_ENV_FORBIDDEN/);
 assert.doesNotMatch(sh,/\bneon\s+(?:restore|branch|snapshot)\b/i);
 assert.doesNotMatch(sh,/set -x/);
});

test("synthetic PostgreSQL18 rehearsal uses encrypted-stream restore without plaintext archive files",()=>{
 const smoke=readFileSync("scripts/rehearse-encrypted-offsite-backup.sh","utf8");
 assert.match(smoke,/age -d -i "\$work\/age-identity\.txt" "\$work\/encrypted\.pgdump\.age"\s*\|\s*docker exec -i/);
 assert.match(smoke,/--single-transaction --exit-on-error/);
 assert.doesNotMatch(smoke,/decrypted\.dump|wrong-decrypt\.dump/);
});

test("manual private restore workflow never uses production DB or public artifacts",()=>{
 const wf=readFileSync(".github/workflows/protected-neon-offsite-restore.yml","utf8");
 assert.match(wf,/workflow_dispatch:/);
 assert.doesNotMatch(wf,/^\s*schedule:\s*$/m);
 assert.match(wf,/environment: payrollph-production-restore/);
 assert.match(wf,/secrets\.RESTORE_AGE_PRIVATE_KEY/);
 assert.match(wf,/vars\.RESTORE_AWS_ROLE_ARN/);
 assert.match(wf,/id-token: write/);
 assert.doesNotMatch(wf,/DATABASE_URL/);
 assert.doesNotMatch(wf,/\$\{\{[^\n}]*\}(?!\})/);
 assert.doesNotMatch(wf,/upload-artifact/);
});
