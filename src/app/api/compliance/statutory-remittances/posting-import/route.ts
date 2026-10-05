import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { statutoryRemittanceBatches, statutoryRemittanceMembers } from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { canConfirmMemberPosting } from "@/lib/statutory-remittance";
import {
  parseStatutoryPostingCsv,
  STATUTORY_POSTING_TEMPLATE,
} from "@/lib/statutory-posting-import";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only company-wide payroll operators can import statutory posting evidence.",
    }, { status: 403 });
  }
  return null;
}

export async function GET() {
  return new Response(STATUTORY_POSTING_TEMPLATE + "\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="statutory-posting-template.csv"',
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const batchId = Number(body.batchId);
  const csv = typeof body.csv === "string" ? body.csv : "";
  const fileName = String(body.fileName ?? "posting-evidence.csv").slice(0, 200);
  const dryRun = Boolean(body.dryRun);

  if (!Number.isInteger(organizationId) || !Number.isInteger(batchId) || !csv.trim()) {
    return Response.json({
      error: "organizationId, batchId and csv content are required.",
    }, { status: 400 });
  }
  if (Buffer.byteLength(csv, "utf8") > 2 * 1024 * 1024) {
    return Response.json({ error: "Posting evidence CSV exceeds the 2 MB limit." }, { status: 413 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "statutory-posting-import",
    resourceId: organizationId,
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
    eq(statutoryRemittanceBatches.id, batchId),
    eq(statutoryRemittanceBatches.organizationId, organizationId),
  )).limit(1);
  if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });
  if (batch.status === "open") {
    return Response.json({
      error: "Record the agency payment before importing member posting evidence.",
    }, { status: 409 });
  }
  if (batch.status === "reconciled") {
    return Response.json({
      error: "A reconciled remittance batch is immutable.",
    }, { status: 409 });
  }

  const parsed = parseStatutoryPostingCsv(csv);
  const members = await db.select().from(statutoryRemittanceMembers).where(and(
    eq(statutoryRemittanceMembers.batchId, batchId),
    eq(statutoryRemittanceMembers.organizationId, organizationId),
  ));
  const byEmployeeNo = new Map(members.map((member) => [member.employeeNo, member]));

  const errors = [...parsed.errors];
  const matched: Array<{
    member: typeof members[number];
    postedAmount: number;
    postingReference: string;
    postedAt: Date;
  }> = [];

  parsed.valid.forEach((row, index) => {
    const line = index + 2;
    const member = byEmployeeNo.get(row.employeeNo);
    if (!member) {
      errors.push({ line, problems: [`Employee "${row.employeeNo}" is not part of this remittance batch.`] });
      return;
    }
    if (member.postingStatus === "confirmed") {
      errors.push({ line, problems: [`Employee "${row.employeeNo}" already has immutable confirmed posting evidence.`] });
      return;
    }

    const gate = canConfirmMemberPosting({
      expectedTotal: Number(member.totalContribution),
      postedAmount: row.postedAmount,
      postingReference: row.postingReference,
    });
    if (!gate.ok) {
      errors.push({ line, problems: [gate.error] });
      return;
    }

    matched.push({
      member,
      postedAmount: row.postedAmount,
      postingReference: row.postingReference,
      postedAt: new Date(row.postedAt),
    });
  });

  if (errors.length > 0) {
    return Response.json({
      dryRun,
      fileName,
      batchId,
      fileHash: parsed.hash,
      validRows: matched.length,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      unmappedColumns: parsed.unmapped,
      applied: false,
      message: "No posting rows were applied because the file did not pass full validation.",
    }, { status: 422 });
  }

  if (matched.length === 0) {
    return Response.json({
      error: "No valid posting rows were found.",
      dryRun,
      batchId,
      fileHash: parsed.hash,
    }, { status: 422 });
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      fileName,
      batchId,
      fileHash: parsed.hash,
      validRows: matched.length,
      errorCount: 0,
      errors: [],
      unmappedColumns: parsed.unmapped,
      applied: false,
      message: `${matched.length} posting row${matched.length === 1 ? "" : "s"} validated. Nothing was changed.`,
    });
  }

  const result = await db.transaction(async (tx) => {
    for (const row of matched) {
      await tx.update(statutoryRemittanceMembers).set({
        postingStatus: "confirmed",
        postingReference: row.postingReference,
        postedAmount: row.postedAmount.toFixed(2),
        postedAt: row.postedAt,
        confirmedBy: user.name,
        exceptionNote: null,
        updatedAt: new Date(),
      }).where(and(
        eq(statutoryRemittanceMembers.id, row.member.id),
        eq(statutoryRemittanceMembers.organizationId, organizationId),
      ));
    }

    const refreshed = await tx.select({
      postingStatus: statutoryRemittanceMembers.postingStatus,
    }).from(statutoryRemittanceMembers).where(and(
      eq(statutoryRemittanceMembers.batchId, batchId),
      eq(statutoryRemittanceMembers.organizationId, organizationId),
    ));
    const pending = refreshed.filter((row) => row.postingStatus === "pending").length;
    const exceptions = refreshed.filter((row) => row.postingStatus === "exception").length;
    const reconciled = pending === 0 && exceptions === 0;

    await tx.update(statutoryRemittanceBatches).set({
      status: reconciled ? "reconciled" : exceptions > 0 ? "exception" : "paid",
      reconciledAt: reconciled ? new Date() : null,
      reconciledBy: reconciled ? user.name : null,
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    ));

    return { pending, exceptions, reconciled };
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Statutory member posting evidence imported",
    resource: `${batch.agency} · ${batch.applicableMonth}`,
    metadata: {
      batchId,
      fileName,
      fileHash: parsed.hash,
      importedRows: matched.length,
      pendingPostingCount: result.pending,
      exceptionCount: result.exceptions,
      reconciled: result.reconciled,
      employeeIds: matched.map((row) => row.member.employeeId),
    },
  });

  return Response.json({
    dryRun: false,
    fileName,
    batchId,
    fileHash: parsed.hash,
    validRows: matched.length,
    errorCount: 0,
    errors: [],
    unmappedColumns: parsed.unmapped,
    applied: true,
    reconciled: result.reconciled,
    pendingPostingCount: result.pending,
    exceptionCount: result.exceptions,
    message: `${matched.length} posting row${matched.length === 1 ? "" : "s"} applied.`,
  });
}
