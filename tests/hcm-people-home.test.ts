import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  projectHcmDecisions, projectPeopleFollowUps, projectOperationalCases,
} from "../src/lib/hcm-people-home-projection";

test("HCM decisions preserve governed source and maker-checker state without sensitive data", () => {
  const rows = projectHcmDecisions(11, [
    { id: 7, stepType: "approval", makerBlocked: true, dueAt: null, processType: "promotion", employee: { id: 27 } },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, 11);
  assert.equal(rows[0].source, "hcm_business_process");
  assert.equal(rows[0].status, "blocked_self_review");
  assert.equal(rows[0].dueAt, null);
  assert.equal(rows[0].subjectEmployeeId, 27);
  assert.equal(rows[0].actionRoute, "People");
  assert.ok(!JSON.stringify(rows).includes("salary"));
});

test("HR source checks never impersonate approvals or SLAs", () => {
  const rows = projectPeopleFollowUps(12, [
    { id: "position:44", employeeId: 44, category: "position", priority: "source_check", dueDate: null, page: "Planning" },
    { id: "employment:44", employeeId: 44, category: "employment", priority: "review", dueDate: "2026-10-13", page: "People" },
  ]);
  assert.equal(rows[0].status, "source_check");
  assert.equal(rows[0].incompleteEvidence, true);
  assert.equal(rows[0].dueAt, null);
  assert.equal(rows[1].sourceDate, "2026-10-13");
  assert.equal(rows[1].dueAt, null);
  assert.equal(rows[1].status, "review_needed");
});

test("operational case projection strips owner and free-text fields", () => {
  const source = [
    { id: 6, status: "open", dueAt: "2026-10-10T09:00:00Z", detail: "Sensitive HR investigation", ownerName: "Manager X" },
    { id: 7, status: "resolved", dueAt: null },
  ];
  const result = projectOperationalCases(13, source);
  assert.equal(result.length, 1);
  assert.equal(result[0].actionRoute, "WorkQueue");
  assert.ok(!JSON.stringify(result).includes("Sensitive HR investigation"));
  assert.ok(!JSON.stringify(result).includes("Manager X"));
});

test("invalid tenant or source IDs never generate projected work", () => {
  assert.deepEqual(projectHcmDecisions(0, [{ id: 1, stepType: "review", dueAt: null, processType: "hire" }]), []);
  assert.deepEqual(projectOperationalCases(1, [{ id: -5, status: "open", dueAt: null }]), []);
});

test("People Home is disabled by default and resets/aborts on employer change", () => {
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const home = readFileSync("src/components/hcm-people-home.tsx", "utf8");
  const peopleOps = readFileSync("src/app/api/hcm/people-operations-inbox/route.ts", "utf8");
  const cases = readFileSync("src/app/api/hcm/work-items/route.ts", "utf8");
  assert.ok(workspace.includes('process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED === "true"'));
  assert.ok(workspace.includes('key={data.selectedOrganization.id}'));
  assert.ok(home.includes("controller.abort()"));
  assert.ok(home.includes("source unavailable") || home.includes("Source unavailable"));
  assert.ok(home.includes("data.selectedOrganization.id"));
  assert.ok(peopleOps.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(peopleOps.includes("!access?.companyWide"));
  assert.ok(cases.includes("assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)"));
  assert.ok(!home.includes('method: "POST"'));
  assert.ok(!home.includes('method: "PATCH"'));
});
