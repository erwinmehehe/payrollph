import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const automation = readFileSync("src/lib/automation.ts", "utf8");
const helper = readFileSync("src/lib/statutory-contribution-automation.ts", "utf8");
const selfRoute = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
const postingImport = readFileSync(
  "src/app/api/compliance/statutory-remittances/posting-import/route.ts",
  "utf8",
);

test("contribution.discrepancy_detected is live and no compliance triggers remain planned", () => {
  const liveStart = automation.indexOf("export const AUTOMATION_LIVE_TRIGGERS");
  const plannedStart = automation.indexOf("export const AUTOMATION_PLANNED_TRIGGERS");
  const live = automation.slice(liveStart, plannedStart);
  const planned = automation.slice(
    plannedStart,
    automation.indexOf("export function automationTriggerIsLive", plannedStart),
  );

  assert.ok(live.includes('"contribution.discrepancy_detected"'));
  assert.ok(planned.includes("AUTOMATION_PLANNED_TRIGGERS = []"));
});

test("discrepancy automation is employee scoped and idempotent by immutable case id", () => {
  assert.ok(helper.includes('trigger: "contribution.discrepancy_detected"'));
  assert.ok(helper.includes("employeeId: input.employeeId"));
  assert.ok(helper.includes(
    "contribution-discrepancy-detected:${input.caseId}",
  ));
  assert.ok(helper.includes("legalEntityId: input.legalEntityId"));
  assert.ok(helper.includes("contributionCaseId: input.caseId"));
});

test("employee-reported contribution cases emit only after the case transaction commits", () => {
  const transactionStart = selfRoute.indexOf("const created = await db.transaction");
  const automationCall = selfRoute.indexOf("emitContributionDiscrepancyAutomation({");
  assert.ok(transactionStart >= 0);
  assert.ok(automationCall > transactionStart);
  assert.ok(selfRoute.includes('source: "employee_report"'));
  assert.ok(selfRoute.includes("caseId: created.id"));
});

test("posting-import amount mismatches emit from the system-created case ledger", () => {
  assert.ok(postingImport.includes("amountMismatchCandidates"));
  assert.ok(postingImport.includes("createdIssues"));
  assert.ok(postingImport.includes("mismatchResult.createdIssues"));
  assert.ok(postingImport.includes('source: "statutory_posting_import"'));
  assert.ok(postingImport.includes("evidenceArtifactId: mismatchResult.artifact.id"));
  assert.ok(postingImport.includes("autoCaseAutomationEvents += 1"));
});

test("discrepancy routing fields are available to Automation Studio conditions", () => {
  for (const field of [
    "contributionIssueType",
    "contributionSource",
    "contributionSeverity",
    "contributionCaseId",
  ]) {
    assert.ok(automation.includes(`value: "${field}"`), `missing condition field ${field}`);
    assert.ok(helper.includes(`${field}:`), `missing event context field ${field}`);
  }

  for (const field of ["statutoryAgency", "applicableMonth", "legalEntityId"]) {
    assert.ok(helper.includes(`${field}:`) || helper.includes(`${field}: input.`));
  }
});

test("automation failures are isolated from authoritative contribution cases", () => {
  assert.ok(helper.includes('status: "engine_error"'));
  assert.ok(helper.includes("Contribution discrepancy automation failed."));
  assert.ok(selfRoute.includes("notifyPayrollOfContributionCase"));
  assert.ok(postingImport.includes("No posting rows were applied"));
});
