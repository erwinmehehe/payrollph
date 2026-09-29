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


test("employee self-service exposes an upcoming pay stage without unreleased amounts", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  assert.ok(route.includes('.filter((row) => row.run.status !== "Released")'));
  assert.ok(route.includes(".sort((a, b) => a.run.payDate.localeCompare(b.run.payDate))[0]"));
  assert.ok(route.includes("employeePayStatusLabel(upcoming.run.status)"));

  const nextPayStart = route.indexOf("nextPay: upcoming");
  const payslipsStart = route.indexOf("payslips: released.map", nextPayStart);
  assert.ok(nextPayStart > -1 && payslipsStart > nextPayStart, "nextPay response block must exist before released payslips");
  const nextPayBlock = route.slice(nextPayStart, payslipsStart);
  assert.ok(!nextPayBlock.includes("gross:"), "upcoming pay must not expose unreleased gross pay");
  assert.ok(!nextPayBlock.includes("net:"), "upcoming pay must not expose unreleased net pay");
  assert.ok(!nextPayBlock.includes("deductions:"), "upcoming pay must not expose unreleased deductions");
});

test("employee self-service renders the same payroll handoff used by company roles", () => {
  const portal = read("src/components/self-service-portal.tsx");
  assert.ok(portal.includes("<PayrollHandoff"));
  assert.ok(portal.includes("NEXT PAY STATUS"));
  assert.ok(portal.includes("Your pay amount stays private and hidden until payroll is released."));
});
