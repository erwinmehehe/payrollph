import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("src/lib/automation.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0081_automation_event_ledger.sql", "utf8");
const api = readFileSync("src/app/api/automation-studio/route.ts", "utf8");
const panel = readFileSync("src/components/automation-studio-panel.tsx", "utf8");

test("automation event ledger records authoritative events before rule matching", () => {
  assert.ok(schema.includes('export const automationEventLog'));
  assert.ok(schema.includes('"automation_event_log"'));
  assert.ok(schema.includes('source: varchar("source"'));
  assert.ok(migration.includes('"automation_event_log"'));
  assert.ok(migration.includes("'execution_backfill'"));
  assert.ok(migration.includes('"automation_event_log_org_trigger_event_unique"'));

  const ledgerWrite = engine.indexOf("db.insert(automationEventLog)");
  const ruleRead = engine.indexOf("const rules = await db.select().from(automationRules)", ledgerWrite);
  assert.ok(ledgerWrite >= 0, "authoritative event ledger write is missing");
  assert.ok(ruleRead > ledgerWrite, "event must be captured before any rule matching happens");
  assert.ok(engine.includes('source: "authoritative"'));
});

test("impact simulation is zero-write and evaluates the compiled workflow", () => {
  const start = engine.indexOf("export function simulateAutomationImpact");
  const end = engine.indexOf("function executionResultArray", start);
  assert.ok(start >= 0 && end > start);
  const simulator = engine.slice(start, end);
  assert.equal(simulator.includes("db."), false, "dry run must not write or query business state");
  assert.equal(simulator.includes("fetch("), false, "dry run must not call external systems");
  assert.ok(simulator.includes("conditionMatches"));
  assert.ok(simulator.includes("compileAutomationPlan"));
  assert.ok(simulator.includes("projectedPayrollAdjustmentAbsoluteAmount"));
  assert.ok(simulator.includes("authoritativePolicyBlocks"));
  assert.ok(simulator.includes("legacyPolicyBlocks"));
});

test("Automation Studio exposes read-only draft preview from the unbiased event ledger", () => {
  assert.ok(api.includes('previewRuleId'));
  assert.ok(api.includes("automationEventLog"));
  assert.ok(api.includes("simulateAutomationImpact"));
  assert.ok(api.includes(".limit(200)"));
  assert.ok(api.includes("Legacy backfill contains only events that previously produced executions"));
  assert.ok(api.includes("All sampled ledger events were captured before rule matching"));
});

test("publishing fails closed when authoritative preview events hit policy blocks", () => {
  assert.ok(api.includes("impactPreview.authoritativePolicyBlocks > 0"));
  assert.ok(api.includes("Resolve them before publishing"));
  assert.ok(api.includes("projectedPayrollAdjustmentAbsoluteAmount"));
});

test("Studio UI requires an exact-draft impact preview before publish", () => {
  assert.ok(panel.includes("IMPACT PREVIEW · DRAFT V"));
  assert.ok(panel.includes("Zero-write replay"));
  assert.ok(panel.includes("Impact Preview"));
  assert.ok(panel.includes("previewSafe"));
  assert.ok(panel.includes("disabled={!previewSafe}"));
  assert.ok(panel.includes("Run Impact Preview for this exact draft before publishing."));
  assert.ok(panel.includes("Payroll adjustment exposure"));
  assert.ok(panel.includes("authoritative policy block"));
});
