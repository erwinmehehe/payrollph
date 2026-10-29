import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";
import { resolveExplicitEntitySelection } from "../src/lib/multi-entity-selector-boundary";
import { multiEntityHcmRequestDeferred } from "../src/lib/multi-entity-hcm-hold";

const source = readFileSync("src/app/api/hcm/salary-corrections/preview/route.ts", "utf8");

test("salary preview authorizes raw body entity before employee or pay source reads", () => {
  assert.match(source, /resolveMultiEntityContext\(\{\s*userId: user\.id, organizationId, request, requested: body\.legalEntityId as string \| number \| null \| undefined,/);
  assert.match(source, /assertEntityResource\(entityScope\.context, legalEntityId\)/);
  assert.match(source, /assertEntityResource\(entityScope\.context, employee\.legalEntityId\)/);
  assert.match(source, /if \(entityScope\.context\.enabled && entityScope\.context\.group\)/);
  assert.ok(source.indexOf("assertOrganizationRole(") < source.indexOf("resolveMultiEntityContext({"));
  assert.ok(source.indexOf("requireSensitiveActionMfa(user)") < source.indexOf("resolveMultiEntityContext({"));
  assert.ok(source.indexOf("resolveMultiEntityContext({") < source.indexOf("db.select({\n      id: employees.id"));
  assert.ok(source.indexOf("assertEntityResource(entityScope.context, employee.legalEntityId)") <
    source.indexOf("db.select({\n      payBasis: employeePayProfiles.payBasis"));
  assert.match(source, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(source, /employee\.legalEntityId !== legalEntityId/);
  assert.match(source, /eq\(employeePayRevisions\.organizationId, organizationId\)/);
  assert.match(source, /eq\(payrollRuns\.organizationId, organizationId\)/);
  assert.doesNotMatch(source, /\bdb\.(?:insert|update|delete|transaction)\(/);
});

test("organization-wide membership does not authorize a sibling legal employer", () => {
  const decision = decideEntityAccess({
    role: "owner", availableEntityIds: [101, 102], grantedEntityIds: [101],
    requested: 101,
  });
  assert.equal(decision.ok, true);
  assert.equal(entityResourceAllowed(decision, 101), true);
  assert.equal(entityResourceAllowed(decision, 102), false);
  const foreign = decideEntityAccess({
    role: "owner", availableEntityIds: [101, 102], grantedEntityIds: [101],
    requested: 102,
  });
  assert.equal(foreign.ok, false);
  assert.equal(entityResourceAllowed(foreign, 102), false);
  assert.equal(decideEntityAccess({
    role: "owner", availableEntityIds: [101, 102], grantedEntityIds: [], requested: 101,
  }).ok, false);
});

test("body, header and duplicate query selector conflicts fail closed", () => {
  assert.deepEqual(resolveExplicitEntitySelection({
    requested: 101, header: "101", queryValues: ["101"],
  }), { ok: true, requested: 101, explicit: true });
  for (const invalid of [
    { requested: 101, header: "102" },
    { requested: 101, queryValues: ["102"] },
    { requested: 101, queryValues: ["101", "101"] },
    { requested: "0101" },
    { requested: "1e2" },
    { requested: 101, header: "all" },
  ]) assert.equal(resolveExplicitEntitySelection(invalid).ok, false);
});

test("only exact disposable salary preview POST passes the global HCM proxy embargo", () => {
  const env: Record<string, string | undefined> = {
    MULTI_ENTITY_ENABLED: "true", HCM_SALARY_CORRECTION_PREVIEW_ENABLED: "true",
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000", DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  };
  const path = "/api/hcm/salary-corrections/preview";
  assert.equal(multiEntityHcmRequestDeferred(path, "POST", env), false);
  for (const pathname of [
    "/api/hcm", "/api/hcm/employee", "/api/hcm/salary-corrections",
    "/api/hcm/salary-corrections/preview/", "/api/hcm/salary-corrections/preview/anything",
    "/hcm/worker-360",
  ]) assert.equal(multiEntityHcmRequestDeferred(pathname, "POST", env), true, pathname);
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(multiEntityHcmRequestDeferred(path, method, env), true, method);
  }
  for (const [name, value] of [
    ["HCM_SALARY_CORRECTION_PREVIEW_ENABLED", "false"],
    ["GITHUB_ACTIONS", undefined], ["CI", undefined], ["NODE_ENV", "development"],
    ["TENANT_SECOND_PASS_MODE", "normal"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example/app_db"],
    ["SECURITY_SMOKE_URL", "https://production.example"], ["DEMO_MODE", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "secret"], ["XENDIT_SECRET_KEY", "secret"],
    ["STRIPE_SECRET_KEY", "secret"], ["POSTMARK_SERVER_TOKEN", "secret"],
    ["RESEND_API_KEY", "secret"],
  ] as const) assert.equal(
    multiEntityHcmRequestDeferred(path, "POST", {...env, [name]: value}), true, name,
  );
  for (const flag of [undefined, "false", "TRUE"]) {
    assert.equal(multiEntityHcmRequestDeferred("/api/hcm/employee", "POST", {
      ...env, MULTI_ENTITY_ENABLED: flag,
    }), false);
  }
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.match(proxy, /if \(guarded && multiEntityHcmRequestDeferred\(path, request\.method\)\)/);
  assert.match(proxy, /ENTITY_HCM_DEFERRED/);
});
