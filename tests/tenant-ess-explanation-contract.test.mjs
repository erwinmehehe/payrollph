import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ROUTE, ROUTE_BLOB, requireIsolatedEssExplainProof } from
  "../scripts/qa/tenant-ess-explanation-contract.mjs";
const digest = path => {
  const b = readFileSync(path);
  return createHash("sha1").update(Buffer.from("blob " + b.length + "\0"))
    .update(b).digest("hex");
};
test("changed employee-only route remains source pinned, without new coverage credit", () => {
  assert.equal(digest(ROUTE), ROUTE_BLOB);
  const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = m.allApiRouteFiles[ROUTE];
  const get = entry.methods.find(x => x.name === "GET");
  assert.equal(entry.gitBlobSha, ROUTE_BLOB);
  assert.equal(get.status, "COVERED", "Do not silently reclassify historical proof");
  assert.equal(get.sourceRevalidation.currentSourceBlobSha, ROUTE_BLOB);
  assert.equal(get.sourceRevalidation.priorSourceBlobSha,
    "a8e142ca7ac1a81a080d7fb5ac70ef79007dfcfc");
  assert.equal(get.sourceRevalidation.historicalProofNotPortable, true);
  assert.equal(get.sourceRevalidation.newMethodCredits, 0);
  assert.equal(get.sourceRevalidation.accepted, false);
});
test("refuse real providers, remote DB/server, workers and implicit multi-entity flags", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_ESS_EXPLAIN_PROOF: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", MULTI_ENTITY_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireIsolatedEssExplainProof(safe));
  for (const [key, value] of [
    ["CI", "false"], ["DATABASE_URL", "postgresql://db.example.invalid/payroll"],
    ["SECURITY_SMOKE_URL", "https://production.invalid"],
    ["MULTI_ENTITY_ENABLED", ""], ["WORKER_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["PAYMONGO_SECRET_KEY", "fake"],
  ]) assert.throws(() => requireIsolatedEssExplainProof({ ...safe, [key]: value }),
    /ESS_EXPLAIN_REFUSED/, key);
});
test("real HTTP proof exercises two employees, higher-ID victim, both entities and revoked membership", () => {
  const source = readFileSync("scripts/qa/tenant-ess-explanation-http.mjs", "utf8");
  for (const token of [
    "requireIsolatedEssExplainProof();",
    'seedEmployer("EA"', 'seedEmployer("EB"', 'seedEmployer("EV"',
    "actor.runs[2].id", "own.json?.explanation?.previousNet",
    "await request(foreign.entries[3].id, cookie)",
    "await request(foreign.entries[3].id + 100000, cookie)",
    "await request(actor.entries[2].id, cookie)",
    "assert.deepEqual(await snapshot(), before",
    "active: false", "newMethodCredits: 0",
  ]) assert.ok(source.includes(token), "Missing mandatory proof: " + token);
  assert.ok(source.indexOf("requireIsolatedEssExplainProof();") <
    source.indexOf('import("../../src/db/index.ts")'),
    "The guard must execute before any database import");
  const wf = readFileSync(".github/workflows/tenant-ess-explanation-http.yml", "utf8");
  assert.ok(wf.includes('      - "src/app/api/self/payslips/**"'), "Every payslip route change must trigger the PG16 proof");
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-ess-explanation-http\.mjs/);
  assert.match(wf, /multiEntity: \["false", "true"\]/);
  assert.match(wf, /npm start -- -H 127\.0\.0\.1/);
});
