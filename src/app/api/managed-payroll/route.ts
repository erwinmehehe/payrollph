import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  managedPayrollEngagements,
  managedPayrollGates,
  managedPayrollRunApprovals,
  payrollRuns,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PAYROLL_OPERATOR_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { managedPayrollRunFingerprint, seedManagedPayrollGates } from "@/lib/managed-payroll";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const OWNER_ONLY = ["owner"] as const;

async function managedPayload(organizationId: number, userId: number) {
  const [engagement] = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, organizationId))
    .limit(1);
  if (!engagement) return { engagement: null, gates: [], runs: [], designatedApprover: null };

  await seedManagedPayrollGates(engagement.id);

  const [gates, runs, approvals, approverRows] = await Promise.all([
    db.select().from(managedPayrollGates)
      .where(eq(managedPayrollGates.engagementId, engagement.id))
      .orderBy(managedPayrollGates.id),
    db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId))
      .orderBy(desc(payrollRuns.id))
      .limit(12),
    db.select().from(managedPayrollRunApprovals)
      .where(eq(managedPayrollRunApprovals.engagementId, engagement.id)),
    db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, engagement.clientApproverUserId))
      .limit(1),
  ]);

  const approvalsByRun = new Map(approvals.map((approval) => [approval.payrollRunId, approval]));
  const runRows = [];
  for (const run of runs) {
    const approval = approvalsByRun.get(run.id) ?? null;
    const fingerprint = approval ? await managedPayrollRunFingerprint(run.id) : null;
    runRows.push({
      id: run.id,
      periodLabel: run.periodLabel,
      status: run.status,
      payDate: run.payDate,
      employeeCount: run.employeeCount,
      grossPay: run.grossPay,
      netPay: run.netPay,
      clientApproval: approval ? {
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        valid:
          fingerprint === approval.payrollFingerprint
          && Number(run.grossPay) === Number(approval.approvedGross)
          && Number(run.netPay) === Number(approval.approvedNet)
          && Number(run.employeeCount) === Number(approval.approvedEmployeeCount),
      } : null,
    });
  }

  return {
    engagement,
    gates,
    runs: runRows,
    designatedApprover: approverRows[0] ?? null,
    currentUserIsApprover: engagement.clientApproverUserId === userId,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only company-wide People or payroll operators can review managed payroll.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Managed payroll operations require company-wide access." }, { status: 403 });
  }
  return Response.json(await managedPayload(organizationId, user.id));
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Enabling managed payroll");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    OWNER_ONLY,
    "Only the workspace owner can enable managed payroll.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide owner access is required." }, { status: 403 });
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const [existing] = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, organizationId))
    .limit(1);
  if (existing) return Response.json(await managedPayload(organizationId, user.id));

  const approverUserId = Number(body.clientApproverUserId ?? user.id);
  const [approverMembership] = await db.select({
    userId: userOrganizations.userId,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
  }).from(userOrganizations)
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.userId, approverUserId),
    ))
    .limit(1);
  if (!approverMembership || approverMembership.orgUnitId != null || !["owner", "admin"].includes(approverMembership.role)) {
    return Response.json({ error: "The managed-payroll client approver must be a company-wide owner or administrator." }, { status: 422 });
  }

  const targetGoLive = typeof body.targetGoLive === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetGoLive)
    ? body.targetGoLive
    : null;
  const slaHours = Number(body.slaHours ?? 24);
  if (!Number.isInteger(slaHours) || slaHours < 4 || slaHours > 168) {
    return Response.json({ error: "SLA hours must be between 4 and 168." }, { status: 422 });
  }

  const [engagement] = await db.insert(managedPayrollEngagements).values({
    organizationId,
    status: "pilot",
    serviceTier: "Managed payroll",
    clientApproverUserId: approverUserId,
    slaHours,
    targetGoLive,
    createdBy: user.name,
  }).returning();
  await seedManagedPayrollGates(engagement.id);
  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Managed payroll engagement enabled",
    resource: "Managed payroll",
    metadata: { engagementId: engagement.id, clientApproverUserId: approverUserId, slaHours, targetGoLive },
  });
  return Response.json(await managedPayload(organizationId, user.id), { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Updating managed payroll");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can update managed-payroll evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide payroll access is required." }, { status: 403 });

  const [engagement] = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, organizationId))
    .limit(1);
  if (!engagement) return Response.json({ error: "Managed payroll has not been enabled." }, { status: 404 });

  if (body.action === "gate") {
    const gateId = Number(body.gateId);
    const status = body.status === "verified" ? "verified" : body.status === "pending" ? "pending" : "";
    const evidenceRef = typeof body.evidenceRef === "string" ? body.evidenceRef.trim().slice(0, 800) : "";
    if (!Number.isInteger(gateId) || !status) return Response.json({ error: "A valid gate and status are required." }, { status: 400 });
    if (status === "verified" && evidenceRef.length < 3) {
      return Response.json({ error: "Verified implementation gates require a concrete evidence reference." }, { status: 422 });
    }

    const [gate] = await db.select().from(managedPayrollGates)
      .where(eq(managedPayrollGates.id, gateId))
      .limit(1);
    if (!gate || gate.engagementId !== engagement.id) return Response.json({ error: "Managed payroll gate not found." }, { status: 404 });

    await db.update(managedPayrollGates).set({
      status,
      evidenceRef: status === "verified" ? evidenceRef : null,
      completedBy: status === "verified" ? user.name : null,
      completedAt: status === "verified" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(managedPayrollGates.id, gate.id));

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: status === "verified" ? "Managed payroll gate evidenced" : "Managed payroll gate reopened",
      resource: gate.label,
      metadata: { gateId, gateKey: gate.gateKey, evidenceRef: status === "verified" ? evidenceRef : null },
    });
    return Response.json(await managedPayload(organizationId, user.id));
  }

  if (body.action === "engagement") {
    const ownerDenied = await assertOrganizationRole(user.id, organizationId, OWNER_ONLY, "Only the workspace owner can change managed-payroll governance.");
    if (ownerDenied) return ownerDenied;
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const status = ["pilot", "live", "paused"].includes(body.status) ? body.status : engagement.status;
    const approverUserId = Number(body.clientApproverUserId ?? engagement.clientApproverUserId);
    const memberships = await db.select().from(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));
    const approver = memberships.find((row) => row.userId === approverUserId);
    if (!approver || approver.orgUnitId != null || !["owner", "admin"].includes(approver.role)) {
      return Response.json({ error: "Client approver must be a company-wide owner or administrator." }, { status: 422 });
    }
    await db.update(managedPayrollEngagements).set({
      status,
      clientApproverUserId: approverUserId,
      updatedAt: new Date(),
    }).where(eq(managedPayrollEngagements.id, engagement.id));
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Managed payroll governance updated",
      resource: "Managed payroll",
      metadata: { status, clientApproverUserId: approverUserId },
    });
    return Response.json(await managedPayload(organizationId, user.id));
  }

  return Response.json({ error: "Unsupported managed payroll update." }, { status: 400 });
}
