import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableMweDecision, requireDecisionPositive, requireTenantDenial,
} from "../scripts/qa/tenant-mwe-decision-contract.mjs";

const sourcePath = "src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts";
const libPath = "src/lib/mwe-classification.ts";
function sha(source) {
  return createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex");
}
function baseline() {
  return {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_MWE_DECISION_MODE: "isolated-ci-only",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: "https://payroll.example.test",
    MULTI_ENTITY_ENABLED: "true", REQUIRE_PRIVILEGED_MFA: "true",
    DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
}
test("synthetic MWE test profile fails closed on unsafe environment and provider credentials", () => {
  const env = baseline();
  assert.doesNotThrow(() => requireDisposableMweDecision(env));
  for (const [key, bad] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"], ["NODE_ENV", "development"],
    ["DATABASE_URL", "postgresql://admin@prod.internal/payroll"],
    ["SECURITY_SMOKE_URL", "https://production.example.com"],
    ["MULTI_ENTITY_ENABLED", "false"], ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["TENANT_MWE_DECISION_MODE", ""], ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "live-test-secret"], ["OPENAI_API_KEY", "fake"],
  ]) {
    assert.throws(() => requireDisposableMweDecision({ ...env, [key]: bad }),
      /MWE_DECISION_REFUSED/, key);
  }
});
test("MWE endpoint hides foreign/unknown global IDs and verifies selected employer before writes", () => {
  const source = readFileSync(sourcePath, "utf8");
  const lib = readFileSync(libPath, "utf8");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles[sourcePath];
  assert.equal(entry.gitBlobSha, sha(source));
  assert.equal(entry.methods.find(m => m.name === "PATCH")?.status, "COVERED");
  assert.match(source, /innerJoin\(userOrganizations/);
  assert.match(source, /eq\(userOrganizations\.active, true\)/);
  assert.match(source, /const classification = visible\?\.classification/);
  assert.match(source, /resolveMultiEntityContext\(/);
  assert.match(source, /assertEntityResource\(entity\.context, employee\.legalEntityId\)/);
  assert.match(source, /expectedLegalEntityId: entity\.context\.enabled/);
  assert.ok(source.indexOf("innerJoin(userOrganizations") < source.indexOf("assertOrganizationRole("));
  assert.ok(source.indexOf("assertEntityResource(entity.context") < source.indexOf("decideMweClassificationRequest({"));
  assert.match(lib, /\.for\("share"\)\.limit\(1\)/);
  assert.match(lib, /employee\.legalEntityId !== input\.expectedLegalEntityId/);
  assert.match(lib, /kind: "forbidden" as const, message: "Legal employer is not available/);
  // No class-ID existence oracle for active noncheckers or ungranted employers.
  assert.match(source, /inArray\(userOrganizations\.role, \[\.\.\.PAYROLL_TAX_APPROVER_ROLES\]\)/);
  assert.ok(source.indexOf("requireSensitiveActionMfa(user)") < source.indexOf("innerJoin(userOrganizations"),
    "MFA must run before resolving any globally addressed tax classification");
  for (const denied of [
    "if (denied) return classificationNotFound();",
    "if (scopeDenied) return classificationNotFound();",
    "if (!entity.ok) return classificationNotFound();",
    "if (employerDenied) return classificationNotFound();",
    'if (result.kind === "not_found" || result.kind === "forbidden") return classificationNotFound();',
  ]) assert.ok(source.includes(denied), "all private denials must hide resource existence: " + denied);
  // Concurrency: the approval transaction locks active membership, custom
  // overlays, legal-employer grant and employee before any tax/payroll write.
  for (const token of [
    'eq(userOrganizations.userId, input.decidedByUserId)',
    'eq(userOrganizations.organizationId, input.organizationId)',
    ')).for("update").limit(1);',
    'PAYROLL_TAX_APPROVER_ROLES.some(role => role === membership.role)',
    'membership.orgUnitId !== employee.orgUnitId',
    'permissionOverlayKeysValid(permissionSet.permissions, ROLE_GATE_PERMISSIONS)',
    'permissionOverlayGroupBindingValid(assignment)',
    'group.version !== assignment.dynamicGroupVersion',
    'eq(userLegalEntityGrants.userId, input.decidedByUserId)',
    'eq(userLegalEntityGrants.legalEntityId, input.expectedLegalEntityId)',
    'eq(legalEntities.active, true)',
    'if (!grant || !entity) return permissionDenied();',
  ]) assert.ok(lib.includes(token), "transactional authorization guard missing " + token);
});
test("proof contract rejects false own-success, empty authorization and privacy leaks", () => {
  const employer = { org: { id: 10 }, worker: { id: 13 } };
  const record = { id: 17 };
  const good = { status: 200, json: { kind: "approved", classification: {
    id: 17, organizationId: 10, employeeId: 13, status: "approved",
  } } };
  assert.doesNotThrow(() => requireDecisionPositive(good, employer, record, "approved"));
  assert.throws(() => requireDecisionPositive({ ...good, status: 403 }, employer, record, "approved"));
  assert.throws(() => requireDecisionPositive({
    ...good, json: { ...good.json, classification: { ...good.json.classification, organizationId: 99 } },
  }, employer, record, "approved"));
  assert.doesNotThrow(() => requireTenantDenial({ status: 404, text: "unknown", json: {} }, [404], ["VICTIM"]));
  assert.throws(() => requireTenantDenial({ status: 404, text: "VICTIM", json: {} }, [404], ["VICTIM"]));
  assert.throws(() => requireTenantDenial({ status: 200, text: "unknown", json: {} }, [404], ["VICTIM"]));
});
test("four-part real-HTTP fixture is nonempty, two-actor and source-pinned", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles[sourcePath].methods[0];
  const proof = method.testedBy;
  assert.ok(proof && proof.file === "scripts/qa/tenant-mwe-decision-http.mjs");
  assert.equal(proof.routeBlobSha, manifest.allApiRouteFiles[sourcePath].gitBlobSha);
  for (const [path, expectedSha] of [
    [sourcePath, proof.routeBlobSha],
    [libPath, proof.libraryBlobSha],
    [proof.file, proof.proofBlobSha],
    [proof.contractFile, proof.contractBlobSha],
    [proof.workflowFile, proof.workflowBlobSha],
  ]) {
    assert.equal(sha(readFileSync(path, "utf8")), expectedSha,
      path + " changed after the reviewed tenant proof");
  }
  const lines = readFileSync(proof.file, "utf8").split("\n");
  for (const key of ["line", "ownPositiveLine", "foreignDenialLine",
    "forgedSelectorLine", "unchangedDbLine", "victimIdOrderingLine"]) {
    assert.ok(Number.isInteger(proof[key]) && lines[proof[key] - 1], "Missing " + key);
  }
  assert.match(lines[proof.ownPositiveLine - 1], /const ownPositive = await decision/);
  assert.match(lines[proof.foreignDenialLine - 1], /const foreignDenial = await decision/);
  assert.match(lines[proof.forgedSelectorLine - 1], /const forgedSelector = await decision/);
  assert.match(lines[proof.unchangedDbLine - 1], /assert\.deepEqual\(await snapshot\(victim\.org\.id\)/);
  assert.match(lines[proof.victimIdOrderingLine - 1], /victim\.records\[0\]\.id > Math\.max\(6,/);
  assert.match(lines.join("\n"), /for \(const attacker of attackers\)/);
  assert.match(lines.join("\n"), /requireDecisionPositive\(ownPositive/);
  assert.match(lines.join("\n"), /requireDecisionPositive\(ownReject/);
  assert.match(lines.join("\n"), /assert\.equal\(foreignDenial\.text, unknown\.text/);
  const workflow = readFileSync(proof.workflowFile, "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-mwe-decision-http\.mjs/);
  assert.equal(proof.independentlyAccepted, false);
  assert.equal(proof.productionCertified, false);
});

test("real HTTP MWE proof compares active nonchecker, ungranted employer and unknown IDs", () => {
  const proofSource = readFileSync("scripts/qa/tenant-mwe-decision-http.mjs", "utf8");
  for (const token of [
    "assert.equal(wrongEmployer.text, unknownSecond.text",
    "assert.equal(ungrantedEmployer.text, unknownSelected.text",
    "assert.equal(knownButForbidden.text, missingForNonChecker.text",
    "unauthorizedRoleUnknownEquivalent: true",
    "ungrantedEmployerUnknownEquivalent: true",
  ]) assert.ok(proofSource.includes(token), "real HTTP privacy proof must include " + token);
});
