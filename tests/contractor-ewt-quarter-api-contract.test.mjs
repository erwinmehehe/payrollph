import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = "src/app/api/contractors/ewt-quarter/route.ts";
const source = readFileSync(route, "utf8");

/** Strict source contract; not a substitute for executable PG16 HTTP proof. */
function assertGuardContract(text) {
  assert.match(text, /const denied = await assertOrganizationRole\(/,
    "An authenticated payroll role check is mandatory");
  assert.match(text, /if \(!access\?\.companyWide\)/,
    "Company-wide membership is mandatory");
  assert.equal((text.match(/eq\(legalEntities\.organizationId, organizationId\)/g) ?? []).length, 2,
    "Both legal-employer lookup and active-employer ambiguity check must be tenant-scoped");
  assert.match(text, /activeEmployers\.length !== 1/,
    "Unattributed payments must refuse multi-employer ambiguity");
  assert.match(text, /rows\.some\(\(\{ contractor \}\) => !contractor \|\| contractor\.organizationId !== organizationId\)/,
    "An imported foreign payee must fail closed before schedule construction");
  const response = text.slice(text.indexOf("return Response.json({\n    ...schedule"));
  assert.ok(response.startsWith("return Response.json({\n    ...schedule"), "Find the actual schedule response");
  assert.match(response, /filingReady: false/,
    "The EWT response must never claim filing readiness");
  assert.doesNotMatch(response, /filingReady: true/,
    "No certified filing declaration is permitted");
}

test("source guards are present before quarterly schedule serialization", () => {
  assertGuardContract(source);
  assert.match(source, /sourceSchedule: true/);
  assert.match(source, /not a BIR filing/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/,
    "The new report cannot change payroll or contractor records");
});

const mutants = [
  ["removed role scope check", "const denied = await assertOrganizationRole(", "const denied = null; /* role gate removed */ ("],
  ["removed legal-employer owner predicate", "eq(legalEntities.organizationId, organizationId)", "eq(legalEntities.id, legalEntityId)"],
  ["filingReady flipped true", "filingReady: false,\n    note:", "filingReady: true,\n    note:"],
  ["foreign payee allowed to leak", "rows.some(({ contractor }) => !contractor || contractor.organizationId !== organizationId)",
    "false /* cross-employer attribution check removed */"],
];

for (const [name, from, to] of mutants) {
  test("mutation caught: " + name, () => {
    assert.ok(source.includes(from), "Mutation must target a live, exact source span");
    const mutated = source.replace(from, to);
    assert.notEqual(mutated, source);
    assert.throws(() => assertGuardContract(mutated), assert.AssertionError,
      "The guard contract must fail when its guard is removed");
  });
}
