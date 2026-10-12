import { PINNED_SOURCE } from "./protected-offsite-backup-policy.mjs";

function refuse(code) { throw new Error("P0_4_RESTORE_" + code); }
const SHA=/^[0-9a-f]{40}$/;
export function validateProtectedRestoreRequest(values) {
  if(!values || typeof values !== "object" || Array.isArray(values)) {
    refuse("MISSING_REQUEST");
  }
  const {
    eventName,repository,ref,githubSha,reviewedSha,
    workflowEnvironment,changeRef,confirmation,actor,allowedActors,
    archiveSourceSha,objectKey,expectedEncryptedSha256,
    awsRegion,s3Bucket,
  }=values;
  if(eventName!=="workflow_dispatch" ||
     repository!==PINNED_SOURCE.repository ||
     ref!==PINNED_SOURCE.ref || !SHA.test(githubSha??"") ||
     reviewedSha!==githubSha ||
     workflowEnvironment!=="payrollph-production-restore" ||
     typeof actor!=="string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(actor) ||
     typeof allowedActors!=="string" ||
     !/^[A-Za-z0-9][A-Za-z0-9,-]{0,256}$/.test(allowedActors) ||
     !allowedActors.split(",").includes(actor) ||
     confirmation!=="RESTORE_IN_DISPOSABLE_POSTGRES_ONLY" ||
     typeof changeRef!=="string" || !/^P0-4-[A-Za-z0-9-]{8,100}$/.test(changeRef)) {
    refuse("UNAPPROVED_OPERATOR_OR_SOURCE");
  }
  if(!SHA.test(archiveSourceSha??"") ||
     !/^[a-f0-9]{64}$/.test(expectedEncryptedSha256??"") ||
     typeof objectKey!=="string" ||
     !/^payrollph\/immutable-backups(?:\/[a-z0-9-]{1,40})?\/backup-run-[0-9]{1,16}-attempt-[1-9][0-9]{0,4}-[a-f0-9]{12}\.pgdump\.age$/.test(objectKey) ||
     !objectKey.endsWith("-"+archiveSourceSha.slice(0,12)+".pgdump.age") ||
     awsRegion!==PINNED_SOURCE.awsRegion ||
     typeof s3Bucket!=="string" ||
     !/^(?![0-9.]+$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(s3Bucket)) {
    refuse("UNTRUSTED_ENCRYPTED_ARCHIVE");
  }
  return Object.freeze({
    objectKey,
    expectedEncryptedSha256,
    archiveSourceSha,
    mode:"isolated-local-postgres-18-only",
    decryptsOnlyAfterCiphertextDigestVerification:true,
    usesNeonRestoreAPI:false,
    productionConnectionAllowed:false,
    tenantRowsMayBeLoadedIntoProtectedEphemeralRunner:true,
    recoveryCertified:false,
  });
}
