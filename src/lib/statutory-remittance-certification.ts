import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { statutoryRemittanceMonthClosures } from "@/db/schema";

export async function invalidateStatutoryRemittanceMonthCertification(input: {
  organizationId: number;
  legalEntityId: number;
  applicableMonth: string;
  reason: string;
}) {
  const reason = input.reason.trim().replace(/\s+/g, " ").slice(0, 280);
  if (!/^\d{4}-\d{2}$/.test(input.applicableMonth)) {
    throw new Error("applicableMonth must use YYYY-MM.");
  }
  if (!reason) {
    throw new Error("Certification invalidation reason is required.");
  }

  const now = new Date();
  const invalidated = await db.update(statutoryRemittanceMonthClosures).set({
    status: "invalidated",
    invalidatedAt: now,
    invalidationReason: reason,
    updatedAt: now,
  }).where(and(
    eq(statutoryRemittanceMonthClosures.organizationId, input.organizationId),
    eq(statutoryRemittanceMonthClosures.legalEntityId, input.legalEntityId),
    eq(statutoryRemittanceMonthClosures.applicableMonth, input.applicableMonth),
    eq(statutoryRemittanceMonthClosures.status, "certified"),
  )).returning({
    id: statutoryRemittanceMonthClosures.id,
    snapshotHash: statutoryRemittanceMonthClosures.snapshotHash,
  });

  return invalidated;
}
