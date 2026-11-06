import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableMweDecision, MWE_DECISION_METHOD, MWE_DECISION_SOURCE_SHA,
} from "../scripts/qa/tenant-mwe-decision-patch-contract.mjs";

const runner = readFileSync("scripts/qa/tenant-mwe-decision-patch-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-mwe-decision-patch-http.yml", "utf8");
const route = readFileSync("src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts");

function blobSha(bytes) {
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
}
function validEnv() {
  return {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_MWE_DECISION_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
}

test("the proof never runs against a real database, server or provider", () => {
  assert.equal(requireDisposableMweDecision(validEnv()), true);
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: "false", DATABASE_URL: "postgresql://db.external:5432/app_db",
    SECURITY_SMOKE_URL: "https://localhost:3000", TENANT_SECOND_PASS_MODE: "prod",
    TENANT_MWE_DECISION_MODE: "", WORKER_ENABLED: "true",
    CENTRAL_SCHEDULER_ENABLED: "true", PAYMONGO_DISBURSEMENTS_ENABLED: "true",
    XENDIT_BILLING_ENABLED: "true", XENDIT_PAYOUTS_ENABLED: "true",
  })) {
    assert.throws(() => requireDisposableMweDecision({ ...validEnv(), [name]: value }));
  }
  for (const key of ["NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.throws(() => requireDisposableMweDecision({ ...validEnv(), [key]: "not-allowed" }));
  }
});

test("older no-credit MWE proof is historical when the route is superseded", () => {
  assert.equal(MWE_DECISION_METHOD,
    "src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts PATCH");
  const currentRouteSha = blobSha(route);
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const path = MWE_DECISION_METHOD.replace(/ PATCH$/, "");
  const entry = manifest.allApiRouteFiles[path];
  const method = entry?.methods.find(m => m.name === "PATCH");
  assert.ok(method, "the MWE PATCH must remain individually classified");
  assert.match(route.toString("utf8"), /export async function PATCH/);
  assert.match(route.toString("utf8"), /PAYROLL_TAX_APPROVER_ROLES/);
  assert.match(route.toString("utf8"), /assertOrganizationUnitAccess/);
  assert.match(route.toString("utf8"), /requireSensitiveActionMfa/);
  if (currentRouteSha === MWE_DECISION_SOURCE_SHA) {
    assert.equal(method.status, "GAP", "historical uncredited source remains a GAP");
    assert.equal(method.testedBy, null);
  } else {
    // #1767's old route hash is not evidence for #1766's changed handler.
    // The only permissible provisional credit is the independent exact-source #1766 receipt.
    assert.equal(method.status, "COVERED");
    assert.equal(entry.gitBlobSha, currentRouteSha);
    assert.equal(method.testedBy?.routeBlobSha, currentRouteSha);
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-mwe-decision-http.mjs");
    assert.equal(method.testedBy?.independentlyAccepted, false);
    assert.equal(method.testedBy?.productionCertified, false);
    assert.notEqual(method.testedBy?.file, "scripts/qa/tenant-mwe-decision-patch-http.mjs");
  }
});

test("guard executes before DB imports; proof demands both decisions and real immutable high-ID victim", () => {
  assert.ok(runner.indexOf("requireDisposableMweDecision();") <
    runner.indexOf('import("../../src/db/index.ts")'), "refuse before DB import");
  for (const token of [
    "ATTA", "ATTB", "FILL0", "FILL5", "VICTIM",
    "victim.org.id > 6", "victim.worker.id > 6", "victim.pending.id > 6",
    "assertAllExceptUnchanged", "assert.deepEqual(await snapshots(), before",
    "independent checker", "maker self-approval", "foreign employer denial",
    "swapped classification path", "revoked checker grant", "approve", "reject",
    "payrollRuns", "auditEvents", "coverageCreditsAdded: 0",
  ]) assert.ok(runner.includes(token), "missing proof invariant: " + token);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-mwe-decision-patch-http\.mjs/);
  assert.match(workflow, /TENANT_MWE_DECISION_MODE=fictional-pg16-only/);
  assert.doesNotMatch(workflow, /vercel deploy|db:migrate:production|PAYMONGO_DISBURSEMENTS_ENABLED=true/);
});
