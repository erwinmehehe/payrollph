import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requireDisposablePriorEvidenceEnv, assertPriorDenied, assertUnchanged,
  assertOwnPriorRead, PRIOR_PATH,
} from "../scripts/qa/tenant-sta01-prior-evidence-contract.mjs";

const safe = () => ({
  CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  YEAR_END_PRIOR_EVIDENCE_ENABLED: "true", MULTI_ENTITY_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true", DEMO_MODE: "false",
  PII_ENCRYPTION_KEY: "abc987".repeat(10) + "abcd",
});

test("STA-01 runner refuses production, providers, CI bypass and unreviewed feature flags", () => {
  const env = safe();
  assert.doesNotThrow(() => requireDisposablePriorEvidenceEnv(env));
  for (const [name, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["TENANT_SECOND_PASS_MODE", "local-run"],
    ["DATABASE_URL", "postgresql://postgres:postgres@neon.example/db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["NODE_ENV", "development"], ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["YEAR_END_PRIOR_EVIDENCE_ENABLED", "false"],
    ["MULTI_ENTITY_ENABLED", "true"], ["DEMO_MODE", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PII_ENCRYPTION_KEY", "0".repeat(64)],
    ["PII_ENCRYPTION_KEY", ""],
    ["PAYMONGO_SECRET_KEY", "unallowed"],
    ["RESEND_API_KEY", "unallowed"],
    ["NEON_DATABASE_URL", "postgresql://somewhere"],
  ]) {
    assert.throws(() => requireDisposablePriorEvidenceEnv({ ...env, [name]: value }),
      /STA01_PRIOR_REFUSED/, name + " cannot be permitted");
  }
});

test("real source route binds employer/worker and current MFA before prior tax decryption or mutation", () => {
  const route = readFileSync("src/app/api/year-end/prior-evidence/route.ts", "utf8");
  const server = readFileSync("src/lib/year-end-prior-evidence-server.ts", "utf8");
  assert.match(route, /export const GET = respond;[\s\S]*?export const POST = respond/);
  assert.match(route, /assertOrganizationRole\(user\.id, scope\.organizationId, PAYROLL_OPERATOR_ROLES\)/);
  assert.match(route, /getAccess\(user\.id, scope\.organizationId\)/);
  assert.match(route, /requireSensitiveActionMfa\(user\)/);
  assert.match(route, /enforceSameOriginMutation\(request\)/);
  assert.ok(route.indexOf("assertOrganizationRole(user.id") < route.indexOf("priorIntake(scope"),
    "Never load or mutate tax evidence before actor organization authorization");
  assert.match(server, /resolveMultiEntityContext\(\{[\s\S]*?organizationId: scope\.organizationId/);
  assert.match(server, /eq\(employees\.id, scope\.employeeId\)/);
  assert.match(server, /eq\(employees\.organizationId, scope\.organizationId\)/);
  assert.match(server, /eq\(yearEndPriorEvidence\.organizationId, scope\.organizationId\)/);
  assert.match(server, /eq\(yearEndPriorEvidence\.employeeId, scope\.employeeId\)/);
  assert.match(server, /assertEntityResource\(entityScope\.context, employeeScope\.legalEntityId\)/);
  assert.match(server, /assertPriorApproval\(/);
  assert.match(server, /isolationLevel: "serializable"/);
});

test("runner refuses unsafe environments before any DB import and proves both POST branches", () => {
  const script = readFileSync("scripts/qa/tenant-sta01-prior-evidence-http.mjs", "utf8");
  assert.ok(script.indexOf("requireDisposablePriorEvidenceEnv();") <
    script.indexOf('import("../../src/db/index.ts")'),
  "No DB or runtime module may load before disposable-only guard");
  assert.match(script, /for \(const label of \["ATTA", "ATTB", "VICTIM"\]\)/);
  assert.match(script, /victim\.priorId > a\.priorId && victim\.priorId > b\.priorId/);
  for (const word of ["foreignRead", "foreignSave", "foreignApprove",
    "forgedRead", "forgedSave", "stale digest approval", "maker self-approval",
    "sourceDigest", "encryptedEvidence", "checkerUserId", "auditBusinessSnapshot",
    "snapshotAll", "assertUnchanged"]) {
    assert.ok(script.includes(word), "Required proof branch missing: " + word);
  }
  assert.match(script, /action: "save"/);
  assert.match(script, /action: "approve"/);
  assert.match(script, /coverageCredits: 0/);
  assert.match(script, /productionCertified: false/);
  assert.match(script, /moneyMoved: false/);
  assert.match(PRIOR_PATH, /^\/api\/year-end\/prior-evidence$/);
});

test("negative and owned-positive assertions reject empty, wrong-tenant and leaking responses", () => {
  const victim = {
    marker: "VICTIM-PRIVATE", reference: "VICTIM-PRIVATE evidence",
    sha: "f".repeat(64),
  };
  assert.doesNotThrow(() => assertPriorDenied(
    { status: 403, text: '{"error":"Forbidden"}' }, 403, victim, "safe"));
  for (const status of [200, 404, 409]) {
    assert.throws(() => assertPriorDenied(
      { status, text: '{"error":"Forbidden"}' }, 403, victim, "unsafe"));
  }
  for (const leaked of [victim.marker, victim.reference, victim.sha]) {
    assert.throws(() => assertPriorDenied(
      { status: 403, text: leaked }, 403, victim, "leak"));
  }
  const employer = {
    label: "ATTA", reference: "ATTA private evidence", sha: "b".repeat(64),
    income: "10000.00", withheld: "100.00",
    priorEmployerName: "ATTA prior employer", owner: { id: 42 },
  };
  const json = { record: {
    revision: 1, approved: false, makerUserId: 42, digest: "c".repeat(64),
    evidence: {
      status: "verified", sourceReference: employer.reference,
      sourceSha256: employer.sha, taxableIncome: employer.income,
      taxWithheld: employer.withheld, employerName: employer.priorEmployerName,
      employerTin: "123456789-0000", peraCredit: "0.00",
    },
  } };
  assert.doesNotThrow(() => assertOwnPriorRead({ status: 200, json, text: "" },
    employer, 1, false));
  assert.throws(() => assertOwnPriorRead({ status: 200, json: { record: null },
    text: "" }, employer, 1, false));
  assert.throws(() => assertOwnPriorRead({ status: 200, json, text: "" },
    { ...employer, reference: "another employer" }, 1, false));
  assert.throws(() => assertUnchanged([{ id: 1 }], [{ id: 2 }], "victim"));
});
