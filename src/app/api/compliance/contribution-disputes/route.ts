import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  employees,
  statutoryContributionDisputes,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { validateContributionDisputeResolution } from "@/lib/statutory-contribution-dispute";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const RESOLUTION_CODES = new Set(["posted_confirmed", "corrected", "not_an_error", "duplicate"]);

async function requireCompanywidePayroll(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  if (!access.companyWide) {
    return Response.json({
      error: "Statutory contribution disputes are company-wide and are not available to unit-scoped users.",
    }, { status: 403 });
  }
  if (!roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only authorized payroll operators can manage employee contribution disputes.",
      role: access.role,
    }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requireCompanywidePayroll(user.id, organizationId);
  if (denied) return denied;

  const rows = await db.select({
    id: statutoryContributionDisputes.id,
    organizationId: statutoryContributionDisputes.organizationId,
    employeeId: statutoryContributionDisputes.employeeId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    memberId: statutoryContributionDisputes.memberId,
    agency: statutoryContributionDisputes.agency,
    applicableMonth: statutoryContributionDisputes.applicableMonth,
    issueType: statutoryContributionDisputes.issueType,
    description: statutoryContributionDisputes.description,
    status: statutoryContributionDisputes.status,
    reportedByName: statutoryContributionDisputes.reportedByName,
    resolutionCode: statutoryContributionDisputes.resolutionCode,
    resolutionNote: statutoryContributionDisputes.resolutionNote,
    resolvedByName: statutoryContributionDisputes.resolvedByName,
    resolvedAt: statutoryContributionDisputes.resolvedAt,
    createdAt: statutoryContributionDisputes.createdAt,
  })
    .from(statutoryContributionDisputes)
    .innerJoin(employees, eq(statutoryContributionDisputes.employeeId, employees.id))
    .where(eq(statutoryContributionDisputes.organizationId, organizationId))
    .orderBy(desc(statutoryContributionDisputes.createdAt), desc(statutoryContributionDisputes.id));

  return Response.json({ disputes: rows });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const disputeId = Number(body.disputeId);
  const action = String(body.action ?? "").trim();
  const resolutionCode = String(body.resolutionCode ?? "").trim();
  const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 500);

  if (!Number.isInteger(organizationId) || !Number.isInteger(disputeId)) {
    return Response.json({ error: "organizationId and disputeId are required." }, { status: 400 });
  }

  const denied = await requireCompanywidePayroll(user.id, organizationId);
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `statutory-contribution-dispute-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action !== "resolve") {
    return Response.json({ error: "Unsupported action. Use resolve." }, { status: 400 });
  }
  if (!RESOLUTION_CODES.has(resolutionCode) || resolutionNote.length < 8) {
    return Response.json({
      error: "A valid resolutionCode and a resolution note of at least 8 characters are required.",
    }, { status: 400 });
  }

  const [dispute] = await db.select().from(statutoryContributionDisputes).where(and(
    eq(statutoryContributionDisputes.id, disputeId),
    eq(statutoryContributionDisputes.organizationId, organizationId),
  )).limit(1);
  if (!dispute) return Response.json({ error: "Contribution dispute not found." }, { status: 404 });
  if (dispute.status === "resolved") {
    return Response.json({ error: "This contribution dispute is already resolved." }, { status: 409 });
  }

  let member = null;
  if (dispute.memberId != null) {
    [member] = await db.select().from(statutoryRemittanceMembers).where(and(
      eq(statutoryRemittanceMembers.id, dispute.memberId),
      eq(statutoryRemittanceMembers.organizationId, organizationId),
    )).limit(1);
  }
  const resolutionGate = validateContributionDisputeResolution({
    resolutionCode: resolutionCode as "posted_confirmed" | "corrected" | "not_an_error" | "duplicate",
    member,
  });
  if (!resolutionGate.ok) {
    return Response.json({ error: resolutionGate.error }, { status: 409 });
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(statutoryContributionDisputes).set({
      status: "resolved",
      resolutionCode,
      resolutionNote,
      resolvedByUserId: user.id,
      resolvedByName: user.name,
      resolvedAt: now,
      updatedAt: now,
    }).where(and(
      eq(statutoryContributionDisputes.id, dispute.id),
      eq(statutoryContributionDisputes.organizationId, organizationId),
      eq(statutoryContributionDisputes.status, dispute.status),
    )).returning();

    if (!updated) throw new Error("Contribution dispute changed before it could be resolved.");

    await tx.update(complianceActionTasks).set({
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
    }).where(and(
      eq(complianceActionTasks.organizationId, organizationId),
      eq(complianceActionTasks.sourceType, "employee_contribution_dispute"),
      eq(complianceActionTasks.sourceKey, `dispute:${dispute.id}`),
    ));

    return updated;
  }).catch((error) => ({ error: error instanceof Error ? error.message : "Contribution dispute resolution failed." }));

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee statutory contribution issue resolved",
    resource: `${dispute.agency} · ${dispute.applicableMonth} · employee #${dispute.employeeId}`,
    metadata: {
      disputeId: dispute.id,
      employeeId: dispute.employeeId,
      memberId: dispute.memberId,
      issueType: dispute.issueType,
      resolutionCode,
      resolutionNote,
      reportedByUserId: dispute.reportedByUserId,
      reportedByName: dispute.reportedByName,
    },
  });

  return Response.json({ dispute: result });
}
