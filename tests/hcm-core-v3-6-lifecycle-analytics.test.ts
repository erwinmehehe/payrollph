import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeEmploymentLifecycleGovernance } from "../src/lib/hcm-lifecycle-analytics";

const read = (path: string) => readFileSync(path, "utf8");

function decision(overrides: Record<string, unknown>) {
  return {
    id: 1,
    organizationId: 1,
    employeeId: 10,
    employmentTermId: 20,
    decisionKind: "renew_term",
    effectiveDate: "2026-10-15",
    nextEmploymentType: null,
    nextTermKind: null,
    nextEffectiveUntil: null,
    nextProbationReviewDate: null,
    nextContractEndDate: null,
    nextProjectName: null,
    proposedSeparationLastDay: null,
    separationReason: null,
    status: "pending_approval",
    separationHandoffStatus: "none",
    separationRecordId: null,
    separationHandoffStartedAt: null,
    separationHandoffCompletedAt: null,
    reason: "Review",
    requestedByUserId: 1,
    requestedBy: "Requester",
    approvedByUserId: null,
    approvedBy: null,
    approvedAt: null,
    appliedAt: null,
    successorTermId: null,
    cancelledByUserId: null,
    cancelledBy: null,
    cancelledAt: null,
    failure: null,
    evidenceSnapshotSha256: null,
    evidenceSealedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  } as any;
}

const readiness = {
  today: "2026-10-06",
  summary: {
    total: 12,
    actionRequired: 3,
    upcoming: 2,
    inProgress: 2,
    unconfigured: 1,
    handoffReady: 1,
  },
  rows: [],
} as any;

test("lifecycle governance summary separates current state from event-window activity", () => {
  const windowStart = new Date("2026-07-09T00:00:00Z");
  const decisions = [
    decision({
      id: 1,
      status: "pending_approval",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    }),
    decision({
      id: 2,
      status: "scheduled",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      approvedAt: new Date("2026-09-15T12:00:00Z"),
      evidenceSnapshotSha256: "a".repeat(64),
      evidenceSealedAt: new Date("2026-09-15T12:00:00Z"),
    }),
    decision({
      id: 3,
      status: "applied",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      approvedAt: new Date("2026-09-02T00:00:00Z"),
      appliedAt: new Date("2026-09-03T00:00:00Z"),
      evidenceSnapshotSha256: "b".repeat(64),
      evidenceSealedAt: new Date("2026-09-02T00:00:00Z"),
    }),
    decision({
      id: 4,
      status: "failed",
      createdAt: new Date("2026-09-20T00:00:00Z"),
      failure: "Activation conflict",
    }),
    decision({
      id: 5,
      status: "cancelled",
      createdAt: new Date("2026-06-15T00:00:00Z"),
      cancelledAt: new Date("2026-09-20T00:00:00Z"),
    }),
  ];

  const summary = summarizeEmploymentLifecycleGovernance({
    today: "2026-10-06",
    windowStart,
    decisions,
    noteDecisionIds: new Set([1]),
    attachmentDecisionIds: new Set([1]),
    notificationTasks: [],
    readiness,
  });

  assert.equal(summary.governedWorkers, 11);
  assert.equal(summary.pendingApproval, 1);
  assert.equal(summary.scheduledDecisions, 1);
  assert.equal(summary.failedDecisions, 1);
  assert.equal(summary.windowDecisionCount, 3);
  assert.equal(summary.approvedInWindow, 2);
  assert.equal(summary.appliedInWindow, 1);
  assert.equal(summary.cancelledInWindow, 1);
  assert.equal(summary.sealedInWindow, 2);
  assert.equal(summary.pendingWithNotes, 1);
  assert.equal(summary.pendingWithAttachments, 1);
});

test("approval timing uses approval events in the reporting window even when the request predates it", () => {
  const summary = summarizeEmploymentLifecycleGovernance({
    today: "2026-10-06",
    windowStart: new Date("2026-09-01T00:00:00Z"),
    decisions: [
      decision({
        id: 10,
        createdAt: new Date("2026-08-31T12:00:00Z"),
        status: "scheduled",
        approvedAt: new Date("2026-09-01T12:00:00Z"),
        evidenceSnapshotSha256: "c".repeat(64),
        evidenceSealedAt: new Date("2026-09-01T12:00:00Z"),
      }),
    ],
    noteDecisionIds: new Set(),
    attachmentDecisionIds: new Set(),
    notificationTasks: [],
    readiness,
  });

  assert.equal(summary.windowDecisionCount, 0);
  assert.equal(summary.approvedInWindow, 1);
  assert.equal(summary.approvalHours, 24);
});

test("non-renewal handoff analytics use authoritative Core 3.2 timestamps", () => {
  const summary = summarizeEmploymentLifecycleGovernance({
    today: "2026-10-06",
    windowStart: new Date("2026-09-01T00:00:00Z"),
    decisions: [
      decision({
        id: 20,
        decisionKind: "non_renew",
        status: "applied",
        separationHandoffStatus: "ready",
        approvedAt: new Date("2026-10-01T00:00:00Z"),
      }),
      decision({
        id: 21,
        decisionKind: "non_renew",
        status: "applied",
        separationHandoffStatus: "started",
        approvedAt: new Date("2026-10-01T00:00:00Z"),
        separationHandoffStartedAt: new Date("2026-10-02T00:00:00Z"),
      }),
      decision({
        id: 22,
        decisionKind: "non_renew",
        status: "applied",
        separationHandoffStatus: "completed",
        approvedAt: new Date("2026-09-20T00:00:00Z"),
        separationHandoffStartedAt: new Date("2026-09-21T00:00:00Z"),
        separationHandoffCompletedAt: new Date("2026-09-22T12:00:00Z"),
      }),
    ],
    noteDecisionIds: new Set(),
    attachmentDecisionIds: new Set(),
    notificationTasks: [],
    readiness,
  });

  assert.equal(summary.handoffReady, 1);
  assert.equal(summary.handoffStarted, 1);
  assert.equal(summary.handoffCompletedInWindow, 1);
  assert.equal(summary.handoffStartHours, 24);
  assert.equal(summary.handoffCompletionHours, 36);
});

test("notification analytics report current ownership and escalation exposure", () => {
  const task = (overrides: Record<string, unknown>) => ({
    id: 1,
    organizationId: 1,
    employeeId: 10,
    sourceType: "employment_terms",
    sourceId: 1,
    sourceKey: "term:1:decision-required",
    action: "record_decision",
    stage: "due",
    escalationStage: 1,
    severity: "warning",
    title: "Review due",
    detail: "Review",
    dueDate: "2026-10-06",
    status: "open",
    ownerUserId: 99,
    ownerName: "HR Owner",
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    acknowledgedByName: null,
    snoozeUntil: null,
    notificationEpisode: 1,
    lastNotifiedAt: null,
    firstDetectedAt: new Date(),
    lastDetectedAt: new Date(),
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any);

  const summary = summarizeEmploymentLifecycleGovernance({
    today: "2026-10-06",
    windowStart: new Date("2026-09-01T00:00:00Z"),
    decisions: [],
    noteDecisionIds: new Set(),
    attachmentDecisionIds: new Set(),
    notificationTasks: [
      task({ id: 1 }),
      task({ id: 2, escalationStage: 2, ownerUserId: null, ownerName: null }),
      task({ id: 3, status: "snoozed", snoozeUntil: new Date("2026-10-08T00:00:00Z") }),
      task({ id: 4, status: "resolved", resolvedAt: new Date() }),
    ],
    readiness,
  });

  assert.equal(summary.activeNotifications, 3);
  assert.equal(summary.escalatedNotifications, 1);
  assert.equal(summary.unassignedNotifications, 1);
  assert.equal(summary.snoozedNotifications, 1);
});

test("Core 3.6 lifecycle report is grounded in Core 3.0 through 3.5 source records", () => {
  const source = read("src/lib/hcm-lifecycle-analytics.ts");
  assert.ok(source.includes("loadEmploymentLifecycleReadiness"));
  assert.ok(source.includes("hcmEmploymentTermDecisions"));
  assert.ok(source.includes("hcmEmploymentDecisionNotes"));
  assert.ok(source.includes("hcmEmploymentDecisionDocuments"));
  assert.ok(source.includes("hcmLifecycleNotificationTasks"));
  assert.ok(source.includes("separationHandoffStartedAt"));
  assert.ok(source.includes("separationHandoffCompletedAt"));
  assert.ok(source.includes("evidenceSnapshotSha256"));
});

test("Core 3.6 labels evidence coverage descriptively rather than claiming sufficiency", () => {
  const source = read("src/lib/hcm-lifecycle-analytics.ts");
  assert.ok(source.includes("Descriptive evidence coverage only"));
  assert.ok(source.includes("does not determine legal or policy sufficiency"));
  assert.ok(source.includes("sealed Core 3.5 evidence snapshot"));
});

test("Analytics workspace and audited report route expose Lifecycle governance", () => {
  const reports = read("src/lib/reports.ts");
  const route = read("src/app/api/reports/route.ts");
  const analytics = read("src/components/workspace/analytics.tsx");

  assert.ok(reports.includes('"lifecycle"'));
  assert.ok(reports.includes("buildEmploymentLifecycleGovernanceReport"));
  assert.ok(reports.includes('name: "Lifecycle governance"'));
  assert.ok(route.includes('"lifecycle"'));
  assert.ok(route.includes('action: "Report exported"'));
  assert.ok(analytics.includes('key: "lifecycle"'));
  assert.ok(analytics.includes('name: "Lifecycle governance"'));
  assert.ok(analytics.includes("Employment terms, decision timing, evidence coverage, handoffs and escalations"));
});

test("Lifecycle governance report remains company-wide People/payroll only", () => {
  const route = read("src/app/api/reports/route.ts");
  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("access?.companyWide"));
  assert.ok(route.includes("Company-wide analytics are not available to unit-scoped roles."));
});

test("Core 3.6 analytics has no authority to mutate employment lifecycle state", () => {
  const source = read("src/lib/hcm-lifecycle-analytics.ts");
  assert.equal(source.includes("db.update("), false);
  assert.equal(source.includes("db.insert("), false);
  assert.equal(source.includes('status: "Separated"'), false);
  assert.equal(source.includes("activateEmploymentTerm"), false);
  assert.equal(source.includes("applyEmploymentTermDecision"), false);
});
