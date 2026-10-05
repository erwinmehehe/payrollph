import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  employees,
  statutoryContributionDisputes,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { currentManilaDate, currentManilaMonth } from "@/lib/statutory-remittance-state";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const AGENCIES = new Set(["SSS", "PhilHealth", "Pag-IBIG"]);
const ISSUE_TYPES = new Set(["missing_posting", "wrong_amount", "wrong_reference", "other"]);

async function employeeForSession(userId: number, employeeId: number, organizationId: number) {
  const denied = await assertMembership(userId, organizationId);
  if (denied) return { employee: null, denied };

  const [employee] = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    organizationId: employees.organizationId,
  }).from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);

  if (!employee) {
    return {
      employee: null,
      denied: Response.json({ error: "Employee profile is not linked to this organization." }, { status: 403 }),
    };
  }
  return { employee, denied: null };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const check = await employeeForSession(user.id, user.employeeId, organizationId);
  if (check.denied) return check.denied;

  const rows = await db.select().from(statutoryContributionDisputes).where(and(
    eq(statutoryContributionDisputes.organizationId, organizationId),
    eq(statutoryContributionDisputes.employeeId, user.employeeId),
  )).orderBy(desc(statutoryContributionDisputes.createdAt), desc(statutoryContributionDisputes.id));

  return Response.json({ disputes: rows });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const agency = String(body.agency ?? "").trim();
  const applicableMonth = String(body.applicableMonth ?? "").trim();
  const issueType = String(body.issueType ?? "").trim();
  const description = String(body.description ?? "").trim().slice(0, 500);

  if (
    !Number.isInteger(organizationId)
    || !AGENCIES.has(agency)
    || !/^\d{4}-\d{2}$/.test(applicableMonth)
    || !ISSUE_TYPES.has(issueType)
    || description.length < 8
  ) {
    return Response.json({
      error: "organizationId, agency, applicableMonth, issueType, and a description of at least 8 characters are required.",
    }, { status: 400 });
  }
  if (applicableMonth > currentManilaMonth()) {
    return Response.json({ error: "A future contribution month cannot be disputed." }, { status: 400 });
  }

  const check = await employeeForSession(user.id, user.employeeId, organizationId);
  if (check.denied) return check.denied;
  const employee = check.employee!;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "employee-contribution-dispute",
    resourceId: organizationId,
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
    eq(statutoryRemittanceBatches.organizationId, organizationId),
    eq(statutoryRemittanceBatches.agency, agency),
    eq(statutoryRemittanceBatches.applicableMonth, applicableMonth),
  )).limit(1);

  const [member] = batch
    ? await db.select().from(statutoryRemittanceMembers).where(and(
        eq(statutoryRemittanceMembers.organizationId, organizationId),
        eq(statutoryRemittanceMembers.batchId, batch.id),
        eq(statutoryRemittanceMembers.employeeId, employee.id),
      )).limit(1)
    : [];

  if ((issueType === "wrong_amount" || issueType === "wrong_reference") && !member) {
    return Response.json({
      error: "That issue type requires an existing contribution posting record. Use missing posting or other instead.",
    }, { status: 409 });
  }

  const existing = await db.select({ id: statutoryContributionDisputes.id, status: statutoryContributionDisputes.status })
    .from(statutoryContributionDisputes)
    .where(and(
      eq(statutoryContributionDisputes.organizationId, organizationId),
      eq(statutoryContributionDisputes.employeeId, employee.id),
      eq(statutoryContributionDisputes.agency, agency),
      eq(statutoryContributionDisputes.applicableMonth, applicableMonth),
      eq(statutoryContributionDisputes.issueType, issueType),
    ));
  if (existing.some((row) => row.status !== "resolved")) {
    return Response.json({
      error: "You already have an unresolved report for this agency, month, and issue type.",
    }, { status: 409 });
  }

  const today = currentManilaDate();
  const overdue = batch?.dueDate ? String(batch.dueDate) < today : applicableMonth < currentManilaMonth();
  const severity = overdue || member?.postingStatus === "exception" ? "danger" : "warning";

  const result = await db.transaction(async (tx) => {
    const [dispute] = await tx.insert(statutoryContributionDisputes).values({
      organizationId,
      employeeId: employee.id,
      memberId: member?.id ?? null,
      agency,
      applicableMonth,
      issueType,
      description,
      status: "open",
      reportedByUserId: user.id,
      reportedByName: user.name,
    }).returning();

    const [task] = await tx.insert(complianceActionTasks).values({
      organizationId,
      sourceType: "employee_contribution_dispute",
      sourceKey: `dispute:${dispute.id}`,
      agency,
      applicableMonth,
      severity,
      title: `Employee reported ${agency} contribution issue`,
      detail: `${employee.employeeNo} · ${description}`.slice(0, 360),
      dueDate: batch?.dueDate ?? null,
      status: "open",
    }).returning();

    return { dispute, task };
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee statutory contribution issue reported",
    resource: `${agency} · ${applicableMonth} · ${employee.employeeNo}`,
    metadata: {
      disputeId: result.dispute.id,
      complianceActionId: result.task.id,
      employeeId: employee.id,
      memberId: member?.id ?? null,
      issueType,
      postingStatus: member?.postingStatus ?? null,
      postedAmount: member?.postedAmount ?? null,
    },
  });

  return Response.json({ dispute: result.dispute }, { status: 201 });
}
