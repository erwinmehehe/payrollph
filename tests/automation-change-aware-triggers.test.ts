import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fieldChangeContext,
  meaningfulFieldChange,
} from "../src/lib/automation-change-events";

const read = (path: string) => readFileSync(path, "utf8");

test("change-aware context calculates numeric delta and percentage deterministically", () => {
  const context = fieldChangeContext({
    field: "monthlyEquivalentSalary",
    previousValue: 50_000,
    newValue: 56_000,
    effectiveDate: "2026-10-07",
    source: "compensation-governance",
  });

  assert.equal(context.changeField, "monthlyEquivalentSalary");
  assert.equal(context.changeDirection, "increased");
  assert.equal(context.previousNumericValue, 50_000);
  assert.equal(context.newNumericValue, 56_000);
  assert.equal(context.changeAmount, 6_000);
  assert.equal(context.changePercent, 12);
  assert.equal(context.effectiveDate, "2026-10-07");
});

test("zero-baseline numeric changes do not invent a percentage", () => {
  const context = fieldChangeContext({
    field: "recurringCompensationAmount",
    previousValue: 0,
    newValue: 2_500,
  });

  assert.equal(context.changeAmount, 2_500);
  assert.equal("changePercent" in context, false);
});

test("sensitive field changes are redacted before entering automation evidence", () => {
  const context = fieldChangeContext({
    field: "payoutDestination",
    previousValue: "raw-old-account",
    newValue: "raw-new-account",
    sensitive: true,
    source: "payout-destination-dual-control",
  });

  assert.equal(context.sensitiveChange, true);
  assert.equal(context.changeField, "payoutDestination");
  assert.equal(context.changeDirection, "changed");
  assert.equal("previousValue" in context, false);
  assert.equal("newValue" in context, false);
  assert.equal("previousNumericValue" in context, false);
  assert.equal("newNumericValue" in context, false);
  assert.equal(JSON.stringify(context).includes("raw-old-account"), false);
  assert.equal(JSON.stringify(context).includes("raw-new-account"), false);
});

test("unchanged ordinary values are suppressed while explicit sensitive changes remain actionable", () => {
  assert.equal(meaningfulFieldChange({
    field: "orgUnitId",
    previousValue: 4,
    newValue: 4,
  }), false);
  assert.equal(meaningfulFieldChange({
    field: "payoutDestination",
    sensitive: true,
  }), true);
});

test("Automation Studio exposes employee field changes and threshold evidence", () => {
  const engine = read("src/lib/automation.ts");
  const panel = read("src/components/automation-studio-panel.tsx");

  assert.ok(engine.includes('"employee.field_changed"'));
  for (const field of [
    "changeField",
    "changeDirection",
    "changeTiming",
    "changeSource",
    "previousValue",
    "newValue",
    "previousNumericValue",
    "newNumericValue",
    "changeAmount",
    "changePercent",
  ]) {
    assert.ok(engine.includes(`value: "${field}"`), `missing field-change condition ${field}`);
  }
  assert.ok(panel.includes('"employee.field_changed"'));
  assert.ok(panel.includes('field?.kind === "boolean"'));
});

test("authoritative employee, HCM, compensation, payout and worksite paths emit field changes", () => {
  const employees = read("src/app/api/employees/route.ts");
  const hcm = read("src/lib/hcm-effective-changes.ts");
  const compensation = read("src/lib/hcm-compensation.ts");
  const payout = read("src/app/api/payout-destination-changes/[id]/route.ts");
  const worksites = read("src/app/api/workforce/worksites/route.ts");
  const separation = read("src/app/api/separation/route.ts");

  assert.ok(employees.includes("runEmployeeFieldChangeAutomations"));
  assert.ok(employees.includes('field: "monthlyEquivalentSalary"'));
  assert.ok(hcm.includes('field: "managerEmployeeId"'));
  assert.ok(hcm.includes('field: "legalEntityId"'));
  assert.ok(hcm.includes('field: "costCenterId"'));
  assert.ok(compensation.includes('field: "annualSalary"'));
  assert.ok(compensation.includes('field: "monthlyEquivalentSalary"'));
  assert.ok(payout.includes('field: "payoutDestination"'));
  assert.ok(payout.includes("sensitive: true"));
  assert.ok(worksites.includes('field: "worksiteId"'));
  assert.ok(worksites.includes('timing: effectiveFrom > todayPh ? "scheduled" : "effective"'));
  assert.ok(separation.includes('field: "employeeStatus"'));
  assert.ok(separation.includes('source: "separation-release"'));
});
