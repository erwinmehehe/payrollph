import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  managedPayrollEngagements,
  managedPayrollGates,
  managedPayrollRunApprovals,
  payrollRuns,
  userOrganizations,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { MANAGED_PAYROLL_GATES, managedPayrollRunFingerprint } from "@/lib/managed-payroll";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Approving managed payroll");
  if (demoDenied) return demoDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid payroll run." }, { status: 400 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const [engagement] = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, run.organizationId))
    .limit(1);
  if (!engagement || !["pilot", "live"].includes(engagement.status)) {
    return Response.json({ error: "This workspace is not in an active managed-payroll engagement." }, { status: 409 });
  }
  if (user.id !== engagement.clientApproverUserId) {
    return Response.json({ error: "Only the designated client approver can approve this managed payroll run." }, { status: 403 });
  }
  const [membership] = await db.select().from(userOrganizations)
    .where(and(
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.organizationId, run.organizationId),
    )).limit(1);
  if (!membership || membership.orgUnitId != null || !["owner", "admin"].includes(membership.role)) {
    return Response.json({ error: "Managed payroll client approval requires company-wide owner or administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  if (run.status !== "Ready for release") {
    return Response.json({
      error: `Client approval is available only after independent checker approval (currently ${run.status}).`,
    }, { status: 409 });
  }

  const approvalEvents = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, run.organizationId));
  const checkerDecision = approvalEvents
    .filter((event) => {
      if (!["Approval approved", "Approval approved by delegate"].includes(event.action)) return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      return Number((event.metadata as Record<string, unknown>).payrollRunId) === run.id;
    })
    .sort((left, right) => right.id - left.id)[0] ?? null;
  if (!checkerDecision) {
    return Response.json({
      error: "Independent checker approval evidence is missing. Re-submit this payroll for authenticated checker review before client approval.",
    }, { status: 409 });
  }
  const checkerMetadata = checkerDecision.metadata as Record<string, unknown>;
  const checkerUserId = Number(checkerMetadata.deciderUserId);
  const sameAuthenticatedChecker = Number.isInteger(checkerUserId)
    ? checkerUserId === user.id
    : checkerDecision.actor.trim().toLowerCase() === user.name.trim().toLowerCase();
  if (sameAuthenticatedChecker) {
    return Response.json({
      error: "Separation of duties: the payroll checker cannot also give the managed-payroll client approval for the same run.",
    }, { status: 403 });
  }

  const gates = await db.select().from(managedPayrollGates)
    .where(eq(managedPayrollGates.engagementId, engagement.id));
  const requiredGateKeys = new Set(MANAGED_PAYROLL_GATES.map((gate) => gate.key));
  const verifiedGateKeys = new Set(gates.filter((gate) => gate.status === "verified").map((gate) => gate.gateKey));
  const missingGateKeys = [...requiredGateKeys].filter((key) => !verifiedGateKeys.has(key));
  if (missingGateKeys.length > 0) {
    return Response.json({
      error: `Managed payroll implementation evidence is incomplete. Re-verify: ${missingGateKeys.join(", ")}.`,
      missingGateKeys,
    }, { status: 409 });
  }

  const [existing] = await db.select().from(managedPayrollRunApprovals)
    .where(eq(managedPayrollRunApprovals.payrollRunId, run.id))
    .limit(1);
  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const fingerprint = await managedPayrollRunFingerprint(run.id);
  if (existing) {
    const valid =
      existing.approverUserId === engagement.clientApproverUserId
      && existing.approvedByUserId === user.id
      && fingerprint === existing.payrollFingerprint
      && Number(run.grossPay) === Number(existing.approvedGross)
      && Number(run.netPay) === Number(existing.approvedNet)
      && Number(run.employeeCount) === Number(existing.approvedEmployeeCount);
    if (valid) return Response.json({ approval: existing, alreadyApproved: true });

    const [approval] = await db.update(managedPayrollRunApprovals).set({
      approverUserId: engagement.clientApproverUserId,
      approvedByUserId: user.id,
      approvedBy: user.name,
      payrollFingerprint: fingerprint,
      approvedGross: run.grossPay,
      approvedNet: run.netPay,
      approvedEmployeeCount: run.employeeCount,
      note: note || null,
      approvedAt: new Date(),
    }).where(eq(managedPayrollRunApprovals.id, existing.id)).returning();

    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Managed payroll client re-approved after payroll change",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        approvalId: approval.id,
        previousFingerprint: existing.payrollFingerprint,
        previousGross: existing.approvedGross,
        previousNet: existing.approvedNet,
        previousEmployeeCount: existing.approvedEmployeeCount,
        previousApprovedAt: existing.approvedAt,
        previousApprovedByUserId: existing.approvedByUserId,
        payrollFingerprint: fingerprint,
        grossPay: run.grossPay,
        netPay: run.netPay,
        employeeCount: run.employeeCount,
      },
    });
    return Response.json({ approval, replacedStaleApproval: true });
  }

  const [approval] = await db.insert(managedPayrollRunApprovals).values({
    engagementId: engagement.id,
    payrollRunId: run.id,
    approverUserId: engagement.clientApproverUserId,
    approvedByUserId: user.id,
    approvedBy: user.name,
    payrollFingerprint: fingerprint,
    approvedGross: run.grossPay,
    approvedNet: run.netPay,
    approvedEmployeeCount: run.employeeCount,
    note: note || null,
  }).returning();

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Managed payroll client approved",
    resource: run.periodLabel,
    metadata: {
      runId: run.id,
      approvalId: approval.id,
      payrollFingerprint: fingerprint,
      grossPay: run.grossPay,
      netPay: run.netPay,
      employeeCount: run.employeeCount,
    },
  });
  return Response.json({ approval }, { status: 201 });
}
