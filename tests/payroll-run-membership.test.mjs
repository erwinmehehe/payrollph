import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

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

test("payroll proof workflows rerun when their shared membership boundary changes", () => {
  for (const file of readdirSync(".github/workflows").filter(file => file.endsWith(".yml"))) {
    const workflow = load(read(".github/workflows/" + file)), paths = workflow.on?.pull_request?.paths;
    if (paths?.some(path => path.includes("src/app/api/payroll-runs")))
      assert.ok(paths.includes("src/lib/payroll-run-membership.ts"), file + ": missing shared authorization dependency");
  }
});

test("multi-entity preflight has Git history for exact source-withdrawal receipts", () => {
  const workflow = load(read(".github/workflows/multi-entity-browser-qa.yml"));
  const checkout = workflow.jobs["multi-entity-browser"].steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with["persist-credentials"], false);
});
