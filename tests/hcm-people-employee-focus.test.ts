import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  peopleEmployeeFocusHref, resolvePeopleEmployeeFocus,
} from "../src/lib/hcm-people-employee-focus";

const selected = {
  requestedPage: "People",
  requestedOrganizationId: "17",
  requestedEmployeeId: "23",
  selectedOrganizationId: 17,
  access: { role: "hr", companyWide: true },
  authorizedEmployees: [{ id: 23 }, { id: 24 }],
  demoMode: false,
};

test("People Home handoffs link directly to an explicit employer and worker, never a guessed one", () => {
  assert.equal(peopleEmployeeFocusHref(17, 23),
    "/app?organizationId=17&workspacePage=People&focusEmployeeId=23");
  for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(peopleEmployeeFocusHref(id, 23), null);
    assert.equal(peopleEmployeeFocusHref(17, id), null);
  }
});

test("only an authorized company-wide People operator with a visible worker can focus an HCM link", () => {
  assert.equal(resolvePeopleEmployeeFocus(selected), 23);
  for (const role of ["bookkeeper", "payroll", "checker", "employee", "manager", "unknown"]) {
    assert.equal(resolvePeopleEmployeeFocus({ ...selected, access: { role, companyWide: true } }), null, role);
  }
  assert.equal(resolvePeopleEmployeeFocus({ ...selected, access: { role: "hr", companyWide: false } }), null);
  assert.equal(resolvePeopleEmployeeFocus({ ...selected, access: null }), null);
  assert.equal(resolvePeopleEmployeeFocus({ ...selected, access: { role: "owner", companyWide: true } }), 23);
  assert.equal(resolvePeopleEmployeeFocus({ ...selected, access: { role: "admin", companyWide: true } }), 23);
  assert.equal(resolvePeopleEmployeeFocus({ ...selected, demoMode: true }), null);
});

test("tenant switch, stale roster and malformed URLs cannot select a worker", () => {
  const rejects = [
    { requestedOrganizationId: null },
    { requestedOrganizationId: "18" },
    { requestedOrganizationId: "017" },
    { requestedOrganizationId: "17.0" },
    { requestedOrganizationId: "-17" },
    { requestedOrganizationId: "9007199254740992" },
    { requestedEmployeeId: null },
    { requestedEmployeeId: "24x" },
    { requestedEmployeeId: "023" },
    { requestedEmployeeId: "0" },
    { requestedEmployeeId: "9007199254740992" },
    { requestedEmployeeId: "25" },
    { selectedOrganizationId: 18 },
    { authorizedEmployees: [{ id: 24 }] },
    { authorizedEmployees: [] },
    { requestedPage: "Payroll" },
    { requestedPage: null },
  ];
  for (const change of rejects) {
    assert.equal(resolvePeopleEmployeeFocus({ ...selected, ...change }), null,
      "Untrusted URL or roster must not focus a worker: " + JSON.stringify(change));
  }
  // Same-looking employee ID across legal employers is not sufficient.
  assert.equal(resolvePeopleEmployeeFocus({
    ...selected, selectedOrganizationId: 18,
    authorizedEmployees: [{ id: 23 }],
  }), null);
});

test("People Home uses SQL-qualified worker identities and delegates actions to the existing People workspace", () => {
  const projection = readFileSync("src/lib/hcm-people-home-worklist.ts", "utf8");
  const worklist = projection.slice(projection.indexOf("async function peopleOpsFollowUps("),
    projection.indexOf("async function myOwnedCases("));
  assert.match(worklist, /employeeId: provisioningTasks\.employeeId/);
  assert.match(worklist, /innerJoin\(employees, and\(/);
  assert.match(worklist, /eq\(provisioningTasks\.employeeId, employees\.id\)/);
  assert.match(worklist, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(worklist, /eq\(provisioningTasks\.organizationId, organizationId\)/);
  assert.match(worklist, /limit\(FOLLOWUP_SOURCE_LIMIT \+ 1\)/);
  assert.match(worklist, /subjectEmployeeId: item\.employeeId/);
  assert.match(worklist, /peopleEmployeeFocusHref\(organizationId, item\.employeeId\)/);
  for (const privateField of ["bankAccount", "tinNo", "firstName", "lastName", "basicRate"]) {
    assert.ok(!worklist.includes(privateField), "No private source field: " + privateField);
  }

  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  assert.match(workspace, /resolvePeopleEmployeeFocus\(\{/);
  assert.match(workspace, /authorizedEmployees: initialData\.employees/);
  assert.match(workspace, /requestedOrganizationId: searchParams\.get\("organizationId"\)/);
  assert.match(workspace, /requestedEmployeeId: searchParams\.get\("focusEmployeeId"\)/);
  assert.ok(workspace.includes("focusEmployeeId={focusEmployeeId}"));
  assert.ok(workspace.includes("data.employees.some((employee) => employee.id === employeeId)"));
  const page = readFileSync("src/app/hcm/command-center/page.tsx", "utf8");
  assert.ok(page.includes("Open worker in People"));
  assert.ok(!worklist.includes("db.insert(") && !worklist.includes("db.update("));
});
