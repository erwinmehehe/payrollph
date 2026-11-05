import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { activeManagedPayrollClientApprover } from "@/lib/managed-payroll-client-approval";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" } as const;
const runNotFound = () => Response.json({ error: "Payroll run not found." }, { status: 404, headers: privateHeaders });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Approving managed payroll");
  if (demoDenied) return demoDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId < 1) {
    return Response.json({ error: "Invalid payroll run." }, { status: 400, headers: privateHeaders });
  }

  // Resolve an ID-only run THROUGH an active, company-wide owner/admin membership,
  // before inspecting engagement existence or any payroll state. Real foreign and
  // nonexistent run IDs produce the same no-store 404.
  const [scopedRun] = await db.select({ run: payrollRuns, membership: userOrganizations })
    .from(payrollRuns)
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.organizationId, payrollRuns.organizationId),
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.active, true),
      isNull(userOrganizations.orgUnitId),
      inArray(userOrganizations.role, ["owner", "admin"]),
    ))
    .where(eq(payrollRuns.id, runId))
    .limit(1);
  if (!scopedRun) return runNotFound();
  const run = scopedRun.run;
  const [engagement] = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, run.organizationId))
    .limit(1);
  if (!engagement) {
    return Response.json({ error: "This workspace is not in an active managed-payroll engagement." }, { status: 409, headers: privateHeaders });
  }
  if (!activeManagedPayrollClientApprover(user.id, run.organizationId, scopedRun.membership, engagement)) {
    return Response.json({ error: "Only the active designated client approver can approve this run." }, { status: 403, headers: privateHeaders });
  }
  if (!["pilot", "live"].includes(engagement.status)) {
    return Response.json({ error: "This workspace is not in an active managed-payroll engagement." }, { status: 409, headers: privateHeaders });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  if (run.status !== "Ready for release") {
    return Response.json({
      error: `Client approval is available only after independent checker approval (currently ${run.status}).`,
    }, { status: 409 });
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

  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";

  return db.transaction(async (tx) => {
    // Lock membership and engagement against revocation/reassignment, then
    // serialize any approvals or payroll-run changes for this run. A preflight
    // snapshot alone must never authorize a later approval or audit write.
    await tx.execute(sql`SELECT id FROM user_organizations
      WHERE user_id = ${user.id} AND organization_id = ${run.organizationId} FOR SHARE`);
    await tx.execute(sql`SELECT id FROM managed_payroll_engagements
      WHERE id = ${engagement.id} AND organization_id = ${run.organizationId} FOR SHARE`);
    await tx.execute(sql`SELECT id FROM payroll_runs
      WHERE id = ${run.id} AND organization_id = ${run.organizationId} FOR UPDATE`);

    const [freshMembership] = await tx.select().from(userOrganizations).where(and(
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.organizationId, run.organizationId),
    )).limit(1);
    const [freshEngagement] = await tx.select().from(managedPayrollEngagements).where(and(
      eq(managedPayrollEngagements.id, engagement.id),
      eq(managedPayrollEngagements.organizationId, run.organizationId),
    )).limit(1);
    const [freshRun] = await tx.select().from(payrollRuns).where(and(
      eq(payrollRuns.id, run.id),
      eq(payrollRuns.organizationId, run.organizationId),
    )).limit(1);

    if (!activeManagedPayrollClientApprover(user.id, run.organizationId, freshMembership, freshEngagement)) {
      return runNotFound();
    }
    if (!freshEngagement || !["pilot", "live"].includes(freshEngagement.status)
      || !freshRun || freshRun.organizationId !== run.organizationId
      || freshRun.status !== "Ready for release"
      || freshRun.grossPay !== run.grossPay
      || freshRun.netPay !== run.netPay
      || freshRun.employeeCount !== run.employeeCount) {
      return Response.json({ error: "Managed payroll authorization or run state changed. Refresh." }, {
        status: 409, headers: privateHeaders,
      });
    }

    // Validate checker evidence and separation of duties after locking the payroll run,
    // in the same transaction as the client approval and audit write.
    const approvalEvents = await tx.select().from(auditEvents)
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

    // Prevent a gate being un-verified between preflight and the approval write.
    await tx.execute(sql`SELECT id FROM managed_payroll_gates
      WHERE engagement_id = ${engagement.id} FOR SHARE`);
    const freshGates = await tx.select().from(managedPayrollGates)
      .where(eq(managedPayrollGates.engagementId, engagement.id));
    const verified = new Set(freshGates.filter(g => g.status === "verified").map(g => g.gateKey));
    if (MANAGED_PAYROLL_GATES.some(g => !verified.has(g.key))) {
      return Response.json({ error: "Managed payroll evidence changed. Re-verify implementation gates." }, {
        status: 409, headers: privateHeaders,
      });
    }

    const [existing] = await tx.select().from(managedPayrollRunApprovals)
      .where(and(
        eq(managedPayrollRunApprovals.engagementId, engagement.id),
        eq(managedPayrollRunApprovals.payrollRunId, run.id),
      ))
      .limit(1);
    const fingerprint = await managedPayrollRunFingerprint(run.id, tx);
    if (existing) {
      const valid =
        existing.approverUserId === engagement.clientApproverUserId
        && existing.approvedByUserId === user.id
        && fingerprint === existing.payrollFingerprint
        && Number(run.grossPay) === Number(existing.approvedGross)
        && Number(run.netPay) === Number(existing.approvedNet)
        && Number(run.employeeCount) === Number(existing.approvedEmployeeCount);
      if (valid) return Response.json({ approval: existing, alreadyApproved: true }, { headers: privateHeaders });

      const [approval] = await tx.update(managedPayrollRunApprovals).set({
        approverUserId: engagement.clientApproverUserId,
        approvedByUserId: user.id,
        approvedBy: user.name,
        payrollFingerprint: fingerprint,
        approvedGross: run.grossPay,
        approvedNet: run.netPay,
        approvedEmployeeCount: run.employeeCount,
        note: note || null,
        approvedAt: new Date(),
      }).where(and(
        eq(managedPayrollRunApprovals.id, existing.id),
        eq(managedPayrollRunApprovals.engagementId, engagement.id),
        eq(managedPayrollRunApprovals.payrollRunId, run.id),
      )).returning();
      if (!approval) {
        return Response.json({ error: "Managed payroll approval changed. Refresh." }, { status: 409, headers: privateHeaders });
      }

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
      }, tx);
      return Response.json({ approval, replacedStaleApproval: true }, { headers: privateHeaders });
    }

    const [approval] = await tx.insert(managedPayrollRunApprovals).values({
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
    }, tx);
    return Response.json({ approval }, { status: 201, headers: privateHeaders });
  });
}
