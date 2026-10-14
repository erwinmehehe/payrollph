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
  jobProfiles,
  orgUnits,
} from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  documentComplianceStatus,
  materializeDocumentRequirement,
  materializePolicyAssignments,
  validHcmTargetConditions,
} from "@/lib/hcm-documents";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function policyCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function validDate(value: unknown) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view HCM document controls.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access required." }, { status: 403 });

  const [policies, assignments, requirements, compliance, staff, units, profiles, documentRows] = await Promise.all([
    db.select().from(hcmPolicyVersions)
      .where(eq(hcmPolicyVersions.organizationId, organizationId))
      .orderBy(desc(hcmPolicyVersions.id)),
    db.select().from(hcmPolicyAssignments)
      .where(eq(hcmPolicyAssignments.organizationId, organizationId))
      .orderBy(desc(hcmPolicyAssignments.id)),
    db.select().from(hcmDocumentRequirements)
      .where(eq(hcmDocumentRequirements.organizationId, organizationId))
      .orderBy(desc(hcmDocumentRequirements.id)),
    db.select().from(hcmEmployeeDocumentCompliance)
      .where(eq(hcmEmployeeDocumentCompliance.organizationId, organizationId))
      .orderBy(desc(hcmEmployeeDocumentCompliance.id)),
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      orgUnitId: employees.orgUnitId,
      employmentType: employees.employmentType,
      region: employees.region,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      id: orgUnits.id,
      name: orgUnits.name,
      code: orgUnits.code,
    }).from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
    db.select({
      id: jobProfiles.id,
      title: jobProfiles.title,
      family: jobProfiles.family,
      level: jobProfiles.level,
      grade: jobProfiles.grade,
    }).from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId)),
    db.select({
      id: documents.id,
      employeeId: documents.employeeId,
      kind: documents.kind,
      fileName: documents.fileName,
      sha256: documents.sha256,
      scannedClean: documents.scannedClean,
      createdAt: documents.createdAt,
    }).from(documents).where(eq(documents.organizationId, organizationId)),
  ]);

  const visibleStaff = access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleStaff.map((employee) => employee.id));
  const visibleAssignments = assignments.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const visibleCompliance = compliance.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const visibleDocuments = documentRows.filter((row) => row.employeeId != null && visibleEmployeeIds.has(row.employeeId));

  const employeeById = new Map(staff.map((employee) => [
    employee.id,
    {
      ...employee,
      name: `${employee.firstName} ${employee.lastName}`,
    },
  ]));
  const policyById = new Map(policies.map((row) => [row.id, row]));
  const requirementById = new Map(requirements.map((row) => [row.id, row]));
  const documentById = new Map(documentRows.map((row) => [row.id, row]));

  const now = Date.now();
  const acknowledgementRows = visibleAssignments.map((row) => ({
    ...row,
    employee: employeeById.get(row.employeeId) ?? null,
    policy: policyById.get(row.policyId) ?? null,
    overdue:
      row.status === "assigned"
      && row.dueAt != null
      && new Date(row.dueAt).getTime() < now,
  }));

  const complianceRows = visibleCompliance.map((row) => ({
    ...row,
    employee: employeeById.get(row.employeeId) ?? null,
    requirement: requirementById.get(row.requirementId) ?? null,
    document: row.documentId ? documentById.get(row.documentId) ?? null : null,
  }));

  return Response.json({
    policies,
    assignments: acknowledgementRows,
    requirements,
    compliance: complianceRows,
    employees: visibleStaff.map((employee) => ({
      ...employee,
      name: `${employee.firstName} ${employee.lastName}`,
    })),
    orgUnits: units,
    jobProfiles: profiles,
    documents: visibleDocuments,
    canDefineRules: access.companyWide,
    analytics: {
      publishedPolicies: policies.filter((row) => row.status === "published").length,
      pendingAcknowledgements: acknowledgementRows.filter((row) => row.status === "assigned").length,
      overdueAcknowledgements: acknowledgementRows.filter((row) => row.overdue).length,
      missingDocuments: complianceRows.filter((row) => row.status === "missing").length,
      submittedDocuments: complianceRows.filter((row) => row.status === "submitted").length,
      expiringDocuments: complianceRows.filter((row) => row.status === "expiring").length,
      expiredDocuments: complianceRows.filter((row) => row.status === "expired").length,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "HCM documents and policy controls");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage HCM document controls.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access required." }, { status: 403 });

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-document-policy-" + (action || "mutation"),
    resourceId: organizationId,
    limit: 50,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "save-policy-draft") {
    if (!access.companyWide) {
      return Response.json({ error: "Company-wide People access is required to define policies." }, { status: 403 });
    }

    const id = body.id ? Number(body.id) : null;
    const code = policyCode(body.policyCode);
    const title = cleanText(body.title, 200);
    const category = cleanText(body.category || "company_policy", 60);
    const version = cleanText(body.version, 48);
    const effectiveFrom = validDate(body.effectiveFrom);
    const effectiveUntil = body.effectiveUntil ? validDate(body.effectiveUntil) : null;
    const targetConditions = body.targetConditions ?? {};
    const requiresAcknowledgement = body.requiresAcknowledgement !== false;
    const acknowledgementDueDays = Number(body.acknowledgementDueDays ?? 7);
    const content = String(body.content ?? "").trim().replace(/\r\n/g, "\n");

    if (
      !code
      || !title
      || !version
      || !effectiveFrom
      || !validHcmTargetConditions(targetConditions)
      || !Number.isInteger(acknowledgementDueDays)
      || acknowledgementDueDays < 0
      || acknowledgementDueDays > 365
      || content.length < 20
      || content.length > 200_000
    ) {
      return Response.json({
        error: "Policy code, title, version, effective date, valid targeting, 0–365 due days, and policy content are required.",
      }, { status: 400 });
    }
    if (effectiveUntil && effectiveUntil < effectiveFrom) {
      return Response.json({ error: "effectiveUntil cannot be before effectiveFrom." }, { status: 400 });
    }

    const contentSha256 = createHash("sha256").update(content, "utf8").digest("hex");

    if (id) {
      const [existing] = await db.select().from(hcmPolicyVersions).where(and(
        eq(hcmPolicyVersions.id, id),
        eq(hcmPolicyVersions.organizationId, organizationId),
      )).limit(1);
      if (!existing) return Response.json({ error: "Policy draft not found." }, { status: 404 });
      if (existing.status !== "draft") {
        return Response.json({ error: "Published policy versions are immutable. Create a new version instead." }, { status: 409 });
      }

      const [updated] = await db.update(hcmPolicyVersions).set({
        policyCode: code,
        title,
        category,
        version,
        effectiveFrom,
        effectiveUntil,
        targetConditions,
        requiresAcknowledgement,
        acknowledgementDueDays,
        content,
        contentSha256,
        updatedAt: new Date(),
      }).where(eq(hcmPolicyVersions.id, id)).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "HCM policy draft updated",
        resource: `${code} v${version}`,
        metadata: { policyId: updated.id, contentSha256, targetConditions },
      });
      return Response.json(updated);
    }

    try {
      const [created] = await db.insert(hcmPolicyVersions).values({
        organizationId,
        policyCode: code,
        title,
        category,
        version,
        effectiveFrom,
        effectiveUntil,
        targetConditions,
        requiresAcknowledgement,
        acknowledgementDueDays,
        content,
        contentSha256,
        createdByUserId: user.id,
        createdByName: user.name,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "HCM policy draft created",
        resource: `${code} v${version}`,
        metadata: { policyId: created.id, contentSha256, targetConditions },
      });
      return Response.json(created, { status: 201 });
    } catch {
      return Response.json({ error: "That policy code/version already exists." }, { status: 409 });
    }
  }

  if (action === "publish-policy") {
    if (!access.companyWide) {
      return Response.json({ error: "Company-wide People access is required to publish policies." }, { status: 403 });
    }
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const policyId = Number(body.policyId);
    if (!Number.isInteger(policyId)) return Response.json({ error: "policyId is required." }, { status: 400 });

    const [policy] = await db.select().from(hcmPolicyVersions).where(and(
      eq(hcmPolicyVersions.id, policyId),
      eq(hcmPolicyVersions.organizationId, organizationId),
    )).limit(1);
    if (!policy) return Response.json({ error: "Policy version not found." }, { status: 404 });
    if (policy.status === "published") {
      return Response.json({ policy, materialized: { targeted: 0, inserted: 0 }, alreadyPublished: true });
    }
    if (policy.status !== "draft") {
      return Response.json({ error: "Only draft policy versions can be published." }, { status: 409 });
    }
    if (!validHcmTargetConditions(policy.targetConditions)) {
      return Response.json({ error: "Stored policy targeting is invalid." }, { status: 409 });
    }

    const publishedAt = new Date();
    const [published] = await db.update(hcmPolicyVersions).set({
      status: "published",
      approvedByUserId: user.id,
      approvedByName: user.name,
      approvedAt: publishedAt,
      updatedAt: publishedAt,
    }).where(and(
      eq(hcmPolicyVersions.id, policy.id),
      eq(hcmPolicyVersions.status, "draft"),
    )).returning();
    if (!published) {
      return Response.json({ error: "Policy state changed while publishing. Refresh and retry." }, { status: 409 });
    }

    const materialized = await materializePolicyAssignments({
      organizationId,
      policyId: published.id,
      effectiveFrom: String(published.effectiveFrom),
      targetConditions: policy.targetConditions,
      requiresAcknowledgement: published.requiresAcknowledgement,
      acknowledgementDueDays: published.acknowledgementDueDays,
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM policy version published",
      resource: `${published.policyCode} v${published.version}`,
      metadata: {
        policyId: published.id,
        contentSha256: published.contentSha256,
        targetedEmployees: materialized.targeted,
        assignmentsCreated: materialized.inserted,
      },
    });

    return Response.json({ policy: published, materialized });
  }

  if (action === "create-document-requirement") {
    if (!access.companyWide) {
      return Response.json({ error: "Company-wide People access is required to define document requirements." }, { status: 403 });
    }

    const code = policyCode(body.code);
    const name = cleanText(body.name, 180);
    const kind = cleanText(body.kind, 40);
    const targetConditions = body.targetConditions ?? {};
    const mandatory = body.mandatory !== false;
    const expiryRequired = Boolean(body.expiryRequired);
    const submissionDueDays = Number(body.submissionDueDays ?? 14);
    const renewalLeadDays = Number(body.renewalLeadDays ?? 30);

    if (
      !code
      || !name
      || !kind
      || !validHcmTargetConditions(targetConditions)
      || !Number.isInteger(submissionDueDays)
      || submissionDueDays < 0
      || submissionDueDays > 365
      || !Number.isInteger(renewalLeadDays)
      || renewalLeadDays < 0
      || renewalLeadDays > 365
    ) {
      return Response.json({ error: "Valid requirement code, name, type, targeting, and due/renewal windows are required." }, { status: 400 });
    }

    try {
      const [created] = await db.insert(hcmDocumentRequirements).values({
        organizationId,
        code,
        name,
        kind,
        targetConditions,
        mandatory,
        expiryRequired,
        submissionDueDays,
        renewalLeadDays,
        createdByUserId: user.id,
        createdByName: user.name,
      }).returning();

      const materialized = await materializeDocumentRequirement({
        organizationId,
        requirementId: created.id,
        targetConditions,
        submissionDueDays,
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "HCM document requirement created",
        resource: created.code,
        metadata: {
          requirementId: created.id,
          kind: created.kind,
          expiryRequired,
          targetedEmployees: materialized.targeted,
          complianceRowsCreated: materialized.inserted,
        },
      });

      return Response.json({ requirement: created, materialized }, { status: 201 });
    } catch {
      return Response.json({ error: "A document requirement with that code already exists." }, { status: 409 });
    }
  }

  if (action === "verify-document") {
    const complianceId = Number(body.complianceId);
    if (!Number.isInteger(complianceId)) return Response.json({ error: "complianceId is required." }, { status: 400 });

    const [row] = await db.select().from(hcmEmployeeDocumentCompliance).where(and(
      eq(hcmEmployeeDocumentCompliance.id, complianceId),
      eq(hcmEmployeeDocumentCompliance.organizationId, organizationId),
    )).limit(1);
    if (!row) return Response.json({ error: "Document compliance row not found." }, { status: 404 });

    const [employee] = await db.select({
      id: employees.id,
      orgUnitId: employees.orgUnitId,
      employeeNo: employees.employeeNo,
    }).from(employees).where(and(
      eq(employees.id, row.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    if (!row.documentId) return Response.json({ error: "No submitted document is linked to this requirement." }, { status: 409 });

    const [requirement] = await db.select().from(hcmDocumentRequirements).where(and(
      eq(hcmDocumentRequirements.id, row.requirementId),
      eq(hcmDocumentRequirements.organizationId, organizationId),
    )).limit(1);
    if (!requirement) return Response.json({ error: "Document requirement not found." }, { status: 404 });
    if (requirement.expiryRequired && !row.expiresAt) {
      return Response.json({ error: "This requirement needs an expiry date before verification." }, { status: 409 });
    }

    const computed = documentComplianceStatus(
      row.expiresAt ? String(row.expiresAt) : null,
      requirement.renewalLeadDays,
    );
    const [updated] = await db.update(hcmEmployeeDocumentCompliance).set({
      status: computed.status,
      verifiedAt: new Date(),
      verifiedByUserId: user.id,
      verifiedByName: user.name,
      updatedAt: new Date(),
    }).where(eq(hcmEmployeeDocumentCompliance.id, row.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee document verified",
      resource: `${employee.employeeNo} · ${requirement.code}`,
      metadata: {
        complianceId: row.id,
        documentId: row.documentId,
        expiresAt: row.expiresAt,
        status: computed.status,
      },
    });
    return Response.json(updated);
  }

  if (action === "waive-policy-assignment") {
    const assignmentId = Number(body.assignmentId);
    const reason = cleanText(body.reason, 240);
    if (!Number.isInteger(assignmentId) || !reason) {
      return Response.json({ error: "assignmentId and waiver reason are required." }, { status: 400 });
    }

    const [assignment] = await db.select().from(hcmPolicyAssignments).where(and(
      eq(hcmPolicyAssignments.id, assignmentId),
      eq(hcmPolicyAssignments.organizationId, organizationId),
    )).limit(1);
    if (!assignment) return Response.json({ error: "Policy assignment not found." }, { status: 404 });
    if (assignment.status === "acknowledged") {
      return Response.json({ error: "Acknowledged evidence is immutable and cannot be replaced by a waiver." }, { status: 409 });
    }

    const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees).where(and(
      eq(employees.id, assignment.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const [updated] = await db.update(hcmPolicyAssignments).set({
      status: "waived",
      waivedAt: new Date(),
      waivedByUserId: user.id,
      waivedByName: user.name,
      waiverReason: reason,
      updatedAt: new Date(),
    }).where(eq(hcmPolicyAssignments.id, assignment.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Policy acknowledgement requirement waived",
      resource: `Policy assignment #${assignment.id}`,
      metadata: { employeeId: assignment.employeeId, reason },
    });
    return Response.json(updated);
  }

  if (action === "waive-document-requirement") {
    const complianceId = Number(body.complianceId);
    const reason = cleanText(body.reason, 240);
    if (!Number.isInteger(complianceId) || !reason) {
      return Response.json({ error: "complianceId and waiver reason are required." }, { status: 400 });
    }

    const [row] = await db.select().from(hcmEmployeeDocumentCompliance).where(and(
      eq(hcmEmployeeDocumentCompliance.id, complianceId),
      eq(hcmEmployeeDocumentCompliance.organizationId, organizationId),
    )).limit(1);
    if (!row) return Response.json({ error: "Document compliance row not found." }, { status: 404 });

    const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees).where(and(
      eq(employees.id, row.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const [updated] = await db.update(hcmEmployeeDocumentCompliance).set({
      status: "waived",
      waivedAt: new Date(),
      waivedByUserId: user.id,
      waivedByName: user.name,
      waiverReason: reason,
      updatedAt: new Date(),
    }).where(eq(hcmEmployeeDocumentCompliance.id, row.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee document requirement waived",
      resource: `Document compliance #${row.id}`,
      metadata: { employeeId: row.employeeId, requirementId: row.requirementId, reason },
    });
    return Response.json(updated);
  }

  return Response.json({ error: "Unsupported HCM document-policy action." }, { status: 400 });
}
