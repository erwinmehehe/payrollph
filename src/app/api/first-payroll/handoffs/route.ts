import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { automationOperationalCases, organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { recordAuditEvent } from "@/lib/audit";

const STEPS: Record<string, { team: string; title: string; detail: string; sourceId: number }> = {
  company: { team: "People Operations", title: "Confirm legal employer setup", detail: "Check employer identity, payroll calendar and access.", sourceId: 1 },
  people: { team: "HR Operations", title: "Verify payroll roster and payout records", detail: "Complete missing employee pay and payout details.", sourceId: 2 },
  time: { team: "Timekeeping", title: "Review cutoff attendance", detail: "Review missing punches, leave and time exceptions.", sourceId: 3 },
  reviewers: { team: "People Operations", title: "Assign maker and checker", detail: "Assign distinct payroll maker and checker roles.", sourceId: 4 },
  payroll: { team: "Payroll", title: "Prepare and review first payroll", detail: "Calculate and resolve payroll blockers before review.", sourceId: 5 },
  approval: { team: "Payroll", title: "Review first-payroll approval", detail: "Checker must independently approve an immutable snapshot.", sourceId: 6 },
  exports: { team: "Compliance", title: "Prepare first-payroll records", detail: "Reconcile payslips, statutory worksheets and agency receipts.", sourceId: 7 },
};

export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("workflowFirstPayrollAdvisory"))
    return Response.json({ error: "Inline first-payroll handoff is disabled." }, { status: 404 });
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const step = typeof body.step === "string" ? STEPS[body.step] : undefined;
  // Reserve negative keys so ordinary readiness cases from other workflows
  // cannot be mistaken for this UI's idempotent handoff.
  const stepSourceId = step ? -1000 - step.sourceId : 0;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !step)
    return Response.json({ error: "Invalid employer or first-payroll step." }, { status: 400 });
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return denied;
  const [org] = await db.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return Response.json({ error: "Employer not found." }, { status: 404 });
  const [existing] = await db.select({ id: automationOperationalCases.id, status: automationOperationalCases.status })
    .from(automationOperationalCases).where(and(
      eq(automationOperationalCases.organizationId, organizationId),
      eq(automationOperationalCases.caseType, "payroll_readiness"),
      eq(automationOperationalCases.sourceId, stepSourceId),
    )).limit(1);
  if (existing?.status === "resolved")
    return Response.json({ error: "The existing handoff is resolved; it cannot be silently reopened." }, { status: 409 });
  if (existing) return Response.json({ caseId: existing.id, team: step.team, alreadySent: true });
  const [created] = await db.insert(automationOperationalCases).values({
    organizationId,
    caseType: "payroll_readiness",
    sourceType: "first_payroll_ui",
    sourceId: stepSourceId,
    ownerTeam: step.team,
    title: step.title,
    detail: step.detail,
    evidence: { step: body.step, assignedRole: step.team, requestedByUserId: user.id, noPermissionGranted: true },
  }).onConflictDoNothing().returning({ id: automationOperationalCases.id });
  const id = created?.id ?? (await db.select({ id: automationOperationalCases.id })
    .from(automationOperationalCases).where(and(
      eq(automationOperationalCases.organizationId, organizationId),
      eq(automationOperationalCases.caseType, "payroll_readiness"),
      eq(automationOperationalCases.sourceId, stepSourceId),
    )).limit(1))[0]?.id;
  if (!id) return Response.json({ error: "Could not create the handoff." }, { status: 409 });
  if (created) await recordAuditEvent({
    organizationId, actor: user.name, action: "First payroll step sent to team",
    resource: step.title, metadata: { caseId: id, team: step.team, stepKey: body.step, userId: user.id },
  });
  return Response.json({ caseId: id, team: step.team, alreadySent: !created }, { status: created ? 201 : 200 });
}
