import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { drainPayrollQueue, enqueuePayrollRun, getPayrollJobStatus } from "@/lib/payroll-engine";
import { assertMembership, canOperatePayroll, getAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "0");
  const runId = Number(searchParams.get("runId") ?? "0");

  // Job-status and register lookups are resource-addressed, so they are checked
  // against the run's own organization rather than trusting the query string.
  if (runId > 0) {
    const [target] = await db.select({ organizationId: payrollRuns.organizationId })
      .from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
    if (!target) return Response.json({ error: "Payroll run not found" }, { status: 404 });
    const deniedJob = await assertMembership(sessionUser.id, target.organizationId);
    if (deniedJob) return deniedJob;
    const access = await getAccess(sessionUser.id, target.organizationId);
    if (!canOperatePayroll(access)) {
      return Response.json({ error: "Payroll access requires an owner, admin, bookkeeper, or payroll role." }, { status: 403 });
    }

    // The workspace loads one run's register at a time, so it asks for the run
    // it is actually showing instead of relying on the dashboard's single set.
    if (searchParams.get("include") === "entries") {
      const entries = await db.select().from(payrollEntries)
        .where(eq(payrollEntries.payrollRunId, runId))
        .orderBy(asc(payrollEntries.id));
      return Response.json({ runId, entries });
    }

    const status = await getPayrollJobStatus(runId);
    return Response.json(status);
  }

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required" }, { status: 400 });
  }

  const deniedRuns = await assertMembership(sessionUser.id, organizationId);
  if (deniedRuns) return deniedRuns;
  const access = await getAccess(sessionUser.id, organizationId);
  if (!canOperatePayroll(access)) {
    return Response.json({ error: "Payroll access requires an owner, admin, bookkeeper, or payroll role." }, { status: 403 });
  }

  const runs = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId))
    .orderBy(desc(payrollRuns.id));
  return Response.json({ runs });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const periodLabel = typeof body.periodLabel === "string" ? body.periodLabel.trim() : "";
  const scopeLabel = typeof body.scopeLabel === "string" ? body.scopeLabel.trim() : "";
  const processNow = body.processNow !== false;

  if (!Number.isInteger(organizationId) || !periodLabel || !scopeLabel) {
    return Response.json({ error: "Organization, period, and scope are required." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const actor = user.name;

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!canOperatePayroll(access)) {
    return Response.json({ error: "Payroll access requires an owner, admin, bookkeeper, or payroll role." }, { status: 403 });
  }

  const [run] = await db.insert(payrollRuns).values({
    organizationId,
    periodLabel,
    scopeLabel,
    status: "Draft",
    payDate: "2026-03-30",
    employeeCount: 0,
    grossPay: "0",
    netPay: "0",
    exceptions: 0,
    ruleVersion: "PH-2026.01",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor,
    action: "Payroll draft created",
    resource: periodLabel,
    metadata: { scope: scopeLabel, ruleVersion: "PH-2026.01" },
  });

  let queueMeta = null;
  let processResult = null;
  if (processNow) {
    queueMeta = await enqueuePayrollRun(run.id);
    processResult = await drainPayrollQueue(20);
  }

  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  return Response.json({ run: fresh, queue: queueMeta, processResult }, { status: 201 });
}
