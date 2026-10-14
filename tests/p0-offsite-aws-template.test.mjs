import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stack = JSON.parse(readFileSync(new URL("../infra/p0-offsite-backup/cloudformation.json", import.meta.url), "utf8"));
const resources = stack.Resources;
const upload = resources.BackupUploadRole.Properties;
const restore = resources.RestoreReadOnlyRole.Properties;
const statements = (role) => role.Policies[0].PolicyDocument.Statement;
const actions = (role) => statements(role).flatMap((statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action]);

test("P0 #907 stack requires an immutable private SSE-KMS bucket, retained on delete", () => {
  const bucket = resources.BackupBucket;
  assert.equal(bucket.Type, "AWS::S3::Bucket");
  assert.equal(bucket.DeletionPolicy, "Retain");
  assert.equal(bucket.UpdateReplacePolicy, "Retain");
  assert.equal(bucket.Properties.ObjectLockEnabled, true);
  assert.deepEqual(bucket.Properties.VersioningConfiguration, { Status: "Enabled" });
  assert.deepEqual(bucket.Properties.ObjectLockConfiguration.Rule.DefaultRetention, {
    Mode: "COMPLIANCE", Days: 30,
  });
  for (const item of Object.values(bucket.Properties.PublicAccessBlockConfiguration)) {
    assert.equal(item, true);
  }
  assert.equal(bucket.Properties.OwnershipControls.Rules[0].ObjectOwnership, "BucketOwnerEnforced");
  const encrypted = bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0];
  assert.equal(encrypted.ServerSideEncryptionByDefault.SSEAlgorithm, "aws:kms");
  assert.equal(encrypted.ServerSideEncryptionByDefault.KMSMasterKeyID["Fn::GetAtt"][0], "BackupKmsKey");
});

test("P0 #907 roles use separate exact audience and protected-environment subjects", () => {
  const check = (role, parameter) => {
    const trusted = role.AssumeRolePolicyDocument.Statement;
    assert.equal(trusted.length, 1);
    assert.equal(trusted[0].Action, "sts:AssumeRoleWithWebIdentity");
    assert.deepEqual(trusted[0].Principal.Federated, {Ref:"GitHubOidcProviderArn"});
    assert.deepEqual(trusted[0].Condition.StringEquals, {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": {Ref:parameter},
    });
  };
  check(upload,"BackupOidcSubject");
  check(restore,"RestoreOidcSubject");
  assert.notEqual(stack.Parameters.BackupOidcSubject.Default, stack.Parameters.RestoreOidcSubject.Default);
  assert.match(stack.Parameters.BackupOidcSubject.Default, /@20321511\/payrollph@1389899403:environment:payrollph-production-backup$/);
  assert.match(stack.Parameters.RestoreOidcSubject.Default, /@20321511\/payrollph@1389899403:environment:payrollph-production-restore$/);
  for (const parameter of ["BackupOidcSubject","RestoreOidcSubject"]) {
    assert.ok(!stack.Parameters[parameter].Default.includes("*"));
  }
});

test("P0 #907 upload role has required metadata and archive permissions, but no delete or decrypt", () => {
  const granted = actions(upload);
  for (const needed of [
    "s3:GetBucketVersioning","s3:GetBucketObjectLockConfiguration",
    "s3:GetBucketPublicAccessBlock","s3:PutObject","s3:PutObjectRetention",
    "s3:GetObject","s3:GetObjectRetention","kms:Encrypt",
    "kms:GenerateDataKey","kms:DescribeKey",
  ]) assert.ok(granted.includes(needed), needed);
  for (const forbidden of [
    "s3:DeleteObject","s3:DeleteObjectVersion","kms:Decrypt",
    "iam:PassRole","s3:PutBucketPolicy","s3:PutBucketObjectLockConfiguration","*",
  ]) assert.ok(!granted.includes(forbidden), forbidden);
  const objectStatements = statements(upload).filter((stmt) => stmt.Action.includes("s3:PutObject"));
  assert.equal(objectStatements.length, 1);
  assert.equal(objectStatements[0].Resource["Fn::Sub"], "${BackupBucket.Arn}/payrollph/immutable-backups/*");
});

test("P0 #907 restore role is version-pinned ciphertext-read and decrypt ONLY", () => {
  const granted = actions(restore);
  assert.deepEqual(granted.sort(), [
    "s3:GetObject","s3:GetObjectVersion","s3:GetObjectRetention","kms:Decrypt",
  ].sort());
  assert.ok(!granted.includes("s3:PutObject"));
  assert.ok(!granted.includes("s3:DeleteObject"));
  assert.equal(statements(restore)[0].Resource["Fn::Sub"], "${BackupBucket.Arn}/payrollph/immutable-backups/*");
});

test("P0 #907 denies insecure, non-KMS, and non-COMPLIANCE uploads", () => {
  const items = resources.BackupBucketPolicy.Properties.PolicyDocument.Statement;
  assert.deepEqual(items.map((item) => item.Sid), [
    "DenyInsecureTransport","DenyUploadsWithoutExplicitSseKms",
    "DenyUploadsWithOtherKmsKey","DenyUploadsWithoutComplianceLock",
  ]);
  assert.ok(items.every((item)=>item.Effect==="Deny" && item.Principal==="*"));
  assert.equal(items[0].Condition.Bool["aws:SecureTransport"],"false");
  assert.equal(items[1].Condition.StringNotEquals["s3:x-amz-server-side-encryption"],"aws:kms");
  assert.equal(items[3].Condition.StringNotEquals["s3:object-lock-mode"],"COMPLIANCE");
  const key = resources.BackupKmsKey;
  assert.equal(key.DeletionPolicy,"Retain");
  assert.equal(key.Properties.EnableKeyRotation,true);
});

test("P0 #907 IaC remains opt-in and contains no external write or raw secret material", () => {
  assert.deepEqual(Object.keys(resources).sort(), [
    "BackupBucket","BackupBucketPolicy","BackupKmsKey","BackupUploadRole","RestoreReadOnlyRole",
  ].sort());
  const raw = JSON.stringify(stack);
  for (const forbidden of ["AWS::Lambda::Function","AWS::Events::Rule","AWS::CloudFormation::CustomResource",
    "BEGIN PRIVATE KEY","DATABASE_URL","pg_dump","AWS::SecretsManager::Secret"]) {
    assert.ok(!raw.includes(forbidden), forbidden);
  }
});
