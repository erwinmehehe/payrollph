import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { drainPayrollQueue, enqueuePayrollRun } from "@/lib/payroll-engine";
import { assertMembership, canOperatePayroll, getAccess } from "@/lib/access";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertMembership(user.id, run.organizationId);
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, run.organizationId);
  if (!canOperatePayroll(access)) {
    return Response.json({ error: "Payroll access requires an owner, admin, bookkeeper, or payroll role." }, { status: 403 });
  }
  if (run.status === "Released") {
    return Response.json({ error: "Released payroll cannot be recalculated." }, { status: 409 });
  }

  const approvalTitle = `Payroll approval · ${run.periodLabel}`;
  const approvals = await db
    .select()
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.organizationId, run.organizationId),
        eq(approvalTasks.title, approvalTitle),
        inArray(approvalTasks.status, ["Pending", "Approved"]),
      ),
    );
  const supersededApprovalIds = approvals.map((task) => task.id);
  if (supersededApprovalIds.length) {
    await db
      .update(approvalTasks)
      .set({ status: "Superseded" })
      .where(inArray(approvalTasks.id, supersededApprovalIds));
  }

  const queue = await enqueuePayrollRun(runId);
  const processResult = await drainPayrollQueue(50);
  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Payroll processing requested",
    resource: run.periodLabel,
    metadata: {
      runId,
      ruleVersion: "PH-2026.01",
      chunks: processResult.length,
      supersededApprovalIds,
    },
  });

  return Response.json({ run: fresh, queue, processResult });
}
