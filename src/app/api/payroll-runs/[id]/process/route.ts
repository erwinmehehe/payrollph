import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { drainPayrollQueue, enqueuePayrollRun } from "@/lib/payroll-engine";
import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can calculate payroll.",
  );
  if (deniedOrg) return deniedOrg;

  if (run.status === "Released" || run.status === "Releasing") {
    return Response.json({ error: "Released or releasing payroll is immutable and cannot be recalculated." }, { status: 409 });
  }

  const approvalRows = await db
    .select()
    .from(approvalTasks)
    .where(eq(approvalTasks.organizationId, run.organizationId));
  const linkedApprovals = approvalRows.filter((task) => task.detail.includes(`Payroll run #${run.id}`));
  for (const task of linkedApprovals) {
    if (task.status !== "Pending" && task.status !== "Approved") continue;
    await db.update(approvalTasks)
      .set({ status: "Superseded", decidedBy: "System", decidedAt: new Date() })
      .where(eq(approvalTasks.id, task.id));
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
      approvalsSuperseded: linkedApprovals.filter((task) => task.status === "Pending" || task.status === "Approved").map((task) => task.id),
    },
  });

  return Response.json({ run: fresh, queue, processResult });
}
