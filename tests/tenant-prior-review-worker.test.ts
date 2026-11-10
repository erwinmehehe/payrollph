import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalPriorReviewWorkerId } from "../src/lib/tenant-prior-review-worker";

test("prior-employer worker selector accepts no selection or one canonical safe ID only", () => {
  assert.equal(canonicalPriorReviewWorkerId(undefined), null);
  assert.equal(canonicalPriorReviewWorkerId(""), null);
  assert.equal(canonicalPriorReviewWorkerId("1"), 1);
  assert.equal(canonicalPriorReviewWorkerId("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const invalid of [null, 0, 1, false, [], ["1"], ["1", "2"], {},
    "0", "01", "+1", "-1", "1.0", "1e0", " 1", "1 ",
    "1&employeeId=2", "9007199254740992", "x", NaN, Infinity]) {
    assert.equal(canonicalPriorReviewWorkerId(invalid), false, JSON.stringify(invalid));
  }
});

test("prior-employer page binds caller-selected worker and legal employer AFTER full organization auth", () => {
  const page = readFileSync("src/app/workspace/prior-employer/page.tsx", "utf8");
  const session = page.indexOf("await getSessionUser()");
  const role = page.indexOf("await assertOrganizationRole(");
  const access = page.indexOf("await getAccess(");
  const companyWide = page.indexOf("if (denied || !access?.companyWide) notFound()");
  const entityPolicy = page.indexOf("await resolveMultiEntityContext(");
  const parsed = page.indexOf("canonicalPriorReviewWorkerId(employeeId)");
  const workerQuery = page.indexOf("const [worker] = await db.select(");
  const bound = page.indexOf("if (!worker || (entityScope.context.enabled");
  const mount = page.indexOf("<YearEndPriorReview");
  assert.ok(session >= 0 && role > session && access > role &&
    companyWide > access && entityPolicy > companyWide && parsed > entityPolicy &&
    workerQuery > parsed && bound > workerQuery && mount > bound,
    "No worker-specific SSR shell before authenticated employer, entity, worker gates");
  for (const required of [
    "db.select({ id: employees.id, legalEntityId: employees.legalEntityId })",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, selectedWorkerId)",
    "if (selectedWorkerId === false) notFound()",
    "assertEntityResource(entityScope.context, worker.legalEntityId)",
    "if (!entityScope.ok || (entityScope.context.enabled && entityScope.context.group)) notFound()",
  ]) assert.ok(page.includes(required), "Missing fail-closed worker boundary: " + required);
  assert.ok(!page.slice(workerQuery, mount).includes("catch"),
    "SQL/entity authorization errors cannot turn into a permissive SSR fallback");
  assert.ok(!page.includes("Number(query.organizationId)"));
  assert.ok(!page.includes("Number(query.employeeId)"));
});
