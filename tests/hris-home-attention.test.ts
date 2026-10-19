import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HrisHomeShortcuts } from "../src/components/hris-home-shortcuts";
import { HRIS_HOME_SHORTCUTS } from "../src/lib/hris-home-shortcuts";
import { summarizeEverydayHrAttention } from "../src/lib/hris-home-attention";

const employees = [
  { id: 1, employeeNo: "A-01", firstName: "Ana", lastName: "Cruz", title: "HR Associate", status: "Active" },
  { id: 2, employeeNo: "A-02", firstName: "Ben", lastName: "Reyes", title: "HR Associate", status: "Active" },
];
const task = (id: number, employeeId: number, done = false, kind = "onboarding") =>
  ({ id, employeeId, done, kind, title: "Source task " + id, owner: "HR" });

test("Everyday HR derives attention from recorded authorized workers, not cross-employer or other task kinds", () => {
  const raw = [
    task(11, 1),
    task(12, 1, true),
    task(13, 2),
    task(14, 3), // employee outside current authorized employer snapshot
    task(15, 2, false, "offboarding"),
    task(11, 2), // duplicate task ID must not be counted twice
  ];
  const approvals = [{ status: "Pending" }, { status: "Approved" }, { status: "Pending" }];
  const before = JSON.stringify({ employees, raw, approvals });
  const result = summarizeEverydayHrAttention({ employees, provisioning: raw, approvals });
  assert.deepEqual(result, {
    onboarding: { recordedWorkers: 2, openWorkers: 2, openTasks: 2 },
    pendingApprovals: 2,
  });
  assert.equal(JSON.stringify({ employees, raw, approvals }), before);
});

test("a missing onboarding source is unknown, not zero or an HR-completion claim", () => {
  const unknown = summarizeEverydayHrAttention({
    employees, provisioning: undefined, approvals: [],
  });
  assert.equal(unknown.onboarding, null);
  const empty = summarizeEverydayHrAttention({
    employees, provisioning: [], approvals: [],
  });
  assert.deepEqual(empty.onboarding, { recordedWorkers: 0, openWorkers: 0, openTasks: 0 });
  const completedRecorded = summarizeEverydayHrAttention({
    employees, provisioning: [task(22, 1, true)], approvals: [],
  });
  assert.deepEqual(completedRecorded.onboarding,
    { recordedWorkers: 1, openWorkers: 0, openTasks: 0 });
});

test("HR home exposes only permitted source-navigation attention and never a new write action", () => {
  const actions = HRIS_HOME_SHORTCUTS.filter(a => ["hiring", "approvals"].includes(a.id));
  const page = renderToStaticMarkup(createElement(HrisHomeShortcuts, {
    actions, onPage: () => {}, employees: [], provisioning: [task(31, 1)],
    approvalTasks: [{ status: "Pending" }],
  }));
  assert.match(page, /Onboarding follow-ups/);
  assert.match(page, /No checklists recorded; onboarding is not verified/);
  assert.match(page, /1 pending tasks in your current workspace view/);
  assert.doesNotMatch(page, /\bApprove task\b|\bMark complete\b/);

  const approvalsOnly = renderToStaticMarkup(createElement(HrisHomeShortcuts, {
    actions: actions.filter(a => a.id === "approvals"), onPage: () => {},
    employees, provisioning: [task(32, 1)], approvalTasks: [{ status: "Pending" }],
  }));
  assert.doesNotMatch(approvalsOnly, /Onboarding follow-ups/);
  assert.match(approvalsOnly, /Pending approvals/);
  const noSource = renderToStaticMarkup(createElement(HrisHomeShortcuts, {
    actions, onPage: () => {}, employees, approvalTasks: [],
  }));
  assert.match(noSource, /Onboarding source unavailable/);
  assert.match(noSource, /open the checklist to reload recorded tasks/);
});
