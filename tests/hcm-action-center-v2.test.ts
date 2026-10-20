import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  HCM_BP_SCAN_LIMIT, HCM_BP_HISTORY_LIMIT, canReadCompanyHcmHistory,
  projectHcmProcessSummary, reviewDeclineError,
} from "../src/lib/hcm-action-center";

test("Business Process v2 only accepts reasoned terminal review decline", () => {
  assert.equal(reviewDeclineError("complete", "review", ""), null);
  assert.equal(reviewDeclineError("decline", "to_do", ""), null);
  assert.equal(reviewDeclineError("decline", "approval", ""), null);
  assert.match(reviewDeclineError("decline", "review", "") ?? "", /requires a reason/i);
  assert.match(reviewDeclineError("decline", "review", "short") ?? "", /10/);
  assert.equal(reviewDeclineError("decline", "review", "Missing evidence for effective-date request"), null);
  assert.match(reviewDeclineError("decline", "review", "x".repeat(501)) ?? "", /500/);
  assert.match(reviewDeclineError("decline", "review", { text: "reason" }) ?? "", /requires a reason/i);
});

test("Action Center history projection never serializes frozen evidence, source keys or notes", () => {
  const row = {
    id: 20, processType: "promotion", status: "in_progress",
    effectiveDate: "2026-10-11", initiatedByName: "Fictional HR",
    initiatedAt: new Date("2026-10-10T02:00:00Z"),
    completedAt: null, employeeId: 3,
    definitionSnapshot: {
      name: "Promotion review", sourceEvidence: { bankAccount: "DoNotLeakBank" },
      notes: "DoNotLeakNote",
    },
    sourceKey: "DoNotLeakSource", sourceType: "internal_secret",
    decisionNote: "DoNotLeakDecision",
  };
  const projected = projectHcmProcessSummary(row);
  assert.deepEqual(Object.keys(projected).sort(), [
    "completedAt", "effectiveDate", "employeeId", "id",
    "initiatedAt", "initiatedByName", "processName", "processType", "status",
  ].sort());
  assert.equal(projected.processName, "Promotion review");
  assert.equal(projected.initiatedAt, "2026-10-10T02:00:00.000Z");
  for (const secret of ["DoNotLeakBank", "DoNotLeakNote", "DoNotLeakSource", "DoNotLeakDecision"]) {
    assert.ok(!JSON.stringify(projected).includes(secret));
  }
});

test("Company-wide history excludes bookkeeper and all scoped roles", () => {
  for (const role of ["owner", "admin", "hr"]) {
    assert.ok(canReadCompanyHcmHistory({ role, companyWide: true }));
    assert.ok(!canReadCompanyHcmHistory({ role, companyWide: false }));
  }
  for (const role of ["manager", "bookkeeper", "payroll", "checker", "employee"]) {
    assert.ok(!canReadCompanyHcmHistory({ role, companyWide: true }));
  }
});

test("Action Center business-process source is bounded, tenant-scoped and non-caching", () => {
  assert.ok(HCM_BP_SCAN_LIMIT > 0 && HCM_BP_SCAN_LIMIT <= 150);
  assert.ok(HCM_BP_HISTORY_LIMIT > 0 && HCM_BP_HISTORY_LIMIT <= 25);
  const route = readFileSync("src/app/api/hcm/business-processes/inbox/route.ts", "utf8");
  assert.ok(route.includes(".limit(HCM_BP_SCAN_LIMIT + 1)"));
  assert.ok(route.includes(".limit(HCM_BP_HISTORY_LIMIT + 1)"));
  assert.ok(route.includes("loadPeopleHomeAssigneePermissions("));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes("eq(hcmBusinessProcessInstances.organizationId, organizationId)"));
  assert.ok(route.includes("private, no-store"));
  assert.ok(route.includes("reviewDeclineError(action, row.step.stepType, body.note)"));
  assert.ok(route.includes("canDecide("), "mutation authority must remain source-bound");
  assert.ok(!route.includes("...row,"), "unbounded source object must not be sent to the browser");
});

test("People workspace remounts HCM Inbox when the selected employer changes", () => {
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.ok(people.includes('key={`hcm-bp-inbox:${data.selectedOrganization.id}`}'),
    "The HCM Inbox must remount on employer change using a unique component key");
  assert.ok(people.includes('key={`hcm-bp-admin:${data.selectedOrganization.id}`}'),
    "The Inbox must not share a sibling key with the HCM Admin panel");
  const client = readFileSync("src/components/hcm-business-process-inbox.tsx", "utf8");
  assert.ok(client.includes("requestSequence.current"));
});
