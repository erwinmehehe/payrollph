import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findAuthorizedHrisEmployees,
  type HrisQuickFindEmployee,
} from "../src/lib/hris-quick-find";

const employerA: HrisQuickFindEmployee[] = [
  { id: 4, employeeNo: "QA-004", firstName: "Ana", lastName: "Santos", title: "Operations Associate", status: "Active" },
  { id: 7, employeeNo: "QA-007", firstName: "Maria", lastName: "Cruz", title: "HR Analyst", status: "Active" },
  { id: 9, employeeNo: "QA-009", firstName: "Robert", lastName: "Reyes", title: "Payroll Analyst", status: "On leave" },
];
const employerB: HrisQuickFindEmployee[] = [
  // Overlapping employee number in another employer: never injected into the authorized list.
  { id: 99, employeeNo: "QA-007", firstName: "Maria", lastName: "Foreign", title: "HR Analyst", status: "Active" },
];

test("quick find only returns records from the provided, authorized employer roster", () => {
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "QA-007").map(row => row.id), [7]);
  assert.deepEqual(findAuthorizedHrisEmployees(employerB, "QA-007").map(row => row.id), [99]);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "Foreign"), []);
  assert.deepEqual(findAuthorizedHrisEmployees([], "QA-007"), []);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "x"), []);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "  "), []);
});

test("quick find handles name order, whitespace, number and title without exposing extra fields", () => {
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "  MARIA   CRUZ  ").map(row => row.id), [7]);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "cruz maria").map(row => row.id), [7]);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "QA-00").map(row => row.id), [7, 9, 4]);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "Payroll Analyst").map(row => row.id), [9]);
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "SANTOS").map(row => row.id), [4]);
});

test("quick find limits response to six and gives exact number matches priority", () => {
  const employees: HrisQuickFindEmployee[] = [
    ...employerA,
    ...Array.from({ length: 9 }, (_, i) => ({
      id: 100 + i, employeeNo: "TEAM-" + i,
      firstName: "Team", lastName: "Person" + i,
      title: "Support", status: "Active",
    })),
  ];
  const before = JSON.stringify(employees);
  assert.equal(findAuthorizedHrisEmployees(employees, "team").length, 6);
  assert.equal(JSON.stringify(employees), before, "search cannot mutate the authorized roster");
  const picked = findAuthorizedHrisEmployees(
    [
      { id: 10, employeeNo: "AB-100", firstName: "Ab", lastName: "User", title: "Support", status: "Active" },
      { id: 11, employeeNo: "AB-10", firstName: "Another", lastName: "User", title: "Support", status: "Active" },
    ],
    "ab-10",
  );
  assert.deepEqual(picked.map(row => row.id), [11, 10]);
});

test("HR quick find explains keyboard controls and bounded results on mobile", () => {
  const home = readFileSync("src/components/hris-home-shortcuts.tsx", "utf8");
  assert.ok(home.includes('aria-describedby="hris-employee-quick-help"'));
  assert.ok(home.includes('aria-controls={searchExpanded ? "hris-employee-quick-results" : undefined}'));
  assert.ok(home.includes('id="hris-employee-quick-results"'));
  assert.ok(home.includes('aria-live="polite"'));
  assert.ok(home.includes('aria-label="Clear employee search"'));
  assert.ok(home.includes('onClick={() => setEmployeeQuery("")}'));
  assert.ok(home.includes("Showing up to six matches."));
  assert.ok(home.includes('matches.length === 6'));
  assert.ok(home.includes("key={employee.id}"));
  assert.ok(home.includes("onOpenEmployee?.(employee.id)"));
  assert.ok(!home.includes("fetch("), "search may not introduce a new employee-data API");
});

test("HR Home quick find uses the selected employer key and existing employee drawer, no new API", () => {
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const home = readFileSync("src/components/hris-home-shortcuts.tsx", "utf8");
  assert.ok(workspace.includes("key={data.selectedOrganization.id}"));
  assert.ok(workspace.includes("employees={canUsePeopleOps ? data.employees : []}"));
  assert.ok(workspace.includes("onOpenEmployee={canUsePeopleOps ? openHrEmployee : undefined}"));
  assert.ok(home.includes("findAuthorizedHrisEmployees(employees, employeeQuery)"));
  assert.ok(home.includes('type="search"'));
  assert.ok(home.includes("aria-live=\"polite\""));
  assert.ok(home.includes("onOpenEmployee?.(employee.id)"));
  assert.ok(!home.includes("fetch("));
});

test("quick find matches unaccented searches without changing the authorized roster", () => {
  const authorized: HrisQuickFindEmployee[] = [{
    id: 31, employeeNo: "PH-Á31", firstName: "José", lastName: "Peña",
    title: "Crédit Analyst", status: "Active",
  }];
  const before = JSON.stringify(authorized);
  for (const query of ["jose", "PENA JOSE", "PH-A31", "credit analyst", "jose peña"]) {
    assert.deepEqual(findAuthorizedHrisEmployees(authorized, query).map(row => row.id), [31], query);
  }
  assert.deepEqual(findAuthorizedHrisEmployees(employerA, "jose"), []);
  assert.equal(JSON.stringify(authorized), before, "search must not rewrite employee records");
});

test("quick find supports pasted surname-comma-first-name with varied spacing and accents", () => {
  const authorized: HrisQuickFindEmployee[] = [
    ...employerA,
    { id: 31, employeeNo: "PH-Á31", firstName: "José", lastName: "Peña",
      title: "Crédit Analyst", status: "Active" },
  ];
  const before = JSON.stringify(authorized);
  for (const query of ["Peña, José", "PENA,JOSE", "  Peña  ,   José ", "Peña, Jos"]) {
    assert.deepEqual(findAuthorizedHrisEmployees(authorized, query).map(row => row.id), [31], query);
  }
  assert.deepEqual(findAuthorizedHrisEmployees(authorized, "Cruz, Maria").map(row => row.id), [7]);
  assert.deepEqual(findAuthorizedHrisEmployees(authorized, "Foreign, Maria"), [],
    "a comma-formatted name cannot bring in another employer's record");
  assert.deepEqual(findAuthorizedHrisEmployees(authorized, "QA-007").map(row => row.id), [7],
    "existing employee number matching must remain exact and ranked");
  assert.equal(JSON.stringify(authorized), before, "search cannot mutate the authorized roster");
});
