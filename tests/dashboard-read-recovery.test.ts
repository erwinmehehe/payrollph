import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DashboardReadError, readAuthorizedDashboard } from "../src/lib/dashboard-read-recovery";

const authorized = {
  selectedOrganization: { id: 7, name: "Employer", legalName: "Employer" },
  organizations: [{ id: 7 }],
  employees: [{ id: 9, organizationId: 7, status: "Active" }],
  tasks: [], payrollRuns: [], payrollEntries: [], auditEvents: [], plans: [],
  templates: [], advisories: [], punches: [], leaveRequests: [],
  provisioning: [], retroAdjustments: [],
};

function respond(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("dashboard refresh GET is scoped to the selected employer, returning a validated snapshot", async () => {
  let calls = 0;
  const result = await readAuthorizedDashboard(7, async (url, options) => {
    calls++;
    assert.equal(url, "/api/dashboard?organizationId=7");
    assert.deepEqual(options, { cache: "no-store" });
    return new Response(JSON.stringify(authorized), { status: 200 });
  });
  assert.equal(result.selectedOrganization.id, 7);
  assert.equal(calls, 1);
});

test("403 and 401 fail closed, independently of the server error payload", async () => {
  for (const [status, kind] of [[401, "session"], [403, "forbidden"]] as const) {
    await assert.rejects(readAuthorizedDashboard(7, respond(status, { error: "SENSITIVE-SERVER-DETAIL" })),
      (error: unknown) => error instanceof DashboardReadError &&
        error.kind === kind && !error.message.includes("SENSITIVE"));
  }
});

test("server 500 and network errors never become a successful empty read", async () => {
  await assert.rejects(readAuthorizedDashboard(7, respond(500, { employees: [] })),
    (error: unknown) => error instanceof DashboardReadError && error.kind === "server");
  await assert.rejects(readAuthorizedDashboard(7, async () => { throw new Error("private network detail"); }),
    (error: unknown) => error instanceof DashboardReadError &&
      error.kind === "network" && !error.message.includes("private"));
});

test("wrong-employer or missing authoritative arrays are not applied", async () => {
  for (const body of [
    { ...authorized, selectedOrganization: { id: 8 } },
    { ...authorized, employees: undefined },
    { ...authorized, tasks: undefined },
    [],
  ]) {
    await assert.rejects(readAuthorizedDashboard(7, respond(200, body)),
      (error: unknown) => error instanceof DashboardReadError && error.kind === "scope");
  }
  await assert.rejects(readAuthorizedDashboard(0, respond(200, authorized)),
    (error: unknown) => error instanceof DashboardReadError && error.kind === "scope");
});

test("malformed success body fails as unreadable instead of empty", async () => {
  await assert.rejects(readAuthorizedDashboard(7, async () => new Response("not json", { status: 200 })),
    (error: unknown) => error instanceof DashboardReadError && error.kind === "invalid");
});

test("workspace exposes a GET-only retry and prevents late reads overwriting newer employer snapshots", () => {
  const source = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const hook = readFileSync("src/lib/use-dashboard-read-recovery.ts", "utf8");
  assert.ok(source.includes("useDashboardReadRecovery("));
  assert.ok(hook.includes("readAuthorizedDashboard(requestedOrganizationId)"));
  assert.ok(hook.includes("readVersion !== dashboardReadVersion.current"));
  assert.ok(hook.includes("dashboardReadVersion.current += 1"));
  assert.ok(hook.includes("setRefreshIssue(cause instanceof DashboardReadError"));
  assert.ok(source.includes("role=\"alert\""));
  assert.ok(source.includes("Retry read-only workspace refresh"));
  assert.ok(source.includes("refresh().catch(() => undefined)"));
  assert.ok(source.includes("refreshIssue.kind === \"session\""));
  assert.ok(source.includes("refreshIssue.kind === \"forbidden\""));
  assert.ok(source.includes("refreshIssue.kind === \"scope\""));
  assert.ok(!source.includes('fetch(`/api/dashboard?organizationId=${organizationId}`'));
  assert.ok(!hook.includes("method: \"POST\""));
  assert.ok(!hook.includes("method: \"PATCH\""));
});


test("verified empty is distinct from incomplete collections and wrong-employer people", async () => {
  const valid = await readAuthorizedDashboard(7, respond(200, authorized));
  assert.deepEqual(valid.payrollRuns, []);
  assert.deepEqual(valid.payrollEntries, []);
  for (const value of [
    { ...authorized, payrollEntries: undefined },
    { ...authorized, auditEvents: undefined },
    { ...authorized, selectedOrganization: { id: 7 } },
    { ...authorized, employees: [{ id: 9, organizationId: 8, status: "Active" }] },
    { ...authorized, payrollRuns: [{ id: 4 }] },
  ]) {
    await assert.rejects(readAuthorizedDashboard(7, respond(200, value)),
      (error: unknown) => error instanceof DashboardReadError && error.kind === "scope");
  }
});
test("payroll monetary amounts and entries must be scoped through complete parent run", async () => {
  const run = {
    id: 11, organizationId: 7, periodLabel: "October", status: "Ready for release",
    employeeCount: 1, exceptions: 0, grossPay: "100.00", netPay: "90.00",
  };
  const entry = { id: 15, payrollRunId: 11, employeeId: 9, status: "Ready", netPay: "90.00" };
  const full = { ...authorized, payrollRuns: [run], payrollEntries: [entry] };
  assert.equal((await readAuthorizedDashboard(7, respond(200, full))).payrollRuns.length, 1);
  for (const bad of [
    { ...full, payrollRuns: [{ ...run, organizationId: 999 }] },
    { ...full, payrollRuns: [{ ...run, netPay: undefined }] },
    { ...full, payrollRuns: [{ ...run, grossPay: "" }] },
    { ...full, payrollRuns: [{ ...run, exceptions: undefined }] },
    { ...full, payrollEntries: [{ ...entry, payrollRunId: 99 }] },
    { ...full, payrollEntries: [{ ...entry, netPay: null }] },
  ]) {
    await assert.rejects(readAuthorizedDashboard(7, respond(200, bad)),
      (error: unknown) => error instanceof DashboardReadError && error.kind === "scope");
  }
  // Retried verified source replaces a previously unavailable snapshot.
  await assert.rejects(readAuthorizedDashboard(7, respond(503, {})), DashboardReadError);
  assert.equal((await readAuthorizedDashboard(7, respond(200, full))).payrollRuns.length, 1);
});
