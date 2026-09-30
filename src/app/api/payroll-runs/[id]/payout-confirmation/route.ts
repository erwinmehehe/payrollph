import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PAYROLL_DISBURSEMENT_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

function metadataOf(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function belongsToRun(metadata: unknown, runId: number) {
  return Number(metadataOf(metadata).runId ?? 0) === runId;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_DISBURSEMENT_ROLES,
    "Only the workspace owner can confirm an external bank submission.",
  );
  if (denied) return denied;

  if (run.status !== "Released") {
    return Response.json({
      error: `Bank submission can be recorded only after payroll release (currently ${run.status}).`,
    }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.confirm !== true) {
    return Response.json({
      error: "Explicit confirmation is required after the bank file has actually been uploaded.",
    }, { status: 400 });
  }

  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organizationId, run.organizationId));

  const runEvents = events.filter((event) => belongsToRun(event.metadata, run.id));
  const providerDisbursement = runEvents.find((event) => event.action === "Payroll disbursed via PayMongo");
  if (providerDisbursement) {
    return Response.json({
      status: "disbursed",
      message: "This payroll already has a provider disbursement recorded.",
      settlementVerified: true,
    });
  }

  const finalBankExport = runEvents.find((event) => event.action === "bank export generated");
  if (!finalBankExport) {
    return Response.json({
      error: "Generate the final bank file for this exact payroll run before recording an external bank upload.",
    }, { status: 409 });
  }

  const existing = runEvents.find((event) => event.action === "Payroll bank upload confirmed");
  if (existing) {
    return Response.json({
      status: "submitted",
      message: "This payroll already has an external bank upload confirmation.",
      settlementVerified: false,
    });
  }

  const reference =
    typeof body.reference === "string" && body.reference.trim()
      ? body.reference.trim().slice(0, 120)
      : null;

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Payroll bank upload confirmed",
    resource: run.periodLabel,
    metadata: {
      runId: run.id,
      method: "Manual bank portal upload",
      reference,
      sourceExportEventId: finalBankExport.id,
      settlementVerified: false,
    },
  });

  return Response.json({
    status: "submitted",
    message: "Bank upload recorded. Linaw has proof of submission, but final bank settlement is not independently verified.",
    settlementVerified: false,
  });
}
