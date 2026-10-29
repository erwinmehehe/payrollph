// Source-level regression only; actual cross-tenant acceptance requires
// executed PG16 HTTP evidence, exact-head CI and independent security review.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/attendance-exception-events/route.ts", "utf8");

function actionSource(name) {
  const start = source.indexOf(`if (action === "${name}") {`);
  assert.ok(start >= 0, `Action ${name} missing`);
  const next = source.indexOf("\n  if (action === ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test("membership, employee ownership and unit scope must precede first update", () => {
  const post = source.slice(source.indexOf("export async function POST("));
  const role = post.indexOf("const denied = await assertOrganizationRole(");
  const event = post.indexOf("const [event] = await db.select().from(attendanceExceptionEvents)");
  const employee = post.indexOf("const [employee] = await db.select({");
  const scope = post.indexOf("const scope = assertScope(access, employee.orgUnitId)");
  const update = post.indexOf("db.update(attendanceExceptionEvents).set({");
  assert.ok(role >= 0 && role < event && event < employee && employee < scope && scope < update);
  assert.ok(post.slice(event, employee).includes("eq(attendanceExceptionEvents.organizationId, organizationId)"));
  assert.ok(post.slice(employee, scope).includes("eq(employees.organizationId, organizationId)"));
});

for (const [name, expectedStatus] of [
  ["assign_owner", "open"],
  ["record_resolution", "resolved"],
]) {
  test(`${name} update binds event, tenant, worker, and state together`, () => {
    const action = actionSource(name);
    const updateAt = action.indexOf("db.update(attendanceExceptionEvents).set({");
    assert.ok(updateAt >= 0);
    assert.equal(action.indexOf("db.update(attendanceExceptionEvents).set({", updateAt + 1), -1,
      "The action must have exactly one event update");
    const whereAt = action.indexOf("}).where(and(", updateAt);
    const returnedAt = action.indexOf(")).returning()", whereAt);
    assert.ok(whereAt > updateAt && returnedAt > whereAt);
    const predicate = action.slice(whereAt, returnedAt);
    const terms = [
      "eq(attendanceExceptionEvents.id, eventId)",
      "eq(attendanceExceptionEvents.organizationId, organizationId)",
      "eq(attendanceExceptionEvents.employeeId, event.employeeId)",
      `eq(attendanceExceptionEvents.status, "${expectedStatus}")`,
    ];
    let offset = -1;
    for (const term of terms) {
      const at = predicate.indexOf(term);
      assert.ok(at > offset, `Missing or reordered atomic UPDATE predicate: ${term}`);
      offset = at;
    }
    const checked = action.indexOf("if (!updated)", returnedAt);
    const audited = action.indexOf("await recordAuditEvent(", returnedAt);
    assert.ok(checked > returnedAt && audited > checked,
      "Failed update must not emit a success audit event");
  });
}

test("no new tenant coverage credits or production acceptance are claimed", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const row = manifest.allApiRouteFiles["src/app/api/workforce/attendance-exception-events/route.ts"];
  assert.deepEqual(row.methods.map(({ name, status }) => [name, status]),
    [["GET", "COVERED"], ["POST", "COVERED"]]);
  assert.ok(row.methods.every(({ testedBy }) => testedBy?.file ===
    "scripts/qa/workforce-attendance-sweep-http.mjs"));
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED/);
});
