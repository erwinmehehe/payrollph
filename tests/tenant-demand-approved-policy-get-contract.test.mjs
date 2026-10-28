import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APPROVED_POLICY_GET, assertApprovedPolicyHttp, assertApprovedPolicyDenial,
} from "../scripts/qa/tenant-demand-approved-policy-get-contract.mjs";

const hash = "a".repeat(64);
const receipt = "b".repeat(64);
const expected = {
  organizationId: 11, worksiteId: 31, jobProfileId: 51,
  id: 71, version: 1, contentSha256: hash, approvalReceiptSha256: receipt,
  effectiveFrom: "2099-01-01", effectiveUntil: "2099-01-31",
  productiveUnitsPerWorkerHour: 9, serviceTargetCoveragePercent: 73,
  rationale: "Synthetic own employer independently checked source",
};
function positive() {
  const row = { ...expected, metricKind: "transactions", intervalMinutes: 60,
    status: "approved", approvalIntegrity: "matches_hash",
    createdAt: "2026-10-28T01:00:00.000Z",
    submittedAt: "2026-10-28T01:02:00.000Z",
    approvedAt: "2026-10-28T01:03:00.000Z",
  };
  const json = { readOnly: true,
    scope: { organizationId: expected.organizationId,
      worksiteId: expected.worksiteId, jobProfileId: expected.jobProfileId,
      metricKind: "transactions", intervalMinutes: 60 },
    policies: [row],
    boundary: "No roster or payroll write.",
  };
  return { status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "cache-control": "private, no-store" }) };
}
function negative(status) {
  const json = { error: "Unavailable for this employer." };
  return { status, json, text: JSON.stringify(json), headers: new Headers() };
}

test("WRK-01 approved-mode GET is distinct from the previous draft-only source check", () => {
  assert.equal(APPROVED_POLICY_GET, "GET workforce/demand-staffing/policies");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = manifest.allApiRouteFiles[
    "src/app/api/workforce/demand-staffing/policies/route.ts"];
  const method = route.methods.find(x => x.name === "GET");
  assert.equal(method.status, "GAP", "only exact-head reviewed HTTP can change coverage");
  assert.equal(method.testedBy, null);
  const proof = readFileSync(
    "scripts/qa/tenant-demand-approved-policy-get-http.mjs", "utf8");
  const workflow = readFileSync(
    ".github/workflows/tenant-demand-governance-recovery-http.yml", "utf8");
  for (const signal of [
    "requireDisposableDemandRecovery();",
    "readAllowlistPreseed(file)",
    "createStaffingPolicyDraft({",
    "transitionStaffingPolicy({",
    "actorUserId: checker.id, actorRole: \"owner\"",
    'const own = await request(url, { cookie: attacker.cookie });',
    "assertApprovedPolicyHttp(own, expected",
    "genuine foreign higher-ID worksite",
    "genuine foreign higher-ID job profile",
    "policyId=",
    "await unchanged(\"all own 200",
    "coverageCredits: 0", "productionTested: false",
  ]) assert.ok(proof.includes(signal), "HTTP proof guard absent: " + signal);
  assert.ok(workflow.includes(
    "node --import tsx scripts/qa/tenant-demand-approved-policy-get-http.mjs"),
    "the candidate must run actual localhost Next + PG16, not source-only tests");
  assert.ok(workflow.includes("services:") && workflow.includes("postgres:16"));
});

test("genuine approved SQL-bound GET accepts only exact source receipt and private cache", () => {
  const row = assertApprovedPolicyHttp(positive(), expected, ["VICTIM-SECRET"]);
  assert.equal(row.status, "approved");
  assert.equal(row.approvalReceiptSha256, receipt);
});

test("mutated tenant, source, fake approval or exposed payroll fails the contract", () => {
  const mutate = f => {
    const r = positive();
    f(r);
    r.text = JSON.stringify(r.json);
    return r;
  };
  const changes = [
    r => { r.json.scope.organizationId = 99; },
    r => { r.json.scope.worksiteId = 99; },
    r => { r.json.policies[0].organizationId = 99; },
    r => { r.json.policies[0].worksiteId = 99; },
    r => { r.json.policies[0].jobProfileId = 99; },
    r => { r.json.policies[0].id = 99; },
    r => { r.json.policies[0].status = "draft"; },
    r => { r.json.policies[0].approvalIntegrity = "source_review"; },
    r => { r.json.policies[0].contentSha256 = "c".repeat(64); },
    r => { r.json.policies[0].approvalReceiptSha256 = null; },
    r => { r.json.policies[0].submittedAt = null; },
    r => { r.json.policies[0].approvedAt = null; },
    r => { r.json.policies[0].salary = "99000.00"; },
    r => { r.json.policies = []; },
    r => { r.json.policies.push({ ...r.json.policies[0] }); },
    r => { r.json.boundary = "Automatically create roster and payroll"; },
    r => { r.headers.set("cache-control", "public, no-store"); },
    r => { r.headers.delete("cache-control"); },
  ];
  for (const change of changes) {
    assert.throws(() => assertApprovedPolicyHttp(mutate(change), expected),
      "a misleading approved policy GET cannot pass");
  }
  const wrongEmployer = { ...expected, organizationId: 14 };
  assert.throws(() => assertApprovedPolicyHttp(positive(), wrongEmployer));
  const response = positive();
  response.headers.set("x-policy-debug", "VICTIM-SECRET");
  assert.throws(() => assertApprovedPolicyHttp(response, expected, ["VICTIM-SECRET"]));
});

test("denials enforce exact 400/401/403/404 with no policy or victim fields", () => {
  for (const status of [400, 401, 403, 404]) {
    assert.doesNotThrow(() => assertApprovedPolicyDenial(
      negative(status), status, ["VICTIM-SECRET"]));
  }
  for (const bad of [
    { ...negative(403), status: 404 },
    { ...negative(403), json: { error: "denied", policies: [{ id: 71 }] } },
    { ...negative(403), json: { error: "denied", readOnly: true } },
    { ...negative(403), text: "VICTIM-SECRET" },
    { ...negative(403), headers: new Headers({ "x-debug": "VICTIM-SECRET" }) },
  ]) assert.throws(() => assertApprovedPolicyDenial(bad, 403, ["VICTIM-SECRET"]));
});
