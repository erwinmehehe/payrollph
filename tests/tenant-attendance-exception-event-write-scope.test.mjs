// Static regression for the attendance-exception update predicates.
// This is defense-in-depth source assurance, not a fresh real-HTTP/PG16
// tenant-isolation certification. Existing GET/POST method credits are
// unchanged and require exact-branch CI and independent review.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/attendance-exception-events/route.ts", "utf8");

function actionSource(name) {
  const first = source.indexOf(`if (action === "${name}") {`);
  assert.ok(first > 0, `Missing ${name} action`);
  const next = source.indexOf("\n  if (action === ", first + 1);
  return source.slice(first, next < 0 ? source.length : next);
}

test("read and mutation paths prove employer membership before event access", () => {
  const post = source.slice(source.indexOf("export async function POST("));
  const role = post.indexOf("const denied = await assertOrganizationRole(");
  const event = post.indexOf("const [event] = await db.select().from(attendanceExceptionEvents)");
  const worker = post.indexOf("const [employee] = await db.select({");
  const unit = post.indexOf("const scope = assertScope(access, employee.orgUnitId)");
  const firstWrite = post.indexOf("db.update(attendanceExceptionEvents).set({");
  assert.ok(role >= 0 && role < event && event < worker && worker < unit && unit < firstWrite);
  assert.match(post.slice(event, worker), /eq\(attendanceExceptionEvents\.organizationId, organizationId\)/);
  assert.match(post.slice(worker, unit), /eq\(employees\.organizationId, organizationId\)/);
});

for (const [action, state] of [
  ["assign_owner", "open"],
  ["record_resolution", "resolved"],
]) {
  test(`${action} preserves organization and worker predicates in the atomic UPDATE`, () => {
    const actionBody = actionSource(action);
    assert.equal(actionBody.split("db.update(attendanceExceptionEvents).set({").length, 2,
      "Expected exactly one attendance-exception write for this action");
    assert.match(actionBody, new RegExp(
      "db\\.update\\(attendanceExceptionEvents\\)\\.set\\(\\{[\\s\\S]*?" +
      "\\.where\\(and\\(\\s*" +
      "eq\\(attendanceExceptionEvents\\.id, eventId\\),\\s*" +
      "eq\\(attendanceExceptionEvents\\.organizationId, organizationId\\),\\s*" +
      "eq\\(attendanceExceptionEvents\\.employeeId, event\\.employeeId\\),\\s*" +
      "eq\\(attendanceExceptionEvents\\.status, \\"" + state + "\\"\\),\\s*" +
      "\\)\\)\\.returning\\(\\)"
    ));
    assert.match(actionBody, /if \(!updated\) return Response\.json\(\{ error:/,
      "A lost race or cross-tenant mismatch must fail without an audit write");
    assert.ok(actionBody.indexOf("if (!updated)") < actionBody.indexOf("await recordAuditEvent("));
  });
}

test("authorization source tightening does not silently promote coverage", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = manifest.allApiRouteFiles["src/app/api/workforce/attendance-exception-events/route.ts"];
  assert.deepEqual(record.methods.map(m => [m.name, m.status]),
    [["GET", "COVERED"], ["POST", "COVERED"]]);
  for (const method of record.methods) {
    assert.equal(method.testedBy?.file, "scripts/qa/workforce-attendance-sweep-http.mjs");
  }
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED/);
});
