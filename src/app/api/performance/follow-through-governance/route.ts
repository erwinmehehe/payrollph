import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  performanceActionItemReminderTasks,
  performanceActionReminderPolicies,
  performanceActionReminderPolicyEvents,
  performanceCycleEvidenceAmendments,
  performanceCycleEvidenceSeals,
  performanceCycles,
  performanceEvidencePolicies,
  performanceEvidencePolicyEvents,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  DEFAULT_PERFORMANCE_ACTION_REMINDER_POLICY,
  loadPerformanceActionReminderPolicy,
} from "@/lib/hcm-performance-action-reminders";
import {
  amendPerformanceCycleSeal,
  DEFAULT_PERFORMANCE_EVIDENCE_POLICY,
  loadPerformanceEvidencePolicy,
  performanceEvidencePolicySnapshot,
  sealPerformanceCycle,
  setPerformanceCycleLegalHold,
  verifyPerformanceCycleSeal,
} from "@/lib/hcm-performance-evidence-sealing";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function adminGate(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage performance follow-through governance.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({
      error: "Performance follow-through governance requires company-wide People access.",
    }, { status: 403 }) };
  }
  return { access };
}

function reminderSnapshot(row: typeof performanceActionReminderPolicies.$inferSelect | null) {
  if (!row) return DEFAULT_PERFORMANCE_ACTION_REMINDER_POLICY;
  return {
    version: row.version,
    enabled: row.enabled,
    reminderDaysBefore: row.reminderDaysBefore,
    escalationDaysOverdue: row.escalationDaysOverdue,
    notifyManagerOnEmployeeItem: row.notifyManagerOnEmployeeItem,
    notifyPeopleAdminOnEscalation: row.notifyPeopleAdminOnEscalation,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const gate = await adminGate(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const [reminderState, evidenceState, cycles, seals, amendments, reminderTasks] = await Promise.all([
    loadPerformanceActionReminderPolicy(organizationId),
    loadPerformanceEvidencePolicy(organizationId),
    db.select().from(performanceCycles)
      .where(eq(performanceCycles.organizationId, organizationId))
      .orderBy(desc(performanceCycles.endDate)),
    db.select().from(performanceCycleEvidenceSeals)
      .where(eq(performanceCycleEvidenceSeals.organizationId, organizationId))
      .orderBy(desc(performanceCycleEvidenceSeals.sealedAt)),
    db.select().from(performanceCycleEvidenceAmendments)
      .where(eq(performanceCycleEvidenceAmendments.organizationId, organizationId))
      .orderBy(desc(performanceCycleEvidenceAmendments.createdAt)),
    db.select().from(performanceActionItemReminderTasks)
      .where(eq(performanceActionItemReminderTasks.organizationId, organizationId))
      .orderBy(desc(performanceActionItemReminderTasks.updatedAt)),
  ]);

  return Response.json({
    reminderPolicy: reminderState.snapshot,
    evidencePolicy: evidenceState.snapshot,
    cycles,
    seals: seals.map((seal) => ({
      ...seal,
      amendments: amendments.filter((item) => item.sealId === seal.id),
    })),
    reminderSummary: {
      open: reminderTasks.filter((task) => task.status === "open").length,
      overdue: reminderTasks.filter((task) => task.status === "open" && task.stage === "overdue").length,
      escalated: reminderTasks.filter((task) => task.status === "open" && task.stage === "overdue_escalated").length,
      resolved: reminderTasks.filter((task) => task.status === "resolved").length,
    },
  });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await adminGate(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-follow-through-" + action,
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "action_reminder_policy") {
    const currentState = await loadPerformanceActionReminderPolicy(organizationId);
    const currentVersion = currentState.row?.version ?? 0;
    const expectedVersion = body.expectedVersion == null ? currentVersion : Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== currentVersion) {
      return Response.json({
        error: "Reminder policy changed since it was loaded. Refresh before saving.",
        currentVersion,
      }, { status: 409 });
    }

    const reminderDaysBefore = Number(body.reminderDaysBefore);
    const escalationDaysOverdue = Number(body.escalationDaysOverdue);
    if (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 30
        || !Number.isInteger(escalationDaysOverdue) || escalationDaysOverdue < 1 || escalationDaysOverdue > 90) {
      return Response.json({
        error: "Reminder days must be 0–30 and escalation overdue days must be 1–90.",
      }, { status: 400 });
    }

    const values = {
      enabled: body.enabled !== false,
      reminderDaysBefore,
      escalationDaysOverdue,
      notifyManagerOnEmployeeItem: body.notifyManagerOnEmployeeItem !== false,
      notifyPeopleAdminOnEscalation: body.notifyPeopleAdminOnEscalation !== false,
      updatedByUserId: user.id,
      updatedByName: user.name,
      updatedAt: new Date(),
    };
    const [row] = currentState.row
      ? await db.update(performanceActionReminderPolicies).set({
          ...values,
          version: currentState.row.version + 1,
        }).where(eq(performanceActionReminderPolicies.id, currentState.row.id)).returning()
      : await db.insert(performanceActionReminderPolicies).values({
          organizationId,
          ...values,
          version: 1,
        }).returning();

    const after = reminderSnapshot(row);
    await db.insert(performanceActionReminderPolicyEvents).values({
      organizationId,
      policyId: row.id,
      fromVersion: currentState.row?.version ?? null,
      toVersion: row.version,
      beforeSnapshot: currentState.row ? reminderSnapshot(currentState.row) : null,
      afterSnapshot: after,
      actorUserId: user.id,
      actorName: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance action reminder policy updated",
      resource: "Performance follow-through",
      metadata: { fromVersion: currentState.row?.version ?? null, toVersion: row.version, after },
    });
    return Response.json({ reminderPolicy: after });
  }

  if (action === "evidence_policy") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const currentState = await loadPerformanceEvidencePolicy(organizationId);
    const currentVersion = currentState.row?.version ?? 0;
    const expectedVersion = body.expectedVersion == null ? currentVersion : Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== currentVersion) {
      return Response.json({
        error: "Evidence policy changed since it was loaded. Refresh before saving.",
        currentVersion,
      }, { status: 409 });
    }

    const retentionYears = Number(body.retentionYears);
    if (!Number.isInteger(retentionYears) || retentionYears < 1 || retentionYears > 20) {
      return Response.json({ error: "retentionYears must be an integer from 1 to 20." }, { status: 400 });
    }

    const values = {
      retentionYears,
      autoSealCompletedCycles: body.autoSealCompletedCycles !== false,
      allowPostSealAmendments: body.allowPostSealAmendments !== false,
      updatedByUserId: user.id,
      updatedByName: user.name,
      updatedAt: new Date(),
    };
    const [row] = currentState.row
      ? await db.update(performanceEvidencePolicies).set({
          ...values,
          version: currentState.row.version + 1,
        }).where(eq(performanceEvidencePolicies.id, currentState.row.id)).returning()
      : await db.insert(performanceEvidencePolicies).values({
          organizationId,
          ...values,
          version: 1,
        }).returning();

    const after = performanceEvidencePolicySnapshot(row);
    await db.insert(performanceEvidencePolicyEvents).values({
      organizationId,
      policyId: row.id,
      fromVersion: currentState.row?.version ?? null,
      toVersion: row.version,
      beforeSnapshot: currentState.row ? performanceEvidencePolicySnapshot(currentState.row) : null,
      afterSnapshot: after,
      actorUserId: user.id,
      actorName: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance evidence retention policy updated",
      resource: "Performance evidence",
      metadata: { fromVersion: currentState.row?.version ?? null, toVersion: row.version, after },
    });
    return Response.json({ evidencePolicy: after });
  }

  const sensitiveMfaDenied = requireSensitiveActionMfa(user);
  if (sensitiveMfaDenied) return sensitiveMfaDenied;

  const cycleId = Number(body.cycleId);
  if (!Number.isInteger(cycleId)) {
    return Response.json({ error: "cycleId is required for this evidence action." }, { status: 400 });
  }
  const [cycle] = await db.select().from(performanceCycles).where(and(
    eq(performanceCycles.id, cycleId),
    eq(performanceCycles.organizationId, organizationId),
  )).limit(1);
  if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });

  if (action === "seal_cycle") {
    if (cycle.status !== "completed") {
      return Response.json({ error: "Only completed performance cycles can be sealed." }, { status: 409 });
    }
    const result = await sealPerformanceCycle({
      organizationId,
      cycleId,
      actorUserId: user.id,
      actorName: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: result.created ? "Performance cycle evidence sealed" : "Performance cycle evidence seal inspected",
      resource: cycle.name,
      metadata: {
        cycleId,
        sealId: result.seal.id,
        manifestHash: result.seal.manifestHash,
        created: result.created,
      },
    });
    return Response.json(result);
  }

  if (action === "verify_cycle") {
    const result = await verifyPerformanceCycleSeal({
      organizationId,
      cycleId,
      actorName: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance cycle evidence seal verified",
      resource: cycle.name,
      metadata: {
        cycleId,
        sealId: result.seal.id,
        status: result.status,
        sealedHash: result.sealedHash,
        currentHash: result.currentHash,
      },
    });
    return Response.json(result);
  }

  if (action === "legal_hold") {
    const legalHold = body.legalHold === true;
    const reason = String(body.reason ?? "").trim().slice(0, 8000);
    if (reason.length < 10) {
      return Response.json({ error: "A legal-hold reason of at least 10 characters is required." }, { status: 400 });
    }
    const row = await setPerformanceCycleLegalHold({
      organizationId,
      cycleId,
      legalHold,
      reason,
      actorUserId: user.id,
      actorName: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: legalHold ? "Performance evidence legal hold applied" : "Performance evidence legal hold released",
      resource: cycle.name,
      metadata: { cycleId, sealId: row.id, reason },
    });
    return Response.json(row);
  }

  if (action === "amend_seal") {
    const reason = String(body.reason ?? "").trim().slice(0, 500);
    const detail = String(body.detail ?? "").trim().slice(0, 12000);
    const employeeId = body.employeeId ? Number(body.employeeId) : null;
    if (reason.length < 10 || detail.length < 20 || (employeeId != null && !Number.isInteger(employeeId))) {
      return Response.json({
        error: "Amendment reason (10+ chars), detail (20+ chars), and an optional valid employeeId are required.",
      }, { status: 400 });
    }
    const row = await amendPerformanceCycleSeal({
      organizationId,
      cycleId,
      employeeId,
      reason,
      detail,
      actorUserId: user.id,
      actorName: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance evidence amendment appended",
      resource: cycle.name,
      metadata: {
        cycleId,
        sealId: row.sealId,
        amendmentId: row.id,
        amendmentNumber: row.amendmentNumber,
        chainHash: row.chainHash,
        employeeId,
      },
    });
    return Response.json(row);
  }

  return Response.json({
    error: "action must be action_reminder_policy, evidence_policy, seal_cycle, verify_cycle, legal_hold, or amend_seal.",
  }, { status: 400 });
}
