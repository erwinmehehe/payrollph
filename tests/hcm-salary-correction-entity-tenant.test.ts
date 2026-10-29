import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";
import { resolveExplicitEntitySelection } from "../src/lib/multi-entity-selector-boundary";

const source = readFileSync("src/app/api/hcm/salary-corrections/preview/route.ts", "utf8");

test("salary preview authorizes raw body entity before employee or pay source reads", () => {
  assert.match(source, /resolveMultiEntityContext\(\{\s*userId: user\.id, organizationId, request, requested: body\.legalEntityId as string \| number \| null \| undefined,/);
  assert.match(source, /assertEntityResource\(entityScope\.context, legalEntityId\)/);
  assert.match(source, /assertEntityResource\(entityScope\.context, employee\.legalEntityId\)/);
  assert.match(source, /if \(entityScope\.context\.group\)/);
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
