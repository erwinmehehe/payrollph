import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, hcmEmploymentDecisionEvents,
  hcmEmploymentTermDecisions, hcmEmploymentTerms, organizations, users,
} from "../src/db/schema";
import {
  cancellationBlocker,
  retryBlocker,
  validHcmCalendarDate,
} from "../src/lib/hcm-employment-decision-integrity";

const pending = {
  status: "pending_approval",
  separationHandoffStatus: "none",
  separationRecordId: null,
  successorTermId: null,
};

test("employment decision Gregorian dates reject impossible dates and formats", () => {
  assert.equal(validHcmCalendarDate("2024-02-29"), true);
  for (const input of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-12", "10/09/2026", "2026-2-1", ""]) {
    assert.equal(validHcmCalendarDate(input), false, input);
  }
});

test("cancel never erases a started Separation handoff or prepared successor", () => {
  assert.equal(cancellationBlocker(pending), null);
  assert.equal(cancellationBlocker({ ...pending, status: "scheduled" }), null);
  assert.equal(cancellationBlocker({ ...pending, status: "failed" }), null);
  assert.equal(cancellationBlocker({ ...pending, status: "applied" }), "TERM_DECISION_NOT_CANCELLABLE");
  assert.equal(cancellationBlocker({ ...pending, separationHandoffStatus: "ready" }), "TERM_DECISION_SEPARATION_HANDOFF_STARTED");
  assert.equal(cancellationBlocker({ ...pending, separationHandoffStatus: "started" }), "TERM_DECISION_SEPARATION_HANDOFF_STARTED");
  assert.equal(cancellationBlocker({ ...pending, separationRecordId: 100 }), "TERM_DECISION_SEPARATION_HANDOFF_STARTED");
  assert.equal(cancellationBlocker({ ...pending, status: "scheduled", successorTermId: 200 }), "TERM_DECISION_SUCCESSOR_ALREADY_PREPARED");
});

test("failed-decision retry requires the original sealed approval and no successor", () => {
  const failed = {
    ...pending, status: "failed",
    approvedByUserId: 12, evidenceSnapshotSha256: "a".repeat(64),
    evidenceSealedAt: new Date("2026-10-01T00:00:00Z"),
  };
  assert.equal(retryBlocker(failed), null);
  assert.equal(retryBlocker({ ...failed, status: "cancelled" }), "TERM_DECISION_RETRY_REQUIRES_APPROVAL");
  assert.equal(retryBlocker({ ...failed, approvedByUserId: null }), "TERM_DECISION_RETRY_REQUIRES_APPROVAL");
  assert.equal(retryBlocker({ ...failed, evidenceSnapshotSha256: null }), "TERM_DECISION_RETRY_UNSEALED");
  assert.equal(retryBlocker({ ...failed, evidenceSealedAt: null }), "TERM_DECISION_RETRY_UNSEALED");
  assert.equal(retryBlocker({ ...failed, successorTermId: 7 }), "TERM_DECISION_SUCCESSOR_ALREADY_PREPARED");
  assert.equal(retryBlocker({ ...failed, separationHandoffStatus: "started" }), "TERM_DECISION_SEPARATION_HANDOFF_STARTED");
});

test("request, cancellation and retry use tenant-locked transactions with atomic event and actor audit", () => {
  const route = readFileSync("src/app/api/hcm/employment-term-decisions/route.ts", "utf8");
  const requestStart = route.indexOf("const created = await db.transaction(async (tx)");
  const cancelStart = route.indexOf("const cancelled = await db.transaction(async (tx)");
  const retryStart = route.indexOf("const scheduled = await db.transaction(async (tx)");
  assert.ok(requestStart >= 0 && cancelStart > requestStart && retryStart > cancelStart);

  const requestPart = route.slice(requestStart, cancelStart);
  const cancelPart = route.slice(cancelStart, retryStart);
  const retryPart = route.slice(retryStart);
  for (const portion of [requestPart, cancelPart, retryPart]) {
    assert.ok(portion.includes("tx.insert(hcmEmploymentDecisionEvents)"), "evidence event must be transactional");
    assert.ok(portion.includes("tx.insert(auditEvents)"), "audit must be transactional");
    assert.ok(!portion.includes("recordAuditEvent("), "do not log after the decision commits");
    assert.ok(!portion.includes("recordEmploymentDecisionEvidenceEvent("), "do not log outside the decision transaction");
  }
  assert.ok(requestPart.includes("for update"));
  assert.ok(requestPart.includes('throw new Error("TERM_DECISION_SOURCE_STALE")'));
  assert.ok(cancelPart.includes("cancellationBlocker(fresh)"));
  assert.ok(cancelPart.includes("isNull(hcmEmploymentTermDecisions.successorTermId)"));
  assert.ok(retryPart.includes("retryBlocker(fresh)"));
  assert.ok(retryPart.includes('eq(hcmEmploymentTermDecisions.status, "failed")'));
});

test("approval seals evidence and actor audit in one transaction and application fences cancellation", () => {
  const evidence = readFileSync("src/lib/hcm-employment-decision-evidence.ts", "utf8");
  const apply = readFileSync("src/lib/hcm-employment-term-decisions.ts", "utf8");
  assert.ok(evidence.includes("return db.transaction(async (tx)"));
  assert.ok(evidence.includes('eventType: "approved"'));
  assert.ok(evidence.includes('action: "HCM employment-term decision approved"'));
  assert.ok(evidence.includes("tx.insert(auditEvents)"));
  assert.ok(evidence.includes("decision.requestedByUserId == null"));
  assert.ok(evidence.includes('term.status !== "active"'));
  assert.ok(apply.includes("where id = ${input.decisionId} for update"));
  assert.ok(apply.includes("successorTermId: successor.id"));
  assert.ok(apply.includes("isNull(hcmEmploymentTermDecisions.successorTermId)"));
});

test("PostgreSQL prevents double-open term decisions, and transaction failure rolls back both decision and audit", async () => {
  const [organization] = await db.insert(organizations).values({
    name: "HCM term decision transaction QA", legalName: "HCM term decision transaction QA", plan: "Core",
  }).returning();
  const [user] = await db.insert(users).values({
    name: "Decision audit test", email: `term-qa-${randomUUID()}@example.invalid`, passwordHash: "test-only",
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: organization.id, employeeNo: "TERM-DECISION-QA-01",
      firstName: "Liza", lastName: "Cruz", title: "Associate",
      avatarInitials: "LC", basicRate: "24000.00", startDate: "2025-01-01",
    }).returning();
    const [term] = await db.insert(hcmEmploymentTerms).values({
      organizationId: organization.id, employeeId: worker.id,
      termKind: "fixed_term", employmentType: "Fixed-term", effectiveFrom: "2025-01-01",
      contractEndDate: "2026-12-01", effectiveUntil: "2026-12-01",
      status: "active", reason: "Prior approved employment terms",
      requestedByUserId: user.id, requestedBy: user.name,
    }).returning();
    const [created] = await db.insert(hcmEmploymentTermDecisions).values({
      organizationId: organization.id, employeeId: worker.id, employmentTermId: term.id,
      decisionKind: "continue_current", effectiveDate: "2026-11-01",
      status: "pending_approval", separationHandoffStatus: "none",
      reason: "Documented decision pending checker review",
      requestedByUserId: user.id, requestedBy: user.name,
    }).returning();
    await assert.rejects(() => db.insert(hcmEmploymentTermDecisions).values({
      organizationId: organization.id, employeeId: worker.id, employmentTermId: term.id,
      decisionKind: "continue_current", effectiveDate: "2026-11-15",
      reason: "Conflicting request", requestedByUserId: user.id, requestedBy: user.name,
    }), /Failed query|duplicate|unique/i);
    await assert.rejects(() => db.transaction(async tx => {
      await tx.update(hcmEmploymentTermDecisions).set({ status: "cancelled" })
        .where(eq(hcmEmploymentTermDecisions.id, created.id));
      await tx.insert(hcmEmploymentDecisionEvents).values({
        organizationId: organization.id, decisionId: created.id,
        employeeId: worker.id, eventType: "cancelled",
        actorUserId: user.id, actorName: user.name,
      });
      await tx.insert(auditEvents).values({
        organizationId: organization.id, actor: user.name,
        action: "HCM employment-term decision cancelled",
        resource: `Employee #${worker.id}`,
      });
      throw new Error("intentional rollback of decision/evidence/audit");
    }), /intentional rollback/);
    const [unchanged] = await db.select().from(hcmEmploymentTermDecisions)
      .where(eq(hcmEmploymentTermDecisions.id, created.id));
    assert.equal(unchanged.status, "pending_approval");
    const eventRows = await db.select().from(hcmEmploymentDecisionEvents)
      .where(eq(hcmEmploymentDecisionEvents.decisionId, created.id));
    assert.equal(eventRows.length, 0);
    const auditRows = await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, organization.id));
    assert.equal(auditRows.length, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});
