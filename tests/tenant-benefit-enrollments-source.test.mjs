// Source review contract; only the real disposable HTTP run establishes acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const suite = readFileSync("scripts/qa/tenant-benefit-enrollments-http.mjs", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const route = readFileSync("src/app/api/benefits/route.ts", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("candidate is unconditionally awaited by guarded real HTTP second pass", () => {
  assert.match(runner, /await \(await import\("\.\/tenant-benefit-enrollments-http\.mjs"\)\)\.verifyBenefitEnrollmentIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(suite, /requireIsolated\(\);/);
  for (const literal of ['process.env.CI, "true"', 'process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"',
    '"http://127.0.0.1:3000/"', 'pg.pathname, "/app_db"', 'pg.port, "5432"',
    '"PAYMONGO_SECRET_KEY"', '"XENDIT_SECRET_KEY"']) assert.ok(suite.includes(literal), literal);
});

test("three actual handlers require independent real populated own and foreign controls", () => {
  for (const method of ["GET", "POST", "DELETE"]) assert.ok(route.includes("export async function " + method + "("));
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /victimPlan.id > 6 && ownPlans.every/);
  assert.match(suite, /victimRow.id > 6 && ownRows.every/);
  for (const label of ["GET owned populated benefits", "GET real victim employer denied",
    "POST owned benefit enrollment succeeds", "POST victim employer denied",
    "POST foreign worker in owned employer denied", "POST foreign private plan in owned employer denied",
    "DELETE victim ID cannot be authorized by forged own selector",
    "DELETE owned row derives employer from persisted record"]) assert.ok(suite.includes(label), label);
  assert.match(suite, /worker\?\.enrolments.some/);
  assert.match(suite, /persisted.monthlyContribution, "100.00"/);
  assert.match(suite, /ended.status, "ended"/);
  assert.match(suite, /e.action === "Benefit enrolment ended" && e.metadata\?\.enrolmentId === ended.id/);
});

test("victim database invariants cover benefit plans, enrollments, employees, payroll and audit", () => {
  for (const table of ["benefitPlans", "benefitEnrollments", "employees", "payrollRuns", "auditEvents"]) {
    assert.ok(suite.includes("db.select().from(" + table + ").where(eq(" + table + ".organizationId, organizationId))"));
  }
  assert.match(suite, /assert.deepEqual\(await snapshot\(victim.id\), before, label/);
  assert.match(suite, /Final victim benefits, employees, payroll and audit unchanged/);
  assert.match(suite, /response.text.includes\(marker\)/);
  assert.match(suite, /response.headers/);
});

test("revocation uses the same authenticated session and preserves formerly owned row", () => {
  assert.match(suite, /const stale = await makeSession\(former.id\)/);
  assert.match(suite, /set\(\{ active: false \}\)/);
  assert.match(suite, /Same session remains authenticated/);
  for (const method of ["GET", "POST", "DELETE"]) assert.ok(suite.includes(method + " revoked membership denied"));
  assert.match(suite, /assert.deepEqual\(untouched, existing/);
});

test("unexecuted candidate cannot inflate coverage or claim catalogue/HMO acceptance", () => {
  const methods = manifest.allApiRouteFiles["src/app/api/benefits/route.ts"].methods;
  for (const method of ["POST", "DELETE", "PUT"]) {
    assert.equal(methods.find(row => row.name === method)?.status, "GAP");
  }
  // GET may close only through the separate own-marker table proof, never through this candidate suite.
  const get = methods.find(row => row.name === "GET");
  assert.ok(get?.status === "GAP" || (get?.status === "COVERED" && get.testedBy?.file === "scripts/qa/tenant-table-http.mjs"),
    "benefits GET cannot be credited by the unexecuted enrolment candidate");
  assert.match(suite, /inventoryCreditsAdded: 0/);
  assert.ok(!suite.includes('method: "PUT"'));
  assert.ok(!suite.includes("/api/benefits/hmo"));
});

test("ordinary employees and anonymous callers cannot access administrative benefits", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.ok(suite.includes(method + " ordinary employee role denied"));
  }
  assert.match(suite, /employeeSession = await makeSession\(ordinary.id\)/);
  assert.match(suite, /401, "Anonymous " \+ method \+ " denied"/);
  assert.match(suite, /assert.deepEqual\(await snapshot\(org.id\), ownedBeforeDenials/);
});

test("POST positive uses a distinct enrolment unique key from its populated GET fixture", () => {
  const seededDate = suite.match(/const START = "(\d{4}-\d{2}-\d{2})";/)?.[1];
  const createDate = suite.match(/const CREATE_START = "(\d{4}-\d{2}-\d{2})";/)?.[1];
  assert.ok(seededDate && createDate);
  assert.notEqual(createDate, seededDate, "employee/plan/start-date cannot duplicate the seeded enrolment");
  assert.match(suite, /employeeId, planId, monthlyContribution: 100, startedOn: CREATE_START/);
  assert.match(suite, /assert.notEqual\(createBody.startedOn, existing.startedOn/);
  assert.match(suite, /assert.equal\(persisted.startedOn, CREATE_START\)/);
});
