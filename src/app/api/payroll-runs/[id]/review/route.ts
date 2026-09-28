import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  employees,
  parallelPayrollRows,
  payrollEntries,
  payrollRuns,
  userOrganizations,
  users,
} from "@/db/schema";
import { assertMembership, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { auditPayrollControl } from "@/lib/payroll-control";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertMembership(user.id, run.organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, run.organizationId);
  if (!access || access.role === "employee") {
    return Response.json({ error: "Payroll operations require a payroll or administrative workspace role." }, { status: 403 });
  }

  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: userOrganizations.role,
    })
    .from(userOrganizations)
    .innerJoin(users, eq(users.id, userOrganizations.userId))
    .where(eq(userOrganizations.organizationId, run.organizationId))
    .orderBy(asc(users.name));

  return Response.json({
    approvers: members.filter((member) => member.userId !== user.id && member.role !== "employee"),
    maker: { userId: user.id, name: user.name },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertMembership(user.id, run.organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, run.organizationId);
  if (!access || access.role === "employee") {
    return Response.json({ error: "Payroll operations require a payroll or administrative workspace role." }, { status: 403 });
  }
  if (run.status === "Released") {
    return Response.json({ error: "Released payroll cannot be submitted for approval." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const approverUserId = Number(body.approverUserId);
  if (!Number.isInteger(approverUserId)) {
    return Response.json({ error: "Choose an approver." }, { status: 400 });
  }
  if (approverUserId === user.id) {
    return Response.json({ error: "Maker-checker control: the person submitting payroll cannot approve the same run." }, { status: 409 });
  }

  const [approver] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: userOrganizations.role,
    })
    .from(userOrganizations)
    .innerJoin(users, eq(users.id, userOrganizations.userId))
    .where(and(eq(userOrganizations.organizationId, run.organizationId), eq(users.id, approverUserId)))
    .limit(1);

  if (!approver) {
    return Response.json({ error: "That approver is not a member of this payroll workspace." }, { status: 403 });
  }

  const entryRows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));
  if (!entryRows.length) {
    return Response.json({ error: "Calculate the payroll before submitting it for approval." }, { status: 409 });
  }

  const staff = await db.select().from(employees).where(eq(employees.organizationId, run.organizationId));
  const parallel = await db.select().from(parallelPayrollRows).where(eq(parallelPayrollRows.payrollRunId, runId));
  const audit = auditPayrollControl({
    entries: entryRows,
    employees: staff,
    parallelRows: parallel.map((row) => ({
      employeeNo: row.employeeNo,
      name: row.employeeName ?? undefined,
      netPay: Number(row.netPay),
      withholdingTax: row.withholdingTax == null ? null : Number(row.withholdingTax),
    })),
  });
  if (audit.readiness.highCount > 0) {
    return Response.json({
      error: `Resolve ${audit.readiness.highCount} blocking Payroll Control Center issue(s) before submitting for approval.`,
      blockingIssues: audit.issues.filter((issue) => issue.severity === "high"),
    }, { status: 409 });
  }

  const title = `Payroll approval · ${run.periodLabel}`;
  const existing = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, run.organizationId));
  const current = existing.find((task) => task.title === title && task.status === "Pending");
  if (current) {
    return Response.json({ error: `This payroll is already waiting for ${current.approver}.`, task: current }, { status: 409 });
  }

  const [task] = await db
    .insert(approvalTasks)
    .values({
      organizationId: run.organizationId,
      title,
      detail: `Payroll run #${run.id} · ${entryRows.length} employees · ${run.exceptions} engine exception(s)`,
      approver: approver.name,
      dueLabel: "Due before release",
      priority: "High",
      status: "Pending",
    })
    .returning();

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Payroll submitted for approval",
    resource: run.periodLabel,
    metadata: {
      runId: run.id,
      taskId: task.id,
      makerUserId: user.id,
      approverUserId: approver.userId,
      approver: approver.name,
      ruleVersion: run.ruleVersion,
    },
  });

  return Response.json({ task, maker: user.name, approver }, { status: 201 });
}
