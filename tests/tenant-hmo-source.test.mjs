// Source contract only: real HTTP/PG16 CI is a separate required acceptance gate.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const suite = readFileSync("scripts/qa/tenant-hmo-http.mjs", "utf8");
const route = readFileSync("src/app/api/benefits/hmo/route.ts", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const actions = ["create_plan", "add_dependent", "update_dependent", "update_enrollment"];

test("all HMO POST actions, not just a single example, are in this proof batch", () => {
  assert.deepEqual([...route.matchAll(/if \(action === "([a-z_]+)"\)/g)].map(m => m[1]).sort(), actions.toSorted());
  const declared = suite.match(/HMO_ACTIONS = Object.freeze\(\[([^\]]+)\]\)/)?.[1];
  assert.deepEqual([...declared.matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort(), actions.toSorted());
  for (const action of actions) assert.ok(suite.includes('action: "' + action + '"'));
  assert.match(suite, /for \(const body of actionBodies\(victim, target,/);
  assert.match(suite, /actionBodies\(org, target,.*\.slice\(1\)/);
});

test("real HTTP proof remains guarded and unconditionally executed", () => {
  assert.match(runner, /await \(await import\("\.\/tenant-hmo-http\.mjs"\)\)\.verifyHmoIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  for (const literal of ['process.env.CI, "true"', 'process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"',
    '"http://127.0.0.1:3000/"', 'pg.pathname, "/app_db"', 'pg.port, "5432"',
    '"PAYMONGO_SECRET_KEY"', '"XENDIT_SECRET_KEY"', 'requireIsolated();']) assert.ok(suite.includes(literal), literal);
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /target\[field\].id > 6 && owned.every/);
  assert.match(suite, /before.dependents.some\(row => row.id === target.dependent.id && row.organizationId === victim.id\)/);
});

test("own successes require actual populated records, persisted mutations, audit and events", () => {
  for (const label of ["HMO GET nonempty own response", "HMO POST create_plan owned success",
    "HMO POST add_dependent derives actual owned enrollment despite forged selectors",
    "HMO POST update_dependent owned success", "HMO POST update_enrollment owned success"]) assert.ok(suite.includes(label));
  for (const literal of ['savedPlan.category, "hmo"', 'savedDependent.employeeId, worker.id',
    'storedDependent.enrollmentId, row.enrollment.id', 'storedEnrollment.planId, row.plan.id',
    'member?.dependents.some', 'own.json.recentEvents.some', '"coverage_activated", "coverage_ended"']) assert.ok(suite.includes(literal), literal);
  assert.match(suite, /for \(const status of \["active", "ended"\]\)/);
  assert.match(suite, /assert.ok\(audit.some\(e => e.action === action\)/);
});

test("every denial checks both victim and owned HMO, employee, audit and payroll immutability", () => {
  for (const table of ["benefitPlans", "benefitEnrollments", "benefitDependents", "benefitEnrollmentEvents", "employees", "auditEvents", "payrollRuns"]) {
    assert.ok(suite.includes("db.select().from(" + table + ").where(eq(" + table + ".organizationId, id))"));
  }
  assert.match(suite, /assert.deepEqual\(await snapshot\(victim.id\), before, label/);
  assert.match(suite, /assert.deepEqual\(await snapshot\(ownId\), ownBefore, label/);
  assert.match(suite, /res.text.includes\(marker\)/);
  assert.match(suite, /res.headers/);
});

test("empty-unit, employee-role, revoked and anonymous paths remain distinct from owned success", () => {
  for (const label of ["HMO scoped empty unit is a verified empty response", "HMO unit/role scope denied: ",
    "HMO employee GET denied", "HMO employee POST denied: ", "HMO revoked session remains authenticated",
    "HMO revoked GET denied", "HMO revoked POST denied: ", "HMO anonymous GET denied", "HMO anonymous POST denied: "]) assert.ok(suite.includes(label), label);
  assert.match(suite, /assert.deepEqual\(scopedRead.json.enrollments, \[\]\)/);
  assert.match(suite, /set\(\{ active: false \}\)/);
  assert.match(suite, /await db.insert\(userOrganizations\).values\(\{ userId: former.user.id, organizationId: f.orgs\[3 - idx\].id/);
});

test("two unexecuted HMO candidates cannot borrow existing benefits/worksite credits", () => {
  assert.deepEqual(manifest.allApiRouteFiles["src/app/api/benefits/hmo/route.ts"].methods.map(m => [m.name, m.status]),
    [["GET", "GAP"], ["POST", "GAP"]]);
  assert.match(suite, /inventoryCreditsAdded: 0/);
  assert.doesNotMatch(suite, /fetch\(["']https:\/\/|submitXendit|submitPaymongo/);
});
