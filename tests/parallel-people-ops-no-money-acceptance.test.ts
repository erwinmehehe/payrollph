import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFirstPayrollReadiness } from "../src/lib/first-payroll-readiness";
import { buildFirstPayrollJourney } from "../src/lib/first-payroll-journey";
import { isVerifiedHcmWorkQueueResponse, summarizeVerifiedWorkQueue } from "../src/lib/hcm-work-queue-summary";
import { buildWfmOpsSignals, projectAttendanceOps, projectTimesheetOps } from "../src/lib/workforce-operations-inbox";

/** Fictitious employer/worker references only. No real identity or money. */
function caseFor(organizationId: number) {
  return {
    id: 501, organizationId, title: "Synthetic attendance review",
    detail: "Fictional case", caseType: "attendance_exception", status: "open",
    ownerTeam: "Timekeeping", ownerUserId: null, ownerName: null,
    dueAt: null, escalateAt: null, escalationLevel: 0, overdue: null,
  };
}

test("one employer's HR work-item response never verifies under another employer", () => {
  const a = { items: [caseFor(101)], owners: [] };
  const b = { items: [caseFor(202)], owners: [] };
  assert.equal(isVerifiedHcmWorkQueueResponse(a, 101), true);
  assert.equal(isVerifiedHcmWorkQueueResponse(a, 202), false);
  assert.equal(isVerifiedHcmWorkQueueResponse(b, 202), true);
  assert.equal(isVerifiedHcmWorkQueueResponse(b, 101), false);
  assert.equal(isVerifiedHcmWorkQueueResponse({ items: [caseFor(101), caseFor(202)], owners: [] }, 101), false);
  assert.equal(summarizeVerifiedWorkQueue(a.items, false), null, "Pending, stale and denied reads are not zero.");
  assert.deepEqual(summarizeVerifiedWorkQueue(b.items, true), { total: 1, overdue: 0, unassigned: 1 });
});

test("first payroll setup cannot certify payroll, approval or government filing", () => {
  const readiness = buildFirstPayrollReadiness({
    workspaceName: "Fictional employer",
    employees: [{ status: "Active", bankAccount: "enc:v1:synthetic", bankCode: "BPI" }],
    memberships: [{ role: "payroll" }, { role: "checker" }],
    payrollStatuses: [],
  });
  assert.equal(readiness.ready, true);
  const guide = buildFirstPayrollJourney(readiness);
  assert.equal(guide.find(item => item.key === "time")?.state, "review");
  assert.equal(guide.find(item => item.key === "payroll")?.state, "available");
  assert.equal(guide.find(item => item.key === "approval")?.state, "upcoming");
  assert.equal(guide.find(item => item.key === "exports")?.state, "upcoming");
  const afterRelease = buildFirstPayrollJourney({ ...readiness, firstPayrollStarted: true, firstPayrollReleased: true });
  assert.equal(afterRelease.find(item => item.key === "exports")?.state, "review");
});

test("WFM manager triage strips worker PII and never claims missing data is clear", () => {
  const attendance = projectAttendanceOps({
    summary: { open: 2, overdue: 1, unassigned: 1, resolved: 0 },
    workers: [{ employeeName: "SECRET_PERSON", bankNumber: "SECRET_BANK" }],
  });
  const timesheets = projectTimesheetOps({
    manager: true, policy: { active: true, enforcementMode: "block" },
    latest: [{ employeeId: 9, status: "submitted", blockerCount: 1, notes: "SECRET_PERSON" }],
    expectations: [{ employeeId: 10, status: "expected" }],
  });
  const signals = buildWfmOpsSignals(attendance, timesheets);
  assert.ok(signals.some(s => s.priority === "urgent" && s.destination === "timesheets"));
  assert.ok(!JSON.stringify({ attendance, timesheets, signals }).includes("SECRET_"));
  assert.deepEqual(buildWfmOpsSignals(null, null), []);
  assert.throws(() => projectAttendanceOps({ summary: { open: 0, overdue: 1, unassigned: 0, resolved: 0 } }));
});

test("existing UI maintains read-gated work lists and no-money manager triage", () => {
  const hr = readFileSync("src/components/hcm-work-queue.tsx", "utf8");
  const first = readFileSync("src/components/workspace/first-payroll-readiness.tsx", "utf8");
  const wfm = readFileSync("src/components/workspace/workforce-operations-inbox.tsx", "utf8");
  assert.ok(hr.includes("isVerifiedHcmWorkQueueResponse(data, Number(organizationId))"));
  assert.ok(hr.includes("summary?.total ?? null"), "unknown counts must remain unknown");
  assert.ok(first.includes("A completed setup checklist does not certify payroll or authorize payment."));
  assert.ok(wfm.includes('const scope = [organizationId, periodStart, periodEnd].join(":")'));
  assert.ok(wfm.includes('snapshot?.scope === scope'));
  assert.ok(wfm.includes("Unavailable does not mean zero open cases or payroll-ready."));
  assert.ok(!wfm.includes('method: "POST"') && !wfm.includes('method: "PATCH"'));
});
