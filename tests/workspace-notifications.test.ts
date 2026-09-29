import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardData } from "../src/components/workspace/types";
import { buildNotifications } from "../src/lib/workspace-notifications";

function data(overrides: Record<string, unknown> = {}) {
  const base = {
    access: { role: "owner" },
    user: { role: "owner" },
    payrollRuns: [
      {
        id: 41,
        periodLabel: "Sep 16–30, 2026",
        status: "Needs review",
        employeeCount: 18,
        exceptions: 0,
      },
    ],
    tasks: [],
    leaveRequests: [],
    punches: [],
    employees: [
      {
        id: 1,
        status: "Active",
        tin: "123",
        sssNo: "34",
        philHealthNo: "56",
        pagIbigNo: "78",
      },
    ],
    provisioning: [],
  };
  return { ...base, ...overrides } as unknown as DashboardData;
}

test("HR notifications point only to unresolved people-input work", () => {
  const notifications = buildNotifications(
    data({
      leaveRequests: [{ id: 1, status: "Pending" }],
      punches: [{ id: 1, status: "Incomplete" }],
      employees: [
        {
          id: 1,
          status: "Active",
          tin: null,
          sssNo: "34",
          philHealthNo: "56",
          pagIbigNo: "78",
        },
      ],
      provisioning: [{ id: 1, done: false }],
    }),
    "hr",
  );

  assert.deepEqual(
    notifications.map((item) => item.id),
    ["hr-pending-leave", "hr-attendance", "hr-government-ids", "hr-provisioning"],
  );
  assert.deepEqual(
    notifications.map((item) => item.page),
    ["Leave", "Time & attendance", "People", "People"],
  );
});

test("HR notifications disappear when the underlying work is complete", () => {
  assert.deepEqual(buildNotifications(data(), "hr"), []);
});

test("Payroll sees upstream cutoff blockers before its own run action", () => {
  const notifications = buildNotifications(
    data({
      leaveRequests: [{ id: 1, status: "Pending" }],
      punches: [{ id: 1, status: "Incomplete" }],
      employees: [
        {
          id: 1,
          status: "Active",
          tin: null,
          sssNo: "34",
          philHealthNo: "56",
          pagIbigNo: "78",
        },
      ],
      payrollRuns: [
        {
          id: 41,
          periodLabel: "Sep 16–30, 2026",
          status: "Needs review",
          employeeCount: 18,
          exceptions: 2,
        },
      ],
    }),
    "payroll",
  );

  assert.equal(notifications[0]?.id, "payroll-cutoff-blockers");
  assert.equal(notifications[0]?.actionLabel, "Review blockers");
  assert.ok(notifications.some((item) => item.id === "payroll-run-41"));
});

test("Checker sees only pending independent decisions", () => {
  const notifications = buildNotifications(
    data({
      tasks: [
        {
          id: 7,
          title: "Review payroll",
          detail: "Payroll run #41",
          dueLabel: "Today",
          priority: "High",
          status: "Pending",
        },
        {
          id: 8,
          title: "Old review",
          detail: "Payroll run #40",
          dueLabel: "Yesterday",
          priority: "Normal",
          status: "Approved",
        },
      ],
    }),
    "checker",
  );

  assert.deepEqual(notifications.map((item) => item.id), ["checker-task-7"]);
  assert.equal(notifications[0]?.page, "Approvals");
  assert.equal(notifications[0]?.actionLabel, "Review decision");
});

test("Owner release notification exists only when the run is actually ready", () => {
  const ready = buildNotifications(
    data({
      payrollRuns: [
        {
          id: 41,
          periodLabel: "Sep 16–30, 2026",
          status: "Ready for release",
          employeeCount: 18,
          exceptions: 0,
        },
      ],
    }),
    "owner",
  );
  assert.equal(ready[0]?.id, "owner-release-41");
  assert.equal(ready[0]?.actionLabel, "Release payroll");

  const released = buildNotifications(
    data({
      payrollRuns: [
        {
          id: 41,
          periodLabel: "Sep 16–30, 2026",
          status: "Released",
          employeeCount: 18,
          exceptions: 0,
        },
      ],
    }),
    "owner",
  );
  assert.ok(!released.some((item) => item.id === "owner-release-41"));
});
