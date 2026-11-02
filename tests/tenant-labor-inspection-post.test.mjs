import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableLaborInspection, assertPrivateDenial,
  assertImmutable, LABOR_INSPECTION_POST,
} from "../scripts/qa/tenant-labor-inspection-post-contract.mjs";

const safe = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_LABOR_INSPECTION_MODE: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", MULTI_ENTITY_ENABLED: "false",
});

test("labor inspection proof refuses remote hosts, production credentials and enabled money", () => {
  assert.doesNotThrow(() => requireDisposableLaborInspection(safe()));
  const refused = changes => assert.throws(
    () => requireDisposableLaborInspection({ ...safe(), ...changes }),
    /LABOR_INSPECTION_PROOF_REFUSED/);
  refused({ GITHUB_ACTIONS: "false" });
  refused({ CI: "false" });
  refused({ DATABASE_URL: "postgresql://user:pw@neon.invalid/prod" });
  refused({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" });
  refused({ SECURITY_SMOKE_URL: "https://payroll.example.test" });
  refused({ TENANT_LABOR_INSPECTION_MODE: "real" });
  refused({ PAYMONGO_DISBURSEMENTS_ENABLED: "true" });
  refused({ MULTI_ENTITY_ENABLED: "true" });
  refused({ REQUIRE_PRIVILEGED_MFA: "false" });
  refused({ NEON_DATABASE_URL: "postgresql://live.invalid" });
  refused({ PAYMONGO_SECRET_KEY: "sk_live_not_allowed" });
});

test("denial rejects leaked victim marker, SQL diagnostics and wrong status", () => {
  const response = {
    status: 403, text: '{"error":"Authorized employer required."}',
    json: { error: "Authorized employer required." },
  };
  assertPrivateDenial(response, 403, ["VICTIM-FICTIONAL"]);
  assert.throws(() => assertPrivateDenial({ ...response, status: 404 }, 403));
  assert.throws(() => assertPrivateDenial({
    ...response, text: response.text + "VICTIM-FICTIONAL",
  }, 403, ["VICTIM-FICTIONAL"]));
  assert.throws(() => assertPrivateDenial({
    ...response, text: response.text + "SELECT * FROM audit_events",
  }, 403));
  assertImmutable({ audit: [], payroll: [1] }, { audit: [], payroll: [1] }, "synthetic");
  assert.throws(() => assertImmutable({ audit: [], payroll: [1] },
    { audit: [], payroll: [2] }, "synthetic"));
});

test("one real POST, two-actor PG16 HTTP proof and audit rollback are still zero-credit", () => {
  assert.equal(LABOR_INSPECTION_POST, "POST compliance/labor-inspection");
  const runner = readFileSync("scripts/qa/tenant-labor-inspection-post-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-labor-inspection-post-http.yml", "utf8");
  assert.ok(runner.indexOf("requireDisposableLaborInspection();") <
    runner.indexOf('import("../../src/db/index.ts")'), "guard must precede database import");
  for (const marker of [
    'seedEmployer("ATTA"',
    'seedEmployer("ATTB"',
    'seedEmployer("VICTIM"',
    '"PAY_PROFILE_MISSING"',
    'for (const actor of [a, b])',
    'for (const e of all)',
    'ci_labor_inspection_audit_veto',
    'assertPrivateDenial(stolen, 409',
    'assert.equal(stolen.text, unknown.text',
    'assert.equal(after[e.label].audit.length, before[e.label].audit.length + 1)',
    'methodCoverageCredit: false',
  ]) assert.ok(runner.includes(marker), "actual proof must retain " + marker);
  assert.ok(workflow.includes("postgres:16"));
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-labor-inspection-post-http.mjs"));
  assert.ok(workflow.includes('PAYMONGO_DISBURSEMENTS_ENABLED: "false"'));
  assert.ok(workflow.includes('MULTI_ENTITY_ENABLED: "false"'));
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/compliance/labor-inspection/route.ts"];
  assert.deepEqual(entry.methods.map(m => [m.name, m.status]),
    [["GET", "COVERED"], ["POST", "GAP"]]);
  assert.equal(entry.methods.find(m => m.name === "POST")?.testedBy, null);
});
