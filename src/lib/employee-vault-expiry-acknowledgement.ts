import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, documents, employees, hcmDocumentExpiryNotices,
  hcmEmployeeDocumentCompliance,
} from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export type ExpiryAcknowledgementState =
  "acknowledged" | "not_found" | "stale" | "already_acknowledged";

/**
 * A reminder is only actionable while its exact employee, reviewed document,
 * expiry and status remain current. A separate pre-transaction HTTP lookup
 * cannot protect against a simultaneous HR waiver, replacement or reschedule.
 *
 * Lock compliance before the notice (the same ordering as the scheduler),
 * check tenant + unit scope against the live employee, then update and audit
 * in one transaction. Never accept an unverified or unscanned replacement.
 */
export async function acknowledgeEmployeeVaultExpiryNotice(input: {
  organizationId: number;
  noticeId: number;
  actorUserId: number;
  actorName: string;
  canAccessOrgUnit: (orgUnitId: number | null) => boolean;
}): Promise<ExpiryAcknowledgementState> {
  if (!criticalReleaseFlagEnabled("employeeDocumentVault")) {
    throw new Error("Private HR expiry acknowledgement is disabled.");
  }
  if (![input.organizationId, input.noticeId, input.actorUserId].every(
    value => Number.isSafeInteger(value) && value > 0,
  )) return "not_found";

  return db.transaction(async tx => {
    // First fetch immutable identifiers without locking the notice; the
    // compliance row must be locked first to avoid reversing scheduler order.
    const [initial] = await tx.select({
      complianceId: hcmDocumentExpiryNotices.complianceId,
      employeeId: hcmDocumentExpiryNotices.employeeId,
    }).from(hcmDocumentExpiryNotices).where(and(
      eq(hcmDocumentExpiryNotices.id, input.noticeId),
      eq(hcmDocumentExpiryNotices.organizationId, input.organizationId),
    )).limit(1);
    if (!initial) return "not_found";

    const [compliance] = await tx.select({
      employeeId: hcmEmployeeDocumentCompliance.employeeId,
      documentId: hcmEmployeeDocumentCompliance.documentId,
      expiresAt: hcmEmployeeDocumentCompliance.expiresAt,
      verifiedAt: hcmEmployeeDocumentCompliance.verifiedAt,
      status: hcmEmployeeDocumentCompliance.status,
    }).from(hcmEmployeeDocumentCompliance).where(and(
      eq(hcmEmployeeDocumentCompliance.id, initial.complianceId),
      eq(hcmEmployeeDocumentCompliance.organizationId, input.organizationId),
      eq(hcmEmployeeDocumentCompliance.employeeId, initial.employeeId),
    )).for("update").limit(1);

    const [notice] = await tx.select().from(hcmDocumentExpiryNotices).where(and(
      eq(hcmDocumentExpiryNotices.id, input.noticeId),
      eq(hcmDocumentExpiryNotices.organizationId, input.organizationId),
    )).for("update").limit(1);
    if (!notice || notice.complianceId !== initial.complianceId ||
        notice.employeeId !== initial.employeeId) return "not_found";

    const [employee] = await tx.select({ orgUnitId: employees.orgUnitId })
      .from(employees).where(and(
        eq(employees.id, notice.employeeId),
        eq(employees.organizationId, input.organizationId),
      )).limit(1);
    if (!employee || !input.canAccessOrgUnit(employee.orgUnitId)) return "not_found";
    if (notice.acknowledgedAt) return "already_acknowledged";

    if (!compliance || !compliance.verifiedAt ||
        compliance.employeeId !== notice.employeeId ||
        compliance.documentId !== notice.documentId ||
        String(compliance.expiresAt) !== String(notice.expiresOn) ||
        !["current", "expiring", "expired"].includes(compliance.status)) {
      return "stale";
    }

    const [file] = await tx.select({ scannedClean: documents.scannedClean })
      .from(documents).where(and(
        eq(documents.id, notice.documentId),
        eq(documents.organizationId, input.organizationId),
        eq(documents.employeeId, notice.employeeId),
      )).limit(1);
    if (!file?.scannedClean) return "stale";

    const [updated] = await tx.update(hcmDocumentExpiryNotices).set({
      acknowledgedAt: new Date(),
      acknowledgedByUserId: input.actorUserId,
    }).where(and(
      eq(hcmDocumentExpiryNotices.id, input.noticeId),
      eq(hcmDocumentExpiryNotices.organizationId, input.organizationId),
      isNull(hcmDocumentExpiryNotices.acknowledgedAt),
    )).returning({ id: hcmDocumentExpiryNotices.id });
    if (!updated) return "already_acknowledged";

    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.actorName,
      action: "HR document expiry notice acknowledged",
      resource: String(notice.id),
      metadata: {
        employeeId: notice.employeeId,
        complianceId: notice.complianceId,
        documentId: notice.documentId,
        milestoneDays: notice.milestoneDays,
        expiryDate: String(notice.expiresOn),
        actorUserId: input.actorUserId,
      },
    });
    return "acknowledged";
  });
}
