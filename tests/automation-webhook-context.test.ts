import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { safeAutomationWebhookContext } from "../src/lib/automation-webhook-context";
import { AUTOMATION_TRIGGERS } from "../src/lib/automation";

test("every supported automation trigger has a minimal safe outbound payload", () => {
  const context = {
    effectiveDate: "2026-10-10",
    payDate: "2026-10-15",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    workDate: "2026-10-10",
    startDate: "2026-10-11",
    endDate: "2026-10-12",
    cutoffDate: "2026-10-15",
    expiryDate: "2026-10-31",
    dueDate: "2026-10-14",
    applicableMonth: "2026-10",
    salary: 100000,
    monthlyBasic: 95000,
    netPay: 70000,
    gross: 100000,
    bankAccount: "12345678",
    tin: "987654321",
    sssNo: "1234",
    employeeId: 44,
    governmentId: "999999999",
    description: "medical leave diagnosis",
    discipline: "private disciplinary record",
    customText: "A full name and free text",
  };
  for (const trigger of AUTOMATION_TRIGGERS) {
    const data = safeAutomationWebhookContext(trigger, context);
    assert.ok(Object.keys(data).length <= 3, trigger);
    for (const [key, value] of Object.entries(data)) {
      assert.match(key, /(?:Date|Month|Start|End)$/);
      assert.match(value, /^\d{4}-\d{2}(?:-\d{2})?$/);
      assert.ok(!["employeeId", "salary", "netPay", "bankAccount", "tin", "governmentId", "description", "discipline"].includes(key));
    }
  }
});

test("external webhook never receives raw context, employee id or event key", () => {
  const source = readFileSync("src/lib/automation.ts", "utf8");
  const start = source.indexOf('if (action.type === "webhook")');
  assert.ok(start > 0);
  const block = source.slice(start, source.indexOf("const exhaustive", start));
  assert.ok(block.includes("safeAutomationWebhookContext(input.trigger, input.context)"));
  assert.ok(!/employeeId: input\.employeeId/.test(block));
  assert.ok(!/eventKey: input\.eventKey/.test(block));
  assert.ok(!/context: input\.context/.test(block));
});

test("unknown triggers and invalid dates send an empty context", () => {
  assert.deepEqual(safeAutomationWebhookContext("unexpected.event", { payDate: "2026-10-15" }), {});
  assert.deepEqual(safeAutomationWebhookContext("payroll.created", {
    payDate: "employee@example.com",
    periodStart: "2026-99-01",
    periodEnd: "2026-10-77",
  }), {});
});
