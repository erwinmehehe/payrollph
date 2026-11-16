/** Inspected execution evidence for anonymous SSO discovery; grants no coverage credit. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SSO_EXECUTION_RECEIPT, SSO_RESOLVE_BLOB, SSO_RESOLVE_PATH, blob, ssoExecutedInputRead } from "./tenant-sso-resolve-public-policy.mjs";

const RECEIPT_BLOB = "480e937c8e93265bc81500630bb1bd3a3ad7f779";
export const SSO_RESOLVE_EVIDENCE = "https://github.com/erwinmehehe/payrollph/actions/runs/43722348996/job/132836852192";

export function verifySsoResolveExecution(read = readFileSync) {
  const raw = read(SSO_EXECUTION_RECEIPT);
  assert.equal(blob(raw), RECEIPT_BLOB, "Executed SSO discovery receipt changed; never silently repin a replacement");
  const r = JSON.parse(raw);
  assert.deepEqual(Object.keys(r).sort(), [
    "coverageCredits", "evidence", "evidenceLabel", "independentSecurityReview", "inputs", "jobConclusion", "jobId", "method",
    "passedSteps", "productionCertified", "realProviderCalls", "result", "runId", "schema", "sourceHead",
  ]);
  assert.equal(r.schema, "sso-resolve-public-pg16-v1");
  assert.equal(r.method, "POST /api/auth/sso/resolve");
  assert.equal(r.runId, "43722348996");
  assert.equal(r.jobId, "132836852192");
  assert.equal(r.jobConclusion, "success");
  assert.equal(r.sourceHead, "5f8acdd303d59839f47f2a80a8489d5fba9dfee6");
  assert.equal(r.evidence, SSO_RESOLVE_EVIDENCE);
  assert.equal(r.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(r.coverageCredits, 0);
  assert.equal(r.realProviderCalls, 0);
  assert.equal(r.independentSecurityReview, "PENDING");
  assert.equal(r.productionCertified, false);
  for (const key of [
    "twoIndependentEmployers", "realHigherIdVictim", "eachOwnVerifiedProviderPositive", "forgedTenantSelectorsDoNotChangeLookup",
    "crossEmployerDomainProviderJoinDenied", "samlAndUnverifiedDomainsDenied", "malformedAndCrossSiteDenied",
    "unchangedEmployerProviderAuditAndSessionSql",
  ]) assert.equal(r.result[key], true, key);
  assert.equal(r.result.completeMethodCredits, 0);
  assert.equal(r.result.family, "SSO_DISCOVERY_DOMAIN_PROVIDER_TENANT_BOUNDARY");
  for (const step of [
    "Create disposable PostgreSQL 16 schema", "Build production-mode Next for localhost",
    "Own domain positives, cross-employer FK denial, forged selector and immutable SQL",
  ]) assert.ok(r.passedSteps.includes(step), "Missing executed step: " + step);
  assert.equal(r.inputs[SSO_RESOLVE_PATH], SSO_RESOLVE_BLOB);
  assert.equal(Object.keys(r.inputs).length, 8);
  const executedRead = ssoExecutedInputRead(read);
  for (const [path, expected] of Object.entries(r.inputs)) {
    assert.equal(blob(executedRead(path)), expected, "SSO discovery executed input drift: " + path);
  }
  return r;
}
