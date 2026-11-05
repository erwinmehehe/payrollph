import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableHcmEffectiveChangePost, HCM_EFFECTIVE_CHANGE_POST_METHOD, HCM_EFFECTIVE_CHANGE_POST_SOURCE_SHA,
} from "../scripts/qa/tenant-hcm-effective-change-post-contract.mjs";

const harness = readFileSync("scripts/qa/tenant-hcm-effective-change-post-http.mjs", "utf8");
const helper = readFileSync("scripts/qa/tenant-table-rows/helpers/hcm-effective-change-actions.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-hcm-effective-change-post-http.yml", "utf8");
const route = readFileSync("src/app/api/hcm/effective-changes/route.ts");

function blobSha(bytes) {
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
}
function validEnv() {
  return {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_HCM_EFFECTIVE_CHANGE_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
}

test("the proof never runs against a real database, server or provider", () => {
  assert.equal(requireDisposableHcmEffectiveChangePost(validEnv()), true);
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: "false", DATABASE_URL: "postgresql://db.external:5432/app_db",
    SECURITY_SMOKE_URL: "https://localhost:3000", TENANT_SECOND_PASS_MODE: "prod",
    TENANT_HCM_EFFECTIVE_CHANGE_MODE: "", WORKER_ENABLED: "true",
    CENTRAL_SCHEDULER_ENABLED: "true", PAYMONGO_DISBURSEMENTS_ENABLED: "true",
    XENDIT_BILLING_ENABLED: "true", XENDIT_PAYOUTS_ENABLED: "true",
  })) {
    assert.throws(() => requireDisposableHcmEffectiveChangePost({ ...validEnv(), [name]: value }));
  }
  for (const key of ["NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.throws(() => requireDisposableHcmEffectiveChangePost({ ...validEnv(), [key]: "not-allowed" }));
  }
});

test("effective-change POST source is unchanged, and credit is only ever through this proof", () => {
  assert.equal(HCM_EFFECTIVE_CHANGE_POST_METHOD, "src/app/api/hcm/effective-changes/route.ts POST");
  assert.equal(blobSha(route), HCM_EFFECTIVE_CHANGE_POST_SOURCE_SHA, "changed route requires a new exact-source proof before any credit");
  const source = route.toString("utf8");
  assert.match(source, /export async function POST/);
  for (const scoped of ["eq(employees.organizationId, organizationId)", "eq(orgUnits.organizationId, organizationId)", "eq(costCenters.organizationId, organizationId)",
    "eq(legalEntities.organizationId, organizationId)", "eq(positions.organizationId, organizationId)"]) assert.ok(source.includes(scoped), "route lost employer scope: " + scoped);
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles["src/app/api/hcm/effective-changes/route.ts"]?.methods.find(m => m.name === "POST");
  assert.ok(method && ["GAP", "COVERED"].includes(method.status));
  if (method.status === "GAP") assert.equal(method.testedBy, null);
  else assert.equal(method.testedBy?.file, "scripts/qa/tenant-hcm-effective-change-post-http.mjs", "method credit belongs in a separately reviewed ledger change");
});

test("guard runs before DB imports; proof demands every dimension, foreign refusals and a real high-ID victim", () => {
  assert.ok(harness.indexOf("requireDisposableHcmEffectiveChangePost();") < harness.indexOf('import("../../src/db/index.ts")'), "refuse before DB import");
  for (const token of ["ATTA", "ATTB", "FILL0", "FILL5", "VICTIM", "victim.org.id > 6", "victim.worker.id > 6", "allEmployerSnapshotsCompared",
    "assert.deepEqual(after[j], before[j]", "eight own pending changes per attacker", "coverageCreditsAdded: 0"]) assert.ok(harness.includes(token), "harness missing: " + token);
  for (const token of ["operating organization unit", "employment type", "employee status", "supervisory organization", "cost center", "manager", "legal employer", "position move",
    "victim organization", "victim operating organization unit", "victim supervisory organization", "victim cost center", "victim manager", "victim legal employer", "victim position",
    "victim employee under own organization id", "occupied position", "position that is not approved", "retroactive position move", "unsupported movement type",
    "position move may not override inherited dimensions", "an employee cannot be their own manager", "a refusal leaks no victim data", "leaves the victim unchanged",
    "exactly one audit receipt", "one business process"]) assert.ok(helper.includes(token), "helper missing: " + token);
  assert.doesNotMatch(helper, /insert\(s\.legalEntities\)/, "a second legal entity would make the workspace multi-entity");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-effective-change-post-http\.mjs/);
  assert.match(workflow, /TENANT_HCM_EFFECTIVE_CHANGE_MODE=fictional-pg16-only/);
  assert.doesNotMatch(workflow, /vercel deploy|db:migrate:production|PAYMONGO_DISBURSEMENTS_ENABLED=true/);
});
