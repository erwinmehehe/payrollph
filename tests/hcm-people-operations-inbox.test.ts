import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPeopleOperationsItems,
  paginatePeopleOperationsItems,
  type PeopleOpsInput,
} from "../src/lib/hcm-people-operations-inbox";

const read = (path: string) => readFileSync(path, "utf8");
const worker = {
  id: 10,
  employeeNo: "W-010",
  employeeName: "Ada Reyes",
  status: "Active",
  startDate: "2026-01-01",
};
const current = {
  id: 25, employeeId: 10, assignmentType: "primary",
  effectiveFrom: "2026-01-01", effectiveUntil: null,
};
const cleared = {
  id: 8, employeeId: 10, status: "released",
  lastDay: "2026-09-30", clearanceStatus: "cleared",
  itCleared: true, adminCleared: true, financeCleared: true, hrCleared: true,
};

function fixture(override: Partial<PeopleOpsInput> = {}): PeopleOpsInput {
  return {
    today: "2026-10-09",
    employees: [worker],
    lifecycle: [],
    provisioning: [],
    reviews: [],
    positions: [current],
    separations: [],
    assets: [],
    ...override,
  };
}

test("employment action uses static messages and prioritizes overdue source review", () => {
  const result = buildPeopleOperationsItems(fixture({
    employees: [worker, {
      id: 11, employeeNo: "W-011", employeeName: "Ben Cruz",
      status: "Active", startDate: "2026-01-01",
    }],
    lifecycle: [
      { employeeId: 10, state: "upcoming", action: "record_decision", dueDate: "2026-10-16", daysUntil: 7 },
      { employeeId: 11, state: "action_required", action: "retry_decision", dueDate: "2026-10-05", daysUntil: -4 },
    ],
  }));
  assert.equal(result[0].employeeId, 11);
  assert.equal(result[0].priority, "review");
  assert.equal(result[0].daysUntil, -4);
  assert.match(result[0].detail, /do not bypass maker-checker/i);
  assert.equal(result.find((row) => row.id === "employment:10")?.priority, "follow_up");
});

test("unconfigured employment terms are optional record checks, never presumed violations", () => {
  const result = buildPeopleOperationsItems(fixture({
    lifecycle: [{ employeeId: 10, state: "unconfigured", action: "configure_terms", dueDate: null, daysUntil: null }],
  }));
  const item = result.find((row) => row.category === "employment");
  assert.equal(item?.priority, "source_check");
  assert.match(item?.detail ?? "", /historical exceptions/);
});

test("open onboarding is one batched follow-up, not one duplicated item per task", () => {
  const result = buildPeopleOperationsItems(fixture({
    provisioning: [
      { employeeId: 10, kind: "onboarding", done: false },
      { employeeId: 10, kind: "onboarding", done: false },
      { employeeId: 10, kind: "onboarding", done: true },
    ],
  }));
  assert.equal(result.filter((row) => row.category === "onboarding").length, 1);
  assert.match(result.find((row) => row.category === "onboarding")?.detail ?? "", /2 of 3/);
});

test("missing recent-hire onboarding is neutral, and missing legacy onboarding is not flagged", () => {
  const recent = buildPeopleOperationsItems(fixture({
    employees: [{ ...worker, startDate: "2026-10-05" }],
  }));
  assert.equal(recent.find((row) => row.category === "onboarding")?.priority, "source_check");
  assert.match(recent.find((row) => row.category === "onboarding")?.detail ?? "", /legitimately/);
  const old = buildPeopleOperationsItems(fixture());
  assert.equal(old.some((row) => row.category === "onboarding"), false);
});

test("primary assignment respects its effective date and expiry", () => {
  const future = buildPeopleOperationsItems(fixture({
    positions: [{ ...current, effectiveFrom: "2026-10-20" }],
  }));
  const next = future.find((row) => row.category === "position");
  assert.equal(next?.priority, "follow_up");
  assert.equal(next?.dueDate, "2026-10-20");
  assert.equal(next?.daysUntil, 11);
  const expired = buildPeopleOperationsItems(fixture({
    positions: [{ ...current, effectiveUntil: "2026-10-08" }],
  }));
  assert.equal(expired.find((row) => row.category === "position")?.priority, "source_check");
  assert.equal(buildPeopleOperationsItems(fixture()).some((row) => row.category === "position"), false);
});

test("performance only follows the latest active review and never includes ratings", () => {
  const result = buildPeopleOperationsItems(fixture({
    reviews: [
      { id: 4, employeeId: 10, status: "completed" },
      { id: 9, employeeId: 10, status: "in_progress" },
    ],
  }));
  const item = result.find((row) => row.category === "performance");
  assert.equal(item?.priority, "follow_up");
  assert.equal(item?.page, "Performance");
  assert.ok(!JSON.stringify(item).includes("score"));
  const closed = buildPeopleOperationsItems(fixture({
    reviews: [{ id: 10, employeeId: 10, status: "completed" }],
  }));
  assert.equal(closed.some((row) => row.category === "performance"), false);
});

test("released Separation with fully cleared checklist and assets produces no alert", () => {
  const result = buildPeopleOperationsItems(fixture({
    employees: [{ ...worker, status: "Separated" }],
    separations: [cleared],
    provisioning: [{ employeeId: 10, kind: "offboarding", done: true }],
    assets: [{ employeeId: 10, status: "returned", returnedOn: "2026-09-29" }],
  }));
  assert.equal(result.some((row) => row.category === "separation"), false);
});

test("released Separation with incomplete clearance or assets remains a review finding", () => {
  const first = buildPeopleOperationsItems(fixture({
    employees: [{ ...worker, status: "Separated" }],
    separations: [cleared],
    provisioning: [{ employeeId: 10, kind: "offboarding", done: false }],
    assets: [{ employeeId: 10, status: "assigned", returnedOn: null }],
  }));
  const item = first.find((row) => row.category === "separation");
  assert.equal(item?.priority, "review");
  assert.match(item?.detail ?? "", /Bank settlement is not verified/);
  const second = buildPeopleOperationsItems(fixture({
    employees: [{ ...worker, status: "Separated" }],
    separations: [{ ...cleared, clearanceStatus: "in_progress", itCleared: false }],
  }));
  assert.equal(second.find((row) => row.category === "separation")?.priority, "review");
});

test("pending Separation becomes review when last day is past, otherwise follow up", () => {
  const future = buildPeopleOperationsItems(fixture({
    separations: [{ ...cleared, id: 12, lastDay: "2026-11-04", status: "draft" }],
  }));
  assert.equal(future.find((row) => row.category === "separation")?.priority, "follow_up");
  const past = buildPeopleOperationsItems(fixture({
    separations: [{ ...cleared, id: 12, lastDay: "2026-10-08", status: "approved" }],
  }));
  assert.equal(past.find((row) => row.category === "separation")?.priority, "review");
});

test("source exit handoff is not duplicated when a Separation package exists", () => {
  const result = buildPeopleOperationsItems(fixture({
    lifecycle: [{ employeeId: 10, state: "in_progress", action: "continue_separation",
      dueDate: "2026-10-15", daysUntil: 6 }],
    separations: [{ ...cleared, status: "draft" }],
  }));
  assert.equal(result.filter((row) => row.page === "Separation").length, 1);
  assert.equal(result.find((row) => row.page === "Separation")?.category, "separation");
});

test("historical exit without linked Separation is a source check, not a wage assertion", () => {
  const result = buildPeopleOperationsItems(fixture({
    employees: [{ ...worker, status: "Terminated" }],
  }));
  const item = result.find((row) => row.category === "separation");
  assert.equal(item?.priority, "source_check");
  assert.match(item?.detail ?? "", /legitimately/);
  assert.ok(!JSON.stringify(result).includes("unpaid wages"));
});

test("future hires are not treated as active incumbents or overdue onboarding", () => {
  const result = buildPeopleOperationsItems(fixture({
    employees: [{ ...worker, startDate: "2026-12-01" }],
    positions: [],
  }));
  assert.equal(result.some((row) => ["position", "onboarding", "performance"].includes(row.category)), false);
});

test("worklist pagination preserves global summary and filters on the server", () => {
  const rows = buildPeopleOperationsItems(fixture({
    employees: [worker, { ...worker, id: 11, employeeNo: "W-011", employeeName: "Ben Cruz" }],
    positions: [],
    lifecycle: [{ employeeId: 10, state: "action_required", action: "review_decision",
      dueDate: "2026-10-07", daysUntil: -2 }],
  }));
  const overall = paginatePeopleOperationsItems("2026-10-09", rows, { page: 1, pageSize: 2 });
  assert.equal(overall.rows.length, 2);
  assert.ok(overall.pages > 1);
  assert.equal(overall.summary.total, rows.length);
  const filtered = paginatePeopleOperationsItems("2026-10-09", rows, {
    category: "position", priority: "source_check", search: "Ben", pageSize: 1, page: 9,
  });
  assert.equal(filtered.filteredTotal, 1);
  assert.equal(filtered.page, 1);
  assert.equal(filtered.rows[0].employeeId, 11);
  assert.equal(filtered.summary.total, rows.length);
  assert.equal(filtered.summary.employeesAffected, 2);
});

test("unknown and cross-tenant employee sources cannot appear without a loaded company worker", () => {
  const results = buildPeopleOperationsItems(fixture({
    lifecycle: [{ employeeId: 999, state: "action_required", action: "retry_decision",
      dueDate: "2026-10-08", daysUntil: -1 }],
    provisioning: [{ employeeId: 999, kind: "onboarding", done: false }],
    reviews: [{ id: 500, employeeId: 999, status: "in_progress" }],
  }));
  assert.equal(results.some((row) => row.employeeId === 999), false);
});

test("server selects are batched, tenant qualified and do not expose payroll or compensation data", () => {
  const server = read("src/lib/hcm-people-operations-inbox-server.ts");
  for (const source of [
    "eq(employees.organizationId, organizationId)",
    "eq(provisioningTasks.organizationId, organizationId)",
    "eq(performanceReviews.organizationId, organizationId)",
    "eq(positionAssignments.organizationId, organizationId)",
    "eq(separationRecords.organizationId, organizationId)",
    "eq(assets.organizationId, organizationId)",
    "loadEmploymentLifecycleReadiness(organizationId, today)",
  ]) assert.ok(server.includes(source), "Missing tenant-scoped source: " + source);
  assert.ok(server.includes("Promise.all(["));
  assert.ok(!server.includes("basicRate:"));
  assert.ok(!server.includes("netFinalPay:"));
  assert.ok(!server.includes("bankAccount:"));
  assert.ok(!server.includes("finalScore:"));
  const helper = read("src/lib/hcm-people-operations-inbox.ts");
  assert.ok(!helper.includes("db.update("));
  assert.ok(!helper.includes("db.insert("));
});

test("API denies cross-role, unit-scoped and custom-permission-set access before loading sources", () => {
  const route = read("src/app/api/hcm/people-operations-inbox/route.ts");
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("assertOrganizationRole("));
  assert.ok(route.includes("!access?.companyWide"));
  assert.ok(route.indexOf("assertOrganizationRole(") < route.indexOf("loadPeopleOperationsInbox(organizationId,"));
  assert.ok(route.includes('private, no-store'));
  assert.ok(route.includes("pageSize > 50"));
  assert.ok(route.includes("search.length > 80"));
  assert.ok(!route.includes("export async function POST"));
  assert.ok(!route.includes("export async function PATCH"));
});

test("People UI preserves existing lifecycle tools and supports safe navigation", () => {
  const source = read("src/components/workspace/people.tsx");
  const inbox = read("src/components/hcm-people-operations-inbox.tsx");
  assert.ok(source.includes("HcmPeopleOperationsInbox"));
  assert.ok(source.indexOf("<HcmPeopleOperationsInbox") < source.indexOf("<HcmEmploymentLifecycleActionCenter"));
  assert.ok(source.includes("onOpenWorker={(employeeId) => {"));
  assert.ok(source.includes("HcmWorkerJourneyActions journey={connectedProfile.journey}"));
  assert.ok(source.includes("Leave account number blank to keep the saved destination"));
  assert.ok(inbox.includes("onPage(row.page)"));
  assert.ok(inbox.includes("controller.abort()"));
  assert.ok(inbox.includes("response?.organizationId === organizationId"));
  assert.ok(!inbox.includes('method: "POST"'));
});
