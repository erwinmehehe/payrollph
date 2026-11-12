import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(path, "utf8");
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path + "/" + entry.name) : entry.name === "route.ts" ? [path + "/" + entry.name] : []);

test("run lookup binds active membership to the persisted run employer in one query", () => {
  const source = read("src/lib/payroll-run-membership.ts");
  for (const predicate of [
    "eq(userOrganizations.organizationId, payrollRuns.organizationId)",
    "eq(userOrganizations.userId, userId)", "eq(userOrganizations.active, true)",
    "eq(payrollRuns.id, runId)", "return row?.run ?? null",
  ]) assert.ok(source.includes(predicate), predicate);
  assert.ok(source.includes(".innerJoin(userOrganizations, and("));
  assert.ok(!source.includes("organizationId:"), "no caller-selected employer can replace persisted ownership");
  assert.ok(!source.includes("userOrganizations.role"), "members without the payroll role still reach the existing 403 gate");
  assert.ok(source.indexOf("Number.isSafeInteger") < source.indexOf("await db.select"));
});

test("every addressed payroll-run route uses the membership lookup before its existing role gate", () => {
  const paths = walk("src/app/api/payroll-runs/[id]");
  assert.equal(paths.length, 14);
  for (const path of paths) {
    const source = read(path);
    assert.ok(source.includes("await findPayrollRunForMember("), path);
    assert.ok(!/const \[run\] = await db\.select\(\)\.from\(payrollRuns\)/.test(source), path + ": unscoped initial lookup");
    const lookup = source.indexOf("await findPayrollRunForMember(");
    const gate = Math.min(...["await assertOrganizationRole(", "await authorizeTreasuryOperation("].map(x => source.indexOf(x)).filter(x => x >= 0));
    assert.ok(lookup < gate, path + ": existing role/treasury gate must remain after member resolution");
    assert.ok(source.includes("assertOrganizationUnitAccess"), path + ": unit authorization retained");
    if (source.includes("requireRunEmployer"))
      assert.ok(source.includes("legalEntityId: run.legalEntityId"), path + ": persisted legal-employer authorization retained");
  }
});

test("root runId lookup and process authentication cannot expose a foreign or anonymous existence oracle", () => {
  const root = read("src/app/api/payroll-runs/route.ts");
  assert.ok(root.includes("const target = await findPayrollRunForMember(sessionUser.id, runId)"));
  const source = read("src/app/api/payroll-runs/[id]/process/route.ts");
  assert.ok(source.indexOf("await getSessionUser()") < source.indexOf("await findPayrollRunForMember("));
  assert.ok(source.indexOf('status: 401') < source.indexOf("await findPayrollRunForMember("));
});
