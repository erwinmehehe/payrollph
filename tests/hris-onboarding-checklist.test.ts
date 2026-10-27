import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOnboardingChecklistGroups, filterOnboardingChecklistGroups } from "../src/lib/hris-onboarding-checklist";

const staff = [
  { id: 17, employeeNo: "EMP-017", firstName: "Alex", lastName: "Rivera", status: "Active" },
  { id: 18, employeeNo: "EMP-018", firstName: "Ben", lastName: "Santos", status: "Active" },
  { id: 19, employeeNo: "EMP-019", firstName: "Cora", lastName: "Alonzo", status: "Active" },
];

function task(id: number, employeeId: number, done = false, kind = "onboarding") {
  return { id, employeeId, kind, title: "Onboarding step " + id, owner: "People Ops", done };
}

test("onboarding projection counts only recorded task state, not certifications", () => {
  const result = buildOnboardingChecklistGroups(staff, [
    task(31, 17, true), task(32, 17),
    task(41, 18, true), task(42, 18, true),
    task(51, 19),
  ]);
  assert.deepEqual(result.map((group) => group.employee.id), [19, 17, 18]);
  assert.deepEqual(result.map((group) => [group.recorded, group.markedDone, group.remaining]), [
    [1, 0, 1], [2, 1, 1], [2, 2, 0],
  ]);
  assert.deepEqual(result.find((group) => group.employee.id === 17)?.tasks.map((entry) => entry.id), [32, 31]);
  assert.ok(result.every((group) => group.tasks.every((entry) => entry.kind === "onboarding")));
});

test("employee-scoped grouping rejects orphan, duplicate and unrelated task rows", () => {
  const source = [
    task(71, 17), task(72, 20), // employee 20 is outside authorized roster
    task(73, 18, false, "offboarding"),
    task(71, 19), // duplicate id cannot count as another item
    task(0, 17), task(-2, 17), task(74, 0), task(75, Number.NaN),
  ];
  const result = buildOnboardingChecklistGroups(staff.slice(0, 2), source);
  assert.equal(result.length, 1);
  assert.equal(result[0].employee.id, 17);
  assert.equal(result[0].recorded, 1);
  assert.deepEqual(result[0].tasks.map((entry) => entry.id), [71]);
  assert.equal(source[0].done, false, "Projection never mutates source tasks");
});

test("missing onboarding records are absent, not treated as complete", () => {
  assert.deepEqual(buildOnboardingChecklistGroups(staff, []), []);
  const result = buildOnboardingChecklistGroups(staff, [task(91, 17, true)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].remaining, 0);
  assert.equal(result[0].markedDone, 1);
  assert.equal(result.some((group) => group.employee.id === 18), false);
});

test("onboarding action remains in authorized workspace and existing audited source API", () => {
  const board = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const route = readFileSync("src/app/api/provisioning/route.ts", "utf8");

  assert.ok(workspace.includes('page === "Recruitment"'));
  assert.ok(workspace.includes('availablePages.includes("Recruitment")'));
  assert.ok(workspace.includes('["owner", "admin", "hr"].includes(effectiveRole ?? "")'));
  assert.ok(workspace.includes("employees={data.employees}"));
  assert.ok(workspace.includes("provisioning={data.provisioning}"));
  assert.ok(workspace.includes("onOpenEmployee={openHrEmployee}"));
  assert.ok(workspace.includes("onOpenDocuments={availablePages.includes(\"Documents\")"));
  assert.ok(board.includes('fetch("/api/provisioning"'));
  assert.ok(board.includes('method: "PATCH"'));
  assert.ok(board.includes("JSON.stringify({ id: task.id, organizationId, employeeId, done })"));
  assert.ok(board.includes("payload.organizationId !== organizationId"));
  assert.ok(board.includes("payload.employeeId !== employeeId"));
  assert.ok(board.includes('payload.kind !== "onboarding"'));
  assert.ok(board.includes("window.confirm("));
  assert.ok(board.includes("await onRefresh()"));
  assert.ok(board.includes("if (mutationInFlight.current || snapshotStale"));
  assert.ok(board.includes("disabled={busyId !== null || snapshotStale}"));
  assert.ok(board.includes("setSnapshotStale(true)"));
  assert.ok(board.includes("provisioning === undefined"));
  assert.ok(board.includes('role="alert"'));
  assert.ok(board.includes("This only records a checklist update"));
  assert.ok(!board.includes('method: "POST"'));
  assert.ok(!board.includes('method: "DELETE"'));
  assert.ok(!board.includes('fetch("/api/recruitment/hire"'));

  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("assertOrganizationRole("));
  assert.ok(route.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(route.includes('action: done ? "Provisioning item completed" : "Provisioning item reopened"'));
  assert.ok(route.includes("recordAuditEvent({"));
});

test("hire remains maker-checker-governed and refreshes onboarding after creation", () => {
  const hiring = readFileSync("src/components/recruitment-panel.tsx", "utf8");
  const route = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
  assert.ok(hiring.includes("if (payload.approvalRequired)"));
  assert.ok(hiring.includes("No worker or payroll records were created"));
  assert.ok(hiring.indexOf("if (payload.approvalRequired)") < hiring.indexOf("await onHired?.()"));
  assert.ok(hiring.includes("Do not resubmit the hire."));
  assert.ok(hiring.includes("onHired?: () => Promise<void>"));
  assert.ok(hiring.includes("const recruitmentReloaded = await reload().catch(() => false)"));
  assert.ok(hiring.includes("setLoading(true);"), "source data must be withheld after an already-completed hire");
  assert.ok(hiring.includes('data-recruitment-source="unavailable"'));
  assert.ok(hiring.includes("The hire request could not be confirmed."));
  assert.ok(hiring.includes('fetch("/api/recruitment/hire"'));
  assert.ok(route.includes("db.transaction"));
  assert.ok(route.includes("tx.insert(provisioningTasks)"));
  assert.ok(route.includes('processType: "hire"'));
});

test("read-only onboarding search respects recorded open/all states and authorized roster", () => {
  const groups = buildOnboardingChecklistGroups(staff, [
    task(101, 17, false),
    task(102, 18, true),
    task(103, 77, false), // foreign worker is excluded before filtering
  ]);
  assert.deepEqual(filterOnboardingChecklistGroups(groups, "", "open").map(g => g.employee.id), [17]);
  assert.deepEqual(filterOnboardingChecklistGroups(groups, "", "all").map(g => g.employee.id), [17, 18]);
  assert.deepEqual(filterOnboardingChecklistGroups(groups, " rivera ", "all").map(g => g.employee.id), [17]);
  assert.deepEqual(filterOnboardingChecklistGroups(groups, "EMP-018", "open"), []);
  assert.deepEqual(filterOnboardingChecklistGroups(groups, "EMP-018", "all").map(g => g.employee.id), [18]);
  assert.deepEqual(filterOnboardingChecklistGroups(groups, "foreign", "all"), []);
});

test("onboarding filters have accessible counts, 44px targets and an honest empty-state action", () => {
  const board = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  assert.ok(board.includes('aria-label="Clear onboarding employee search"'));
  assert.ok(board.includes('onClick={() => setQuery("")}'));
  assert.ok(board.includes('aria-controls="hris-onboarding-results"'));
  assert.ok(board.includes('id={groups.length > 0 ? "hris-onboarding-results" : undefined}'));
  assert.ok(board.includes('id="hris-onboarding-search-hint"'));
  assert.ok(board.includes('id="hris-onboarding-filter-count" role="status" aria-live="polite"'));
  assert.ok(board.includes('min-h-11'));
  assert.ok(board.includes('onClick={() => { setShow("all"); setQuery(""); }}'));
  assert.ok(board.includes("This does not verify onboarding completion"));
  assert.ok(board.includes("onOpenEmployee(group.employee.id)"));
  assert.ok(board.includes('aria-label={"Open employee record for "'));
  assert.ok(board.includes('method: "PATCH"'));
  assert.ok(!board.includes('method: "POST"'));
  assert.ok(!board.includes('method: "DELETE"'));
});

test("onboarding directory search supports surname-first and pasted whitespace", () => {
  const groups = buildOnboardingChecklistGroups(staff, [
    task(301, 17), task(302, 18), task(303, 19, true),
  ]);
  const ids = (needle: string, show: "open" | "all" = "all") =>
    filterOnboardingChecklistGroups(groups, needle, show).map(g => g.employee.id);
  assert.deepEqual(ids("  ALEX    RIVERA  "), [17]);
  assert.deepEqual(ids(" rIvErA   aLeX "), [17]);
  assert.deepEqual(ids("RIVERA,   ALEX"), [17]);
  assert.deepEqual(ids("RIVERA,Alex"), [17]);
  assert.deepEqual(ids(" Rivera ,Alex "), [17]);
  assert.deepEqual(ids(" Rivera  ,  Alex "), [17]);
  assert.deepEqual(ids("  emp-017  "), [17]);
  assert.deepEqual(ids("Alex    Rivera   EMP-017"), [17]);
  assert.deepEqual(ids("RIVERA Alex", "open"), [17]);
  assert.deepEqual(ids("ALONZO CORA", "open"), [], "completed task remains excluded from Open");
  assert.deepEqual(ids("ALONZO CORA", "all"), [19]);
  assert.deepEqual(ids("RIVERA BEN"), [], "terms from different authorized people must not combine");
  assert.deepEqual(ids("Foreign Worker"), [], "search does not introduce unauthorized people");
});

test("onboarding refresh errors and stale-state warnings remain visible without provisioning", () => {
  const board = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  const missingSourceIndex = board.indexOf("{provisioning === undefined ? (");
  assert.ok(missingSourceIndex > 0, "missing-source branch must remain explicit");
  for (const message of [
    '{error && <p role="alert"',
    "{snapshotStale && <p role=\"status\"",
    '{notice && <p role="status"',
  ]) {
    const index = board.indexOf(message);
    assert.ok(index > 0 && index < missingSourceIndex,
      message + " must not be hidden by the missing-source conditional");
  }
  assert.equal((board.match(/role="alert"/g) ?? []).length, 1);
  assert.ok(board.includes("Could not reload the onboarding snapshot. Try again."));
});

test("onboarding directory search recognizes unaccented names without changing task scope", () => {
  const authorized = [
    { id: 77, employeeNo: "PH-Á77", firstName: "José", lastName: "Peña", status: "Active" },
    { id: 78, employeeNo: "PH-078", firstName: "Ana", lastName: "Cruz", status: "Active" },
  ];
  const source = [task(770, 77), task(780, 78), task(999, 999)];
  const groups = buildOnboardingChecklistGroups(authorized, source);
  const before = JSON.stringify({ authorized, source });
  for (const query of ["jose", "PENA, JOSE", "pena jose", "PH-A77", "José Peña"]) {
    assert.deepEqual(filterOnboardingChecklistGroups(groups, query, "open")
      .map(group => group.employee.id), [77], query);
  }
  assert.deepEqual(filterOnboardingChecklistGroups(groups, "foreign", "all"), []);
  assert.equal(groups.find((group) => group.employee.id === 77)?.employee.firstName, "José",
    "displayed name is never rewritten");
  assert.equal(JSON.stringify({ authorized, source }), before, "search is read-only");
});
