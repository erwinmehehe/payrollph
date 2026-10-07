import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollReleaseHolds, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";

export async function activePayrollReleaseHolds(organizationId: number, payrollRunId: number) {
  return db.select().from(payrollReleaseHolds).where(and(
    eq(payrollReleaseHolds.organizationId, organizationId),
    eq(payrollReleaseHolds.payrollRunId, payrollRunId),
    eq(payrollReleaseHolds.status, "active"),
  ));
}

export async function placePayrollReleaseHold(input: {
  organizationId: number;
  payrollRunId: number;
  sourceType: string;
  sourceKey: string;
  reason: string;
  placedBy: string;
  metadata?: Record<string, unknown>;
}) {
  const [run] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, input.payrollRunId),
    eq(payrollRuns.organizationId, input.organizationId),
  )).limit(1);
  if (!run) throw new Error("Payroll run not found in this organization.");
  if (run.status === "Released") {
    throw new Error("Released payroll cannot receive a release hold.");
  }

  const sourceType = input.sourceType.trim().slice(0, 32) || "automation";
  const sourceKey = input.sourceKey.trim().slice(0, 180);
  const reason = input.reason.trim().slice(0, 500);
  if (!sourceKey || !reason) throw new Error("Payroll release hold source and reason are required.");

  const [existing] = await db.select().from(payrollReleaseHolds).where(and(
    eq(payrollReleaseHolds.payrollRunId, input.payrollRunId),
    eq(payrollReleaseHolds.sourceType, sourceType),
    eq(payrollReleaseHolds.sourceKey, sourceKey),
  )).limit(1);

  if (existing) {
    if (existing.status === "active") return { hold: existing, created: false as const };
    throw new Error("A previously cleared payroll release hold cannot be silently reactivated. Create a new governed source event.");
  }

  const [hold] = await db.insert(payrollReleaseHolds).values({
    organizationId: input.organizationId,
    payrollRunId: input.payrollRunId,
    sourceType,
    sourceKey,
    reason,
    status: "active",
    placedBy: input.placedBy.slice(0, 120),
    metadata: input.metadata ?? {},
    updatedAt: new Date(),
  }).returning();

  await recordAuditEvent({
    organizationId: input.organizationId,
    actor: input.placedBy,
    action: "Payroll release hold placed",
    resource: `Payroll run #${input.payrollRunId}`,
    metadata: {
      holdId: hold.id,
      payrollRunId: input.payrollRunId,
      sourceType,
      sourceKey,
      reason,
      ...(input.metadata ?? {}),
    },
  });

  return { hold, created: true as const };
}

export async function clearPayrollReleaseHold(input: {
  organizationId: number;
  payrollRunId: number;
  holdId: number;
  clearedByUserId: number;
  clearedBy: string;
  clearanceNote: string;
}) {
  const note = input.clearanceNote.trim().slice(0, 500);
  if (!note) throw new Error("A clearance note is required to clear a payroll release hold.");

  const [cleared] = await db.update(payrollReleaseHolds).set({
    status: "cleared",
    clearedByUserId: input.clearedByUserId,
    clearedBy: input.clearedBy.slice(0, 120),
    clearedAt: new Date(),
    clearanceNote: note,
    updatedAt: new Date(),
  }).where(and(
    eq(payrollReleaseHolds.id, input.holdId),
    eq(payrollReleaseHolds.organizationId, input.organizationId),
    eq(payrollReleaseHolds.payrollRunId, input.payrollRunId),
    eq(payrollReleaseHolds.status, "active"),
  )).returning();

  if (!cleared) throw new Error("Payroll release hold is missing or already cleared.");

  await recordAuditEvent({
    organizationId: input.organizationId,
    actor: input.clearedBy,
    action: "Payroll release hold cleared",
    resource: `Payroll run #${input.payrollRunId}`,
    metadata: {
      holdId: cleared.id,
      payrollRunId: input.payrollRunId,
      sourceType: cleared.sourceType,
      sourceKey: cleared.sourceKey,
      clearanceNote: note,
    },
  });

  return cleared;
}
