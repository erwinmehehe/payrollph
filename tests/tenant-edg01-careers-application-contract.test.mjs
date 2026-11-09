import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  METHOD, NOTICE_VERSION, requireDisposableApplicationEnv,
  assertPublicReply, assertUnchanged, assertApplicationTransition,
} from "../scripts/qa/tenant-edg01-careers-application-contract.mjs";

const fictionalEnv = Object.freeze({
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", MULTI_ENTITY_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  RECRUITMENT_JOURNEY_UI_ENABLED: "true", PUBLIC_INTAKE_PROOF_ENABLED: "true",
  APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
  CAREERS_PRIVACY_NOTICE_VERSION: NOTICE_VERSION,
  CAREERS_PRIVACY_NOTICE_URL: "https://payroll.example.test/privacy/recruitment",
  TRUSTED_PROXY_HOPS: "1",
  PUBLIC_INTAKE_PROOF_SECRET: "ci-fictitious-application-secret-at-least-32-bytes",
});

test("EDG-01 applicant proof guards reject live, external and misconfigured targets", () => {
  assert.equal(METHOD, "POST /api/careers");
  assert.doesNotThrow(() => requireDisposableApplicationEnv(fictionalEnv));
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.production.example/app_db"],
    ["SECURITY_SMOKE_URL", "https://public.example"],
    ["MULTI_ENTITY_ENABLED", "true"],
    ["WORKER_ENABLED", "true"],
    ["PUBLIC_INTAKE_PROOF_ENABLED", "false"],
    ["APPLICANT_PRIVACY_CONTROLS_ENABLED", "false"],
    ["TRUSTED_PROXY_HOPS", "0"],
    ["CAREERS_PRIVACY_NOTICE_VERSION", "changed"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["RESEND_API_KEY", "realsvc-secret"],
  ]) {
    assert.throws(() => requireDisposableApplicationEnv({
      ...fictionalEnv, [key]: value,
    }), undefined, "must reject unsafe " + key);
  }
  assert.throws(() => requireDisposableApplicationEnv({
    ...fictionalEnv, PUBLIC_INTAKE_PROOF_SECRET: "",
  }));
});

test("public intake receipts do not pretend anonymous applicants are tenant-authenticated", () => {
  const headers = new Headers({ "cache-control": "no-store" });
  const success = { status: 202, json: { received: true },
    text: '{"received":true}', headers };
  assert.doesNotThrow(() => assertPublicReply(success, 202, ["VICTIM-PRIVATE"]));
  assert.throws(() => assertPublicReply({
    ...success, json: { received: true, applicantId: 88 },
  }, 202));
  assert.doesNotThrow(() => assertPublicReply({
    status: 404, json: { error: "Careers portal not available." },
    text: '{"error":"Careers portal not available."}', headers,
  }, 404, ["VICTIM-PRIVATE"]));
  assert.throws(() => assertPublicReply({
    status: 404, json: { error: "No", email: "victim@example.invalid" },
    text: '{"error":"No","email":"victim@example.invalid"}', headers,
  }, 404, ["VICTIM-PRIVATE"]));
});

test("reject mutation of another employer's applicant and audit snapshot", () => {
  const before = { applicants: [{ id: 1, organizationId: 1 }],
    privacy: [{ id: 1, organizationId: 1 }],
    jobs: [], audits: [], payroll: [] };
  assert.doesNotThrow(() => assertUnchanged(before, structuredClone(before), "safe denial"));
  assert.throws(() => assertUnchanged(before, {
    ...before, applicants: [{ id: 1, organizationId: 1 }, { id: 9, organizationId: 2 }],
  }, "foreign ID injection"));
  assert.throws(() => assertApplicationTransition(before, before,
    { org: { id: 1 }, job: { id: 2 } },
    { fullName: "Fixture", email: "fixture@example.invalid" }),
  "a 202 without persisted applicant and privacy evidence is not proof");
});

test("new family is standalone, source-guarded and remains zero-credit", () => {
  const runner = readFileSync("scripts/qa/tenant-edg01-careers-application-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-edg01-careers-application-http.yml", "utf8");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const current = manifest.allApiRouteFiles["src/app/api/careers/route.ts"].methods
    .find(method => method.name === "POST");
  assert.equal(current?.status, "PUBLIC-BY-DESIGN", "owner-approved public intake is not tenant-private COVERED");
  assert.equal(current?.publicBoundary?.fourPartMethodCredit, false);
  assert.equal(current?.publicBoundary?.approvedOn, "2026-11-09");
  assert.equal(current?.testedBy, null);
  assert.ok(runner.indexOf("requireDisposableApplicationEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
  "guard must execute before any dynamic DB import");
  for (const phrase of [
    "server_version_num", "organizations: 0, users: 0, audits: 0",
    '"ATTA", "ATTB", "VICTIM"', "victim.job.id > 6",
    '"update job_requisitions set careers_published=true',
    '"/api/intake-challenge"', '"/api/careers"',
    "assertApplicationTransition", "assertUnchanged", "deniedPairs",
    "duplicateSuppressed: true", "replayRefused: true",
    "ci_edg01_app_audit_veto_hits", "sequence.rows[0].is_called",
    "independentReviewPending: true", "coverageCredits: 0",
  ]) assert.ok(runner.includes(phrase), "missing concrete application guard: " + phrase);
  for (const phrase of [
    "postgres:16", "npm run db:push", "--migrate",
    "-H 127.0.0.1", "npm run build", "PUBLIC_INTAKE_PROOF_SECRET",
    "RECRUITMENT_JOURNEY_UI_ENABLED: 'true'",
    "WORKER_ENABLED: 'false'", "TRUSTED_PROXY_HOPS: '1'",
    "tenant-edg01-careers-application-http.mjs",
  ]) assert.ok(workflow.includes(phrase), "missing disposable workflow gate: " + phrase);
  assert.ok(!runner.includes("process.env.DATABASE_URL ="),
    "do not override a target database in the proof runner");
  assert.ok(!workflow.includes("deploy") && !workflow.includes("push --force"),
    "proof-only CI must not deploy or move production refs");
});
