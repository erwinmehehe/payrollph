import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, hcmDocumentRequirements, hcmEmployeeDocumentCompliance } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { documentObjectIdentityMatches } from "@/lib/employee-document-vault";
import { documentComplianceStatus } from "@/lib/hcm-documents";

export type VaultVerificationDenial = "NOT_FOUND" | "NOT_SUBMITTED" | "NO_EXPIRY" |
  "NOT_SCANNED" | "NO_UPLOADER_EVIDENCE" | "SELF_APPROVAL" | "STORAGE_EVIDENCE_INVALID";

export function vaultIndependentCheckerDecision(input: {
  status: string;
  sourceType: string;
  uploadedByUserId: number | null;
  checkerUserId: number;
  scannedClean: boolean;
  objectStorageKey: string | null;
  organizationId: number;
  employeeId: number;
}): VaultVerificationDenial | null {
  if (input.status !== "submitted") return "NOT_SUBMITTED";
  if (!input.scannedClean) return "NOT_SCANNED";
  if (input.sourceType !== "upload" || !Number.isSafeInteger(input.uploadedByUserId) ||
    !input.uploadedByUserId || input.uploadedByUserId <= 0) return "NO_UPLOADER_EVIDENCE";
  if (input.uploadedByUserId === input.checkerUserId) return "SELF_APPROVAL";
  if (!input.objectStorageKey || !documentObjectIdentityMatches(
    input.objectStorageKey, input.organizationId, input.employeeId,
  )) return "STORAGE_EVIDENCE_INVALID";
  return null;
}

const denialText: Record<VaultVerificationDenial, string> = {
  NOT_FOUND: "This document is not available in this employer's HR vault.",
  NOT_SUBMITTED: "The document has changed or has already been verified or waived.",
  NO_EXPIRY: "This document requires an expiry date before verification.",
  NOT_SCANNED: "A clean malware scan is required before independent verification.",
  NO_UPLOADER_EVIDENCE: "Verified uploader identity is missing; obtain a new governed submission.",
  SELF_APPROVAL: "The uploader cannot approve their own employee document.",
  STORAGE_EVIDENCE_INVALID: "Private document storage evidence is missing or invalid.",
};

function denied(code: VaultVerificationDenial) {
  return { ok: false as const, code, message: denialText[code] };
}

/**
 * Verifies one submitted 201-file in a single DB transaction. The route checks
 * the HR role, active membership, employee/orgUnit scope, CSRF and MFA first;
 * this inner layer rechecks the exact employer/document identity and locks the
 * compliance record so stale and simultaneous decisions fail closed.
 */
export async function verifyEmployeeVaultDocument(input: {
  organizationId: number;
  employeeId: number;
  complianceId: number;
  expectedDocumentId: number;
  checkerUserId: number;
  checkerName: string;
}) {
  if (!criticalReleaseFlagEnabled("employeeDocumentVault")) {
    throw new Error("Independent vault verification is disabled.");
  }
  return db.transaction(async tx => {
    const [fresh] = await tx.select().from(hcmEmployeeDocumentCompliance).where(and(
      eq(hcmEmployeeDocumentCompliance.id, input.complianceId),
      eq(hcmEmployeeDocumentCompliance.organizationId, input.organizationId),
      eq(hcmEmployeeDocumentCompliance.employeeId, input.employeeId),
    )).for("update").limit(1);
    if (!fresh || fresh.documentId !== input.expectedDocumentId) return denied("NOT_FOUND");
    if (fresh.status !== "submitted") return denied("NOT_SUBMITTED");

    const [rule] = await tx.select().from(hcmDocumentRequirements).where(and(
      eq(hcmDocumentRequirements.id, fresh.requirementId),
      eq(hcmDocumentRequirements.organizationId, input.organizationId),
      eq(hcmDocumentRequirements.active, true),
    )).limit(1);
    if (!rule) return denied("NOT_FOUND");
    if (rule.expiryRequired && !fresh.expiresAt) return denied("NO_EXPIRY");

    const [file] = await tx.select().from(documents).where(and(
      eq(documents.id, fresh.documentId),
      eq(documents.organizationId, input.organizationId),
      eq(documents.employeeId, input.employeeId),
    )).limit(1);
    if (!file) return denied("NOT_FOUND");
    const decision = vaultIndependentCheckerDecision({
      status: fresh.status,
      sourceType: file.sourceType,
      uploadedByUserId: file.uploadedByUserId,
      checkerUserId: input.checkerUserId,
      scannedClean: file.scannedClean,
      objectStorageKey: file.objectStorageKey,
      organizationId: input.organizationId,
      employeeId: input.employeeId,
    });
    if (decision) return denied(decision);

    const next = documentComplianceStatus(
      fresh.expiresAt ? String(fresh.expiresAt) : null,
      rule.renewalLeadDays,
    );
    const now = new Date();
    const [row] = await tx.update(hcmEmployeeDocumentCompliance).set({
      status: next.status, verifiedAt: now, verifiedByUserId: input.checkerUserId,
      verifiedByName: input.checkerName, updatedAt: now,
    }).where(and(
      eq(hcmEmployeeDocumentCompliance.id, fresh.id),
      eq(hcmEmployeeDocumentCompliance.organizationId, input.organizationId),
      eq(hcmEmployeeDocumentCompliance.employeeId, input.employeeId),
      eq(hcmEmployeeDocumentCompliance.documentId, fresh.documentId),
      eq(hcmEmployeeDocumentCompliance.status, "submitted"),
    )).returning();
    if (!row) return denied("NOT_SUBMITTED");
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.checkerName,
      action: "Employee document independently verified",
      resource: String(fresh.id),
      metadata: {
        complianceId: fresh.id, employeeId: fresh.employeeId,
        documentId: file.id, docSha256: file.sha256,
        uploaderUserId: file.uploadedByUserId,
        checkerUserId: input.checkerUserId,
        expiresAt: String(fresh.expiresAt ?? ""), status: next.status,
      },
    });
    return { ok: true as const, row };
  });
}
