#!/usr/bin/env node
import { validateProtectedRestoreRequest } from "./lib/protected-offsite-restore-policy.mjs";
try{
  const e=process.env;
  const result=validateProtectedRestoreRequest({
    eventName:e.GITHUB_EVENT_NAME, repository:e.GITHUB_REPOSITORY,
    ref:e.GITHUB_REF, githubSha:e.GITHUB_SHA,
    reviewedSha:e.RESTORE_REVIEWED_SHA,
    workflowEnvironment:e.RESTORE_WORKFLOW_ENVIRONMENT,
    changeRef:e.RESTORE_CHANGE_REF,
    confirmation:e.RESTORE_CONFIRMATION,
    archiveSourceSha:e.RESTORE_ARCHIVE_SOURCE_SHA,
    objectKey:e.RESTORE_S3_OBJECT_KEY,
    expectedEncryptedSha256:e.RESTORE_CIPHERTEXT_SHA256,
    awsRegion:e.AWS_REGION,s3Bucket:e.BACKUP_S3_BUCKET,
  });
  if(e.GITHUB_ACTIONS!=="true" || e.CI!=="true" ||
     !e.RESTORE_WORKFLOW_ENVIRONMENT) {
    throw new Error("P0_4_RESTORE_UNPROTECTED_EXECUTION");
  }
  console.log(JSON.stringify({...result,status:"REVIEWED_OFFLINE_RESTORE_REQUEST_ONLY"}));
}catch(e){
  console.error(e?.message?.startsWith("P0_4_RESTORE_") ?
    e.message:"P0_4_RESTORE_REQUEST_REFUSED");
  process.exitCode=1;
}
