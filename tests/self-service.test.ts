import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("self-service scoping is server-side, never a request parameter", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  // The employee id must come from the session, not from the query/body.
  assert.ok(route.includes("session.employeeId"), "scoping must use the session's employee id");
  assert.ok(!/searchParams\.get\("employeeId"\)/.test(route), "employeeId must not be client-supplied");
});

test("a privileged account cannot be demoted by linking", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  assert.ok(route.includes('"admin"') && route.includes('"bookkeeper"'), "admin/bookkeeper must be blocked from linking");
  assert.ok(route.includes("409"));
});

test("own-payslip PDF checks ownership before rendering", () => {
  const route = read("src/app/api/self/payslips/[id]/route.ts");
  assert.ok(route.includes("entry.employeeId !== session.employeeId"), "ownership must be verified against the session");
});

test("the workspace routes employee accounts away from admin screens", () => {
  assert.ok(read("src/app/page.tsx").includes('role === "employee"'), "employee role must land on the self-service portal");
});

test("import endpoint enforces the plan and seat limit in this order", () => {
  const route = read("src/app/api/employees/import/route.ts");
  const featureAt = route.indexOf('requireFeature(entitlements, "imports")');
  const seatAt = route.indexOf("seatUsage(organizationId");
  assert.ok(featureAt > -1, "plan gate must exist");
  assert.ok(seatAt > featureAt, "seat limit is checked only after the plan gate passes");
});
