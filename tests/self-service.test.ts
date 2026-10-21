import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { employeeNavigationTabs, employeeTabEnabled, EMPLOYEE_PAGE_LABELS, type EmployeeSelfTab } from "../src/lib/employee-navigation";

const read = (path: string) => readFileSync(path, "utf8");

test("self-service scoping is server-side, never a request parameter", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  // The employee id must come from the session, not from the query/body.
  assert.ok(route.includes("session.employeeId"), "scoping must use the session's employee id");
  assert.ok(!/searchParams\.get\("employeeId"\)/.test(route), "employeeId must not be client-supplied");
});

test("a privileged account cannot be demoted by linking", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  assert.ok(route.includes('session.role !== "employee"'), "all non-employee roles must be blocked from linking");
  assert.ok(route.includes("Only employee self-service accounts can link an employee record."));
  assert.ok(route.includes("403"));
});

test("own-payslip PDF checks ownership before rendering", () => {
  const route = read("src/app/api/self/payslips/[id]/route.ts");
  assert.ok(
    route.includes("eq(payrollEntries.employeeId, session.employeeId)"),
    "ownership must be bound to the authenticated employee in the database query",
  );
});

test("the workspace routes employee accounts away from admin screens", () => {
  assert.ok(read("src/app/app/page.tsx").includes('role === "employee"'), "employee role must land on the self-service portal");
});

test("import endpoint enforces the plan before the transactional seat limit", () => {
  const route = read("src/app/api/employees/import/route.ts");
  const batch = read("src/lib/employee-import-batch-server.ts");
  const featureAt = route.search(/requireFeature\(entitlements,\s*"imports"\)/);
  const delegateAt = route.indexOf("return handleEmployeeImportPreview(");
  assert.ok(featureAt > -1, "import plan gate must exist");
  assert.ok(delegateAt > featureAt, "plan gate must run before the import handler");
  assert.match(route, /seatLimit:\s*entitlements\.seatLimit/, "current tenant seat limit must be forwarded");
  assert.match(route, /if\s*\(previewEnabled\)/, "the atomic preview handler must remain feature gated");
  const lockAt = batch.indexOf("pg_advisory_xact_lock(4212");
  const seatAt = batch.indexOf("input.seatLimit !== null");
  assert.ok(lockAt > -1 && seatAt > lockAt, "seat cap must be checked within the locked transaction");
  assert.ok(batch.includes("context.existingNumbers.length + preview.candidates.length > input.seatLimit"));
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


test("newest released payslip is promoted above older pay history", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  const portal = read("src/components/self-service-portal.tsx");

  assert.ok(route.includes(".orderBy(desc(payrollRuns.payDate))"), "released payslips must stay newest-first");
  assert.ok(portal.includes("const latestPayslip = data?.payslips[0] ?? null"));
  const home = read("src/components/employee-home-dashboard.tsx");
  assert.ok(portal.includes("<EmployeeHomeDashboard"));
  assert.ok(home.includes('data-latest-payslip'));
  assert.ok(home.includes("Latest payslip"));
  assert.ok(home.includes("View payslip"));
  assert.ok(
    home.indexOf('data-latest-payslip') < home.indexOf("Recent payslips"),
    "latest payslip promotion must render before historical payslips",
  );
});


test("employee self-service payload includes only session-scoped attendance and leave data", () => {
  const route = read("src/app/api/self/payslips/route.ts");
  assert.ok(route.includes("eq(timePunches.employeeId, session.employeeId)"));
  assert.ok(route.includes("eq(leaveRequests.employeeId, session.employeeId)"));
  assert.ok(route.includes("eq(leaveBalances.employeeId, session.employeeId)"));
  assert.ok(!route.includes('searchParams.get("employeeId")'));
});

test("employee profile editing is restricted to non-payroll-sensitive contact fields", () => {
  const route = read("src/app/api/self/profile/route.ts");
  assert.ok(route.includes('session.role !== "employee"'));
  assert.ok(route.includes("session.employeeId"));
  assert.ok(route.includes("mobile: clean(body.mobile"));
  assert.ok(route.includes("emergencyContact: clean(body.emergencyContact"));
  assert.ok(route.includes("emergencyPhone: clean(body.emergencyPhone"));
  assert.ok(!route.includes("bankAccount:"));
  assert.ok(!route.includes("tin:"));
  assert.ok(!route.includes("basicRate:"));
  assert.ok(!route.includes("startDate:"));
});

test("employee navigation retains default sections and opts Expenses into desktop and mobile More", () => {
  const baseline = employeeNavigationTabs();
  for (const [tab, label] of [["home", "Home"], ["pay", "Pay"], ["time", "Time"], ["leave", "Leave"], ["profile", "Profile"]]) {
    assert.equal(EMPLOYEE_PAGE_LABELS[tab as EmployeeSelfTab].label, label);
    assert.ok(baseline.allTabs.includes(tab as EmployeeSelfTab));
  }
  assert.deepEqual(baseline.primaryTabs, ["home", "pay", "time", "leave"]);
  assert.deepEqual(baseline.moreTabs, ["documents", "performance", "profile"]);
  assert.deepEqual(baseline.allTabs, ["home", "pay", "time", "leave", "documents", "performance", "profile"]);
  const enabled = employeeNavigationTabs(true);
  assert.deepEqual(enabled.primaryTabs, baseline.primaryTabs);
  assert.deepEqual(enabled.moreTabs, [...baseline.moreTabs, "expenses"]);
  assert.deepEqual(enabled.allTabs, [...baseline.allTabs, "expenses"]);
  assert.deepEqual(employeeNavigationTabs(false), baseline, "Opt-in must not mutate default navigation");
  assert.equal(employeeTabEnabled("expenses"), false, "Direct Expenses navigation is denied by default");
  assert.equal(employeeTabEnabled("expenses", false), false);
  assert.equal(employeeTabEnabled("expenses", true), true);
  assert.equal(employeeTabEnabled("pay", false), true, "Existing pay navigation remains available");
});

test("employee leave request does not guess chargeable days", () => {
  const portal = read("src/components/self-service-portal.tsx");
  assert.ok(portal.includes('days: Number(leaveDays)'));
  assert.ok(portal.includes("The app does not guess weekends, rest days or holidays."));
});

test("latest pay remains ahead of history in the polished employee app", () => {
  const portal = read("src/components/self-service-portal.tsx");
  const latestAt = portal.indexOf("<EmployeeHomeDashboard");
  const historyAt = portal.indexOf("PAY HISTORY");
  assert.ok(latestAt > -1 && historyAt > -1 && latestAt < historyAt, "latest pay should render before pay history");
});


test("employee Explain My Pay endpoint is session-scoped and released-only", () => {
  const route = read("src/app/api/self/payslips/[id]/explain/route.ts");
  assert.ok(route.includes('session.role !== "employee"'), "only employee self-service accounts may use the endpoint");
  assert.ok(route.includes("session.employeeId"), "employee identity must come from the authenticated session");
  assert.ok(route.includes("eq(payrollEntries.employeeId, session.employeeId)"), "requested entry must belong to the authenticated employee");
  assert.ok(route.includes("eq(payrollRuns.status, \"Released\")"), "draft or in-review payroll must never be explained to employees");
  assert.ok(route.includes("eq(payrollRuns.organizationId, employee.organizationId)"), "entry must remain inside the employee organization");
  assert.ok(!route.includes('searchParams.get("employeeId")'), "employee identity must never be supplied by the client");
});

test("employee Explain My Pay compares against the previous released cutoff", () => {
  const route = read("src/app/api/self/payslips/[id]/explain/route.ts");
  assert.ok(route.includes("lt(payrollRuns.payDate, run.payDate)"));
  assert.ok(route.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(route.includes("orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))"));
  assert.ok(route.includes("buildPayExplanation(entry, previousEntry ?? null)"));
});

test("employee pay screen exposes Explain My Pay on latest and historical released payslips", () => {
  const portal = read("src/components/self-service-portal.tsx");
  const component = read("src/components/employee-explain-pay.tsx");
  assert.ok(portal.includes('import { EmployeeExplainPay } from "@/components/employee-explain-pay";'));
  assert.match(portal, /<EmployeeExplainPay entryId=\{latestPayslip\.entryId\} period=\{latestPayslip\.period\} organizationId=\{data\.employer\?\.id \?\? 0\} employeeId=\{data\.employee\.id\} language=\{language\} \/>/);
  assert.match(portal, /<EmployeeExplainPay entryId=\{slip\.entryId\} period=\{slip\.period\} organizationId=\{data\.employer\?\.id \?\? 0\} employeeId=\{data\.employee\.id\} language=\{language\} \/>/);
  assert.ok(component.includes("Why did my pay change?"));
  assert.ok(component.includes("previous released cutoff"));
  assert.ok(component.includes("effect on net"));
});
