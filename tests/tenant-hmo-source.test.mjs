// Source contract only: real HTTP/PG16 CI is a separate required acceptance gate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("HMO GET keeps its earlier independent table proof; only POST receives this reconciliation", () => {
  const hmo = manifest.allApiRouteFiles["src/app/api/benefits/hmo/route.ts"].methods;
  assert.deepEqual(hmo.map(method => method.name), ["GET", "POST"]);
  const get = hmo.find(method => method.name === "GET");
  assert.equal(get.status, "COVERED");
  assert.equal(get.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
  const post = hmo.find(method => method.name === "POST");
  assert.equal(post.status, "COVERED");
  assert.equal(post.testedBy?.file, "scripts/qa/tenant-hmo-http.mjs");
  assert.deepEqual(post.testedBy.postActions, actions);
  assert.deepEqual(post.testedBy.postActionOwnLines, {
    create_plan: 121, add_dependent: 128, update_dependent: 138, update_enrollment: 145,
  });
  assert.equal(post.testedBy.ownStatusByAction.create_plan, 201);
  assert.equal(post.testedBy.ownStatusByAction.add_dependent, 201);
  assert.equal(post.testedBy.ownStatusByAction.update_dependent, 200);
  assert.equal(post.testedBy.ownStatusByAction.update_enrollment, 200);
  assert.equal(post.testedBy.foreignStatus, 403);
});

test("HMO POST credit is pinned to the executed source, real victim denials and CI receipt", () => {
  const post = manifest.allApiRouteFiles["src/app/api/benefits/hmo/route.ts"].methods
    .find(method => method.name === "POST");
  const proof = post.testedBy;
  const gitBlobSha = source => {
    const bytes = Buffer.from(source, "utf8");
    return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
      .update(bytes).digest("hex");
  };
  const line = number => {
    assert.ok(Number.isInteger(number) && number > 0, "Positive pinned proof line required");
    const value = suite.split("\n")[number - 1];
    assert.ok(value, "Pinned evidence line must exist: " + number);
    return value;
  };
  assert.equal(proof.proofBlobSha, gitBlobSha(suite), "Changed HMO CI proof requires re-review");
  assert.equal(proof.routeBlobSha, gitBlobSha(route), "Changed HMO route requires new PG16 acceptance");
  assert.equal(proof.runnerBlobSha, gitBlobSha(runner), "Changed HMO runner requires new PG16 acceptance");
  assert.equal(proof.reviewedHead, "b85715c76be9bf2c9f0ab0f08741853c8983d7d9");
  assert.equal(proof.passedJob,
    "https://github.com/erwinmehehe/payrollph/actions/runs/40675730756/job/122773670031");
  assert.equal(proof.ciResultKind, "HMO_GET_POST_HTTP_CANDIDATE");
  assert.match(line(proof.line), /createdPlan = expectStatus/);
  assert.match(line(proof.ownPositiveLine), /createdPlan = expectStatus/);
  for (const [action, pattern] of Object.entries({
    create_plan: /createdPlan = expectStatus/,
    add_dependent: /createdDependent = expectStatus/,
    update_dependent: /updatedDependent = expectStatus/,
    update_enrollment: /updatedEnrollment = expectStatus/,
  })) assert.match(line(proof.postActionOwnLines[action]), pattern, action + " own HTTP");
  assert.match(line(proof.foreignDenialLine), /await denied\(PATH,.*403/);
  assert.match(line(proof.forgedSelectorLine), /await denied\(PATH,.*404/);
  assert.match(line(proof.unchangedDbLine), /assert\.deepEqual\(await snapshot\(victim\.id\), before,/);
  assert.match(line(proof.victimIdOrderingLine), /target\[field\]\.id > 6/);
  assert.match(suite, /for \(const body of actionBodies\(victim, target,/);
  assert.match(suite, /for \(const body of actionBodies\(org, target,.*\.slice\(1\)/);
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /actualProviderTraffic: false, inventoryCreditsAdded: 0/);
  assert.match(post.reason, /provisional/i);
  assert.match(post.reason, /independent security review/i);
  // The CI receipt ran while this was still a candidate. Credit is proposed
  // in this PR only, not retroactively asserted by the earlier log message.
});
