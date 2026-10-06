import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  employees,
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
  hcmPolicyAssignments,
  hcmPolicyVersions,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function employeeContext() {
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (user.role !== "employee" || !user.employeeId) {
    return { error: Response.json({ error: "Employee self-service account required." }, { status: 403 }) };
  }

  const [employee] = await db.select({
    id: employees.id,
    organizationId: employees.organizationId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
  }).from(employees).where(eq(employees.id, user.employeeId)).limit(1);
  if (!employee) return { error: Response.json({ error: "Employee record not found." }, { status: 404 }) };

  const denied = await assertMembership(user.id, employee.organizationId);
  if (denied) return { error: denied };
  return { user, employee };
}

export async function GET() {
  const context = await employeeContext();
  if ("error" in context) return context.error;
  const { employee } = context;

  const [assignments, compliance] = await Promise.all([
    db.select({
      assignmentId: hcmPolicyAssignments.id,
      status: hcmPolicyAssignments.status,
      assignedAt: hcmPolicyAssignments.assignedAt,
      dueAt: hcmPolicyAssignments.dueAt,
      acknowledgedAt: hcmPolicyAssignments.acknowledgedAt,
      acknowledgementSha256: hcmPolicyAssignments.acknowledgementSha256,
      waivedAt: hcmPolicyAssignments.waivedAt,
      waiverReason: hcmPolicyAssignments.waiverReason,
      policyId: hcmPolicyVersions.id,
      policyCode: hcmPolicyVersions.policyCode,
      title: hcmPolicyVersions.title,
      category: hcmPolicyVersions.category,
      version: hcmPolicyVersions.version,
      policyStatus: hcmPolicyVersions.status,
      effectiveFrom: hcmPolicyVersions.effectiveFrom,
      effectiveUntil: hcmPolicyVersions.effectiveUntil,
      requiresAcknowledgement: hcmPolicyVersions.requiresAcknowledgement,
      content: hcmPolicyVersions.content,
      contentSha256: hcmPolicyVersions.contentSha256,
      approvedByName: hcmPolicyVersions.approvedByName,
      approvedAt: hcmPolicyVersions.approvedAt,
    }).from(hcmPolicyAssignments)
      .innerJoin(hcmPolicyVersions, eq(hcmPolicyAssignments.policyId, hcmPolicyVersions.id))
      .where(and(
        eq(hcmPolicyAssignments.organizationId, employee.organizationId),
        eq(hcmPolicyAssignments.employeeId, employee.id),
        eq(hcmPolicyVersions.status, "published"),
      ))
      .orderBy(desc(hcmPolicyAssignments.id)),
    db.select({
      complianceId: hcmEmployeeDocumentCompliance.id,
      status: hcmEmployeeDocumentCompliance.status,
      dueAt: hcmEmployeeDocumentCompliance.dueAt,
      expiresAt: hcmEmployeeDocumentCompliance.expiresAt,
      verifiedAt: hcmEmployeeDocumentCompliance.verifiedAt,
      waiverReason: hcmEmployeeDocumentCompliance.waiverReason,
      requirementId: hcmDocumentRequirements.id,
      code: hcmDocumentRequirements.code,
      name: hcmDocumentRequirements.name,
      kind: hcmDocumentRequirements.kind,
      mandatory: hcmDocumentRequirements.mandatory,
      expiryRequired: hcmDocumentRequirements.expiryRequired,
      renewalLeadDays: hcmDocumentRequirements.renewalLeadDays,
      documentId: documents.id,
      fileName: documents.fileName,
      scannedClean: documents.scannedClean,
      uploadedAt: documents.createdAt,
    }).from(hcmEmployeeDocumentCompliance)
      .innerJoin(hcmDocumentRequirements, eq(hcmEmployeeDocumentCompliance.requirementId, hcmDocumentRequirements.id))
      .leftJoin(documents, eq(hcmEmployeeDocumentCompliance.documentId, documents.id))
      .where(and(
        eq(hcmEmployeeDocumentCompliance.organizationId, employee.organizationId),
        eq(hcmEmployeeDocumentCompliance.employeeId, employee.id),
        eq(hcmDocumentRequirements.active, true),
      ))
      .orderBy(desc(hcmEmployeeDocumentCompliance.id)),
  ]);

  const now = Date.now();
  return Response.json({
    employee: {
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
    },
    policies: assignments.map((row) => ({
      ...row,
      overdue:
        row.status === "assigned"
        && row.dueAt != null
        && new Date(row.dueAt).getTime() < now,
    })),
    documentRequirements: compliance,
    summary: {
      acknowledgementRequired: assignments.filter((row) => row.status === "assigned").length,
      overdueAcknowledgements: assignments.filter(
        (row) => row.status === "assigned"
          && row.dueAt != null
          && new Date(row.dueAt).getTime() < now,
      ).length,
      missingDocuments: compliance.filter((row) => row.status === "missing").length,
      submittedDocuments: compliance.filter((row) => row.status === "submitted").length,
      expiringDocuments: compliance.filter((row) => row.status === "expiring").length,
      expiredDocuments: compliance.filter((row) => row.status === "expired").length,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await employeeContext();
  if ("error" in context) return context.error;
  const { user, employee } = context;

  const demoDenied = publicDemoMutationDenied(user.email, "Policy acknowledgement");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action !== "acknowledge-policy") {
    return Response.json({ error: "Unsupported employee document-policy action." }, { status: 400 });
  }

  const assignmentId = Number(body.assignmentId);
  if (!Number.isInteger(assignmentId)) {
    return Response.json({ error: "assignmentId is required." }, { status: 400 });
  }

  const [row] = await db.select({
    assignment: hcmPolicyAssignments,
    policy: hcmPolicyVersions,
  }).from(hcmPolicyAssignments)
    .innerJoin(hcmPolicyVersions, eq(hcmPolicyAssignments.policyId, hcmPolicyVersions.id))
    .where(and(
      eq(hcmPolicyAssignments.id, assignmentId),
      eq(hcmPolicyAssignments.organizationId, employee.organizationId),
      eq(hcmPolicyAssignments.employeeId, employee.id),
    )).limit(1);

  if (!row) return Response.json({ error: "Policy assignment not found." }, { status: 404 });
  if (row.policy.status !== "published") {
    return Response.json({ error: "Only published policy versions can be acknowledged." }, { status: 409 });
  }
  if (!row.policy.requiresAcknowledgement || row.assignment.status === "not_required") {
    return Response.json({ error: "This policy version does not require acknowledgement." }, { status: 409 });
  }
  if (row.assignment.status === "acknowledged") {
    return Response.json({
      assignment: row.assignment,
      alreadyAcknowledged: true,
    });
  }
  if (row.assignment.status === "waived") {
    return Response.json({ error: "This acknowledgement requirement was waived by HR and is no longer actionable." }, { status: 409 });
  }
  if (row.assignment.status !== "assigned") {
    return Response.json({ error: "This policy assignment is not open for acknowledgement." }, { status: 409 });
  }

  const acknowledgedAt = new Date();
  const acknowledgementSha256 = createHash("sha256")
    .update([
      "hcm-policy-ack-v1",
      String(row.assignment.id),
      String(row.policy.id),
      row.policy.policyCode,
      row.policy.version,
      row.policy.contentSha256,
      String(employee.id),
      String(user.id),
      acknowledgedAt.toISOString(),
    ].join("|"))
    .digest("hex");

  const evidence = {
    evidenceVersion: "hcm-policy-ack-v1",
    policyId: row.policy.id,
    policyCode: row.policy.policyCode,
    policyVersion: row.policy.version,
    policyContentSha256: row.policy.contentSha256,
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    userId: user.id,
    acknowledgedAt: acknowledgedAt.toISOString(),
    acknowledgementSha256,
    statement: "I acknowledge that I have received and read this exact policy version.",
  };

  const [updated] = await db.update(hcmPolicyAssignments).set({
    status: "acknowledged",
    acknowledgedAt,
    acknowledgedByUserId: user.id,
    acknowledgementSha256,
    acknowledgementEvidence: evidence,
    updatedAt: acknowledgedAt,
  }).where(and(
    eq(hcmPolicyAssignments.id, row.assignment.id),
    eq(hcmPolicyAssignments.status, "assigned"),
  )).returning();

  if (!updated) {
    return Response.json({ error: "Policy acknowledgement state changed. Refresh and retry." }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: user.name,
    action: "Employee policy acknowledged",
    resource: `${row.policy.policyCode} v${row.policy.version}`,
    metadata: evidence,
  });

  return Response.json({
    assignment: updated,
    evidence: {
      policyCode: row.policy.policyCode,
      policyVersion: row.policy.version,
      policyContentSha256: row.policy.contentSha256,
      acknowledgementSha256,
      acknowledgedAt: acknowledgedAt.toISOString(),
    },
  });
}
