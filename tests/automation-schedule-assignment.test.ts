import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Automation Studio exposes a governed assign_schedule action", () => {
  const source = read("src/lib/automation.ts");
  assert.ok(source.includes('type: "assign_schedule"'));
  assert.ok(source.includes('label: "Assign schedule pattern"'));
  assert.ok(source.includes('"employee.hired"'));
  assert.ok(source.includes('"employee.moved"'));
  assert.ok(source.includes('"employee.promoted"'));
  assert.ok(source.includes("Schedule assignment automation must be immediately preceded by an approval gate."));
});

test("schedule action input is bounded and deterministic", () => {
  const source = read("src/lib/automation.ts");
  assert.ok(source.includes('"event_effective_date"'));
  assert.ok(source.includes('"employee_start_date"'));
  assert.ok(source.includes('"today"'));
  assert.ok(source.includes("offsetDays < 0"));
  assert.ok(source.includes("offsetDays > 365"));
  assert.ok(source.includes("employeeStartDate: String(employee.startDate)"));
});

test("schedule mutation goes through the governed WFM helper", () => {
  const engine = read("src/lib/automation.ts");
  const helper = read("src/lib/workforce-schedule-assignment.ts");
  assert.ok(engine.includes("assignEmployeeScheduleGoverned"));
  assert.ok(engine.includes("Automation Studio #"));
  assert.ok(helper.includes("scheduleGuardrailBlocksMutation"));
  assert.ok(helper.includes("resolveEmployeeScheduleWindow"));
  assert.ok(helper.includes("markTimesheetsStaleForEmployeeRange"));
  assert.ok(helper.includes("Employee workforce schedule assigned by governed automation"));
});

test("governed schedule assignment refuses retroactive and replacement mutations", () => {
  const helper = read("src/lib/workforce-schedule-assignment.ts");
  assert.ok(helper.includes("Automation cannot create a retroactive schedule assignment"));
  assert.ok(helper.includes("Automation will not silently replace an existing schedule"));
  assert.ok(helper.includes("began applying before the automated assignment could commit"));
});

test("schedule assignment is idempotent for one execution step and serialized per employee", () => {
  const helper = read("src/lib/workforce-schedule-assignment.ts");
  assert.ok(helper.includes("row.createdBy === sourceKey"));
  assert.ok(helper.includes("pg_advisory_xact_lock(4311"));
  assert.ok(helper.includes("idempotent: true"));
});

test("Automation Studio only exposes active schedule patterns to the builder", () => {
  const api = read("src/app/api/automation-studio/route.ts");
  assert.ok(api.includes("schedulePatterns.id"));
  assert.ok(api.includes("schedulePatterns.active"));
  assert.ok(api.includes("schedulePatterns: patterns.filter((pattern) => pattern.active)"));
});

test("builder enforces approval-gate adjacency before saving", () => {
  const ui = read("src/components/automation-studio-panel.tsx");
  assert.ok(ui.includes('row.type === "assign_schedule" && actions[index - 1]?.type !== "approval_gate"'));
  assert.ok(ui.includes("Schedule assignment must be immediately preceded by an approval gate."));
  assert.ok(ui.includes("This action must immediately follow an approval gate."));
});

test("builder defaults schedule timing appropriately by trigger", () => {
  const ui = read("src/components/automation-studio-panel.tsx");
  assert.ok(ui.includes('selectedTrigger?.value === "employee.hired"'));
  assert.ok(ui.includes('"employee_start_date"'));
  assert.ok(ui.includes('"event_effective_date"'));
  assert.ok(ui.includes("Days after source date"));
});
