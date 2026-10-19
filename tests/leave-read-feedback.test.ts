import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DashboardData } from "../src/components/workspace/types";
import { hasVerifiedLeaveCollections } from "../src/lib/leave-read-contract";
import { DashboardReadError, readAuthorizedDashboard } from "../src/lib/dashboard-read-recovery";

const request = {
  id: 41, employeeId: 11, leaveType: "Annual leave",
  startDate: "2026-10-19", endDate: "2026-10-20", days: "2.0",
  status: "Pending", intervals: [],
};
const policy = {
  id: 8, leaveType: "Annual leave", annualDays: "15",
  payTreatment: "paid", paidPercentage: "100", active: true,
};
const snapshot = (leaveRequests: unknown, leavePolicies: unknown) =>
  ({ leaveRequests, leavePolicies } as DashboardData);

test("verified empty leave source is distinct from missing data", () => {
  assert.equal(hasVerifiedLeaveCollections(snapshot([], [])), true);
  assert.equal(hasVerifiedLeaveCollections(snapshot([request], [policy])), true);
  for (const input of [
    snapshot(undefined, []), snapshot([], undefined),
    snapshot(null, []), snapshot([], {}),
    snapshot({}, []), snapshot([request], null),
  ]) assert.equal(hasVerifiedLeaveCollections(input), false);
});

test("partial, invalid and malformed leave rows never produce verified totals", () => {
  for (const bad of [
    { ...request, employeeId: 0 },
    { ...request, id: 0 },
    { ...request, leaveType: undefined },
    { ...request, status: null },
    { ...request, days: "not-a-number" },
    { ...request, intervals: {} },
    { ...request, intervals: [null] },
  ]) assert.equal(hasVerifiedLeaveCollections(snapshot([bad], [policy])), false);
  for (const bad of [
    { ...policy, id: -1 },
    { ...policy, active: null },
    { ...policy, leaveType: null },
    { ...policy, annualDays: "invalid" },
    { ...policy, paidPercentage: undefined },
  ]) assert.equal(hasVerifiedLeaveCollections(snapshot([request], [bad])), false);
});

test("403, 500 and network failures reject their dashboard source instead of returning []", async () => {
  const body = { selectedOrganization: { id: 7 }, employees: [], organizations: [], tasks: [], payrollRuns: [] };
  for (const [status, kind] of [[403, "forbidden"], [500, "server"]] as const) {
    await assert.rejects(readAuthorizedDashboard(7, async () =>
      new Response(JSON.stringify(body), { status })),
    (error: unknown) => error instanceof DashboardReadError && error.kind === kind);
  }
  await assert.rejects(readAuthorizedDashboard(7, async () => {
    throw new Error("PRIVATE NETWORK DETAIL");
  }), (error: unknown) => error instanceof DashboardReadError &&
    error.kind === "network" && !error.message.includes("PRIVATE"));
});

test("leave page hides totals on incomplete and failed reads with GET-only retry", () => {
  const panel = readFileSync("src/components/workspace/panels.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const hook = readFileSync("src/lib/use-dashboard-read-recovery.ts", "utf8");
  assert.ok(panel.includes("loading || readFailed || !hasVerifiedLeaveCollections(data)"));
  assert.ok(panel.includes("role=\"alert\" aria-label=\"Leave records unavailable\""));
  assert.ok(panel.includes("Retry read-only leave refresh"));
  assert.ok(panel.includes("An unavailable register is not an empty register"));
  assert.ok(panel.includes("<VerifiedLeavePage key={data.selectedOrganization.id}"));
  assert.ok(panel.includes("const requests = data.leaveRequests;"));
  assert.ok(panel.includes("const policies = data.leavePolicies;"));
  assert.ok(!panel.includes("data.leaveRequests ?? []"));
  assert.ok(!panel.includes("data.leavePolicies ?? []"));
  assert.ok(workspace.includes("readFailed={refreshIssue !== null}"));
  assert.ok(workspace.includes("readLoading={refreshLoading}"));
  assert.ok(hook.includes("readAuthorizedDashboard(requestedOrganizationId)"));
  assert.ok(panel.includes("onRefresh().catch(() => undefined)"));
});
