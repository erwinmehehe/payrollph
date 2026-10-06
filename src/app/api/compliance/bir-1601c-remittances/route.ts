import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  birWithholdingRemittanceBatches,
  governmentFilingValidations,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { resolveComplianceLegalEntity } from "@/lib/legal-entity";
import {
  bir1601cDeadlines,
  buildBir1601cRemittanceSnapshot,
  canRecordBir1601cPayment,
  compareBir1601cFiling,
  type Bir1601CFilingChannel,
  type BirEfpsGroup,
} from "@/lib/bir-1601c-remittance";
import { BIR_1601C_GENERATOR_VERSION } from "@/lib/filing-evidence";
import { currentManilaMonth } from "@/lib/statutory-remittance-state";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  if (!access.companyWide) {
    return Response.json({
      error: "BIR 1601-C reconciliation is company-wide and is not available to unit-scoped users.",
    }, { status: 403 });
  }
  if (!roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only authorized payroll operators can manage BIR 1601-C reconciliation.",
      role: access.role,
    }, { status: 403 });
  }
  return null;
}

async function acceptedFilingForMonth(organizationId: number, legalEntityId: number, applicableMonth: string) {
  const [row] = await db.select().from(governmentFilingValidations)
    .where(and(
      eq(governmentFilingValidations.organizationId, organizationId),
      eq(governmentFilingValidations.legalEntityId, legalEntityId),
      eq(governmentFilingValidations.agency, "BIR"),
      eq(governmentFilingValidations.form, "1601-C"),
      eq(governmentFilingValidations.applicableMonth, applicableMonth),
      eq(governmentFilingValidations.status, "accepted"),
      eq(governmentFilingValidations.generatorVersion, BIR_1601C_GENERATOR_VERSION),
    ))
    .orderBy(desc(governmentFilingValidations.submittedAt), desc(governmentFilingValidations.id))
    .limit(1);
  return row ?? null;
}

function filingCheck(
  batch: typeof birWithholdingRemittanceBatches.$inferSelect,
  filing: typeof governmentFilingValidations.$inferSelect | null,
) {
  if (!filing) {
    return {
      state: "missing" as const,
      matched: false,
      message: "No accepted current-version BIR 1601-C filing evidence is recorded for this month.",
      filing: null,
      comparison: null,
    };
  }
  if (filing.reportedTotal == null || filing.employeeCount == null) {
    return {
      state: "metadata_missing" as const,
      matched: false,
      message: "The accepted filing predates BIR snapshot metadata. Regenerate the same filing record to backfill its total and employee count.",
      filing,
      comparison: null,
    };
  }
  const comparison = compareBir1601cFiling({
    expectedTaxWithheld: Number(batch.expectedTaxWithheld),
    expectedEmployeeCount: batch.employeeCount,
    reportedTotal: Number(filing.reportedTotal),
    reportedEmployeeCount: filing.employeeCount,
  });
  return {
    state: comparison.matched ? "matched" as const : "mismatch" as const,
    matched: comparison.matched,
    message: comparison.matched
      ? "Accepted BIR filing matches the released-payroll withholding snapshot."
      : "Accepted BIR filing does not match the released-payroll withholding snapshot.",
    filing,
    comparison,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const requestedLegalEntityId = Number(url.searchParams.get("legalEntityId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;
  let legalEntity;
  try {
    legalEntity = await resolveComplianceLegalEntity({
      organizationId,
      legalEntityId: requestedLegalEntityId || null,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Legal employer could not be resolved.",
    }, { status: 409 });
  }


  const batches = await db.select().from(birWithholdingRemittanceBatches)
    .where(and(
      eq(birWithholdingRemittanceBatches.organizationId, organizationId),
      eq(birWithholdingRemittanceBatches.legalEntityId, legalEntity.id),
    ))
    .orderBy(desc(birWithholdingRemittanceBatches.applicableMonth), desc(birWithholdingRemittanceBatches.id));

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const withChecks = [];
  for (const batch of batches) {
    const filing = await acceptedFilingForMonth(organizationId, legalEntity.id, batch.applicableMonth);
    withChecks.push({
      ...batch,
      displayStatus:
        batch.status === "open" && String(batch.paymentDueDate) < today
          ? "overdue"
          : batch.status,
      filingCheck: filingCheck(batch, filing),
    });
  }

  return Response.json({
    today,
    legalEntity: { id: legalEntity.id, code: legalEntity.code, displayName: legalEntity.displayName },
    batches: withChecks,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const requestedLegalEntityId = Number(body.legalEntityId ?? 0);
  const action = String(body.action ?? "").trim();
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;
  let legalEntity;
  try {
    legalEntity = await resolveComplianceLegalEntity({
      organizationId,
      legalEntityId: requestedLegalEntityId || null,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Legal employer could not be resolved.",
    }, { status: 409 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `bir-1601c-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_batch") {
    const applicableMonth = String(body.applicableMonth ?? "").trim();
    const filingChannel = String(body.filingChannel ?? "") as Bir1601CFilingChannel;
    const efpsGroup = body.efpsGroup == null || body.efpsGroup === ""
      ? null
      : String(body.efpsGroup).toUpperCase() as BirEfpsGroup;

    if (
      !/^\d{4}-\d{2}$/.test(applicableMonth)
      || !["non_efps", "efps"].includes(filingChannel)
    ) {
      return Response.json({
        error: "applicableMonth (YYYY-MM) and filingChannel (non_efps or efps) are required.",
      }, { status: 400 });
    }
    if (applicableMonth >= currentManilaMonth()) {
      return Response.json({
        error: "BIR 1601-C reconciliation can only be opened after the applicable payroll month has closed.",
      }, { status: 409 });
    }

    let deadlines: ReturnType<typeof bir1601cDeadlines>;
    try {
      deadlines = bir1601cDeadlines({ applicableMonth, filingChannel, efpsGroup });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Could not determine BIR 1601-C deadlines.",
      }, { status: 422 });
    }

    const [existing] = await db.select({ id: birWithholdingRemittanceBatches.id })
      .from(birWithholdingRemittanceBatches)
      .where(and(
        eq(birWithholdingRemittanceBatches.organizationId, organizationId),
        eq(birWithholdingRemittanceBatches.legalEntityId, legalEntity.id),
        eq(birWithholdingRemittanceBatches.applicableMonth, applicableMonth),
      ))
      .limit(1);
    if (existing) {
      return Response.json({ error: "A BIR 1601-C reconciliation batch already exists for this month." }, { status: 409 });
    }

    const start = monthStart(applicableMonth);
    const end = monthEnd(applicableMonth);
    const monthRuns = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.legalEntityId, legalEntity.id),
      gte(payrollRuns.payDate, start),
      lte(payrollRuns.payDate, end),
    ));
    if (monthRuns.length === 0) {
      return Response.json({ error: "No payroll runs were paid in this applicable month." }, { status: 409 });
    }
    const notReleased = monthRuns.filter((run) => run.status !== "Released");
    if (notReleased.length > 0) {
      return Response.json({
        error: `All payroll runs paid in ${applicableMonth} must be Released before BIR withholding is snapshotted. Run #${notReleased[0].id} is ${notReleased[0].status}.`,
      }, { status: 409 });
    }

    const runIds = monthRuns.map((run) => run.id);
    const entries = await db.select({
      employeeId: payrollEntries.employeeId,
      lineItems: payrollEntries.lineItems,
    }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds));

    if (entries.length === 0) {
      return Response.json({ error: "Released payroll has no employee entries for this month." }, { status: 409 });
    }

    const snapshot = buildBir1601cRemittanceSnapshot({
      applicableMonth,
      entries,
      payrollRunCount: monthRuns.length,
    });

    const [created] = await db.insert(birWithholdingRemittanceBatches).values({
      organizationId,
      legalEntityId: legalEntity.id,
      applicableMonth,
      filingChannel,
      efpsGroup: filingChannel === "efps" ? efpsGroup : null,
      filingDueDate: deadlines.filingDueDate,
      paymentDueDate: deadlines.paymentDueDate,
      status: "open",
      employeeCount: snapshot.employeeCount,
      payrollRunCount: snapshot.payrollRunCount,
      expectedTaxWithheld: snapshot.expectedTaxWithheld.toFixed(2),
      snapshotHash: snapshot.snapshotHash,
      createdBy: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "BIR 1601-C withholding liability snapshotted",
      resource: applicableMonth,
      metadata: {
        batchId: created.id,
        legalEntityId: legalEntity.id,
        legalEntityCode: legalEntity.code,
        filingChannel,
        efpsGroup: created.efpsGroup,
        filingDueDate: deadlines.filingDueDate,
        paymentDueDate: deadlines.paymentDueDate,
        employeeCount: snapshot.employeeCount,
        payrollRunCount: snapshot.payrollRunCount,
        expectedTaxWithheld: snapshot.expectedTaxWithheld,
        payrollRunIds: runIds,
        snapshotHash: snapshot.snapshotHash,
      },
    });

    return Response.json({ batch: created }, { status: 201 });
  }

  if (action === "record_payment") {
    const batchId = Number(body.batchId);
    const amountPaid = Number(body.amountPaid);
    const paymentReference = String(body.paymentReference ?? "").trim();
    const paymentVarianceNote = String(body.paymentVarianceNote ?? "").trim().slice(0, 240) || null;
    const paidAt = body.paidAt ? new Date(String(body.paidAt)) : new Date();

    const [batch] = await db.select().from(birWithholdingRemittanceBatches).where(and(
      eq(birWithholdingRemittanceBatches.id, batchId),
      eq(birWithholdingRemittanceBatches.organizationId, organizationId),
      eq(birWithholdingRemittanceBatches.legalEntityId, legalEntity.id),
    )).limit(1);
    if (!batch) return Response.json({ error: "BIR 1601-C reconciliation batch not found." }, { status: 404 });
    if (batch.status !== "open") {
      return Response.json({
        error: "BIR 1601-C payment evidence is immutable once reconciled.",
      }, { status: 409 });
    }
    if (!Number.isFinite(paidAt.getTime())) {
      return Response.json({ error: "paidAt must be a valid date-time." }, { status: 400 });
    }

    const filing = await acceptedFilingForMonth(organizationId, legalEntity.id, batch.applicableMonth);
    const check = filingCheck(batch, filing);
    if (!check.matched || !filing) {
      return Response.json({
        error: check.message,
        filingCheck: check,
      }, { status: 409 });
    }

    const gate = canRecordBir1601cPayment({
      expectedTaxWithheld: Math.max(0, Number(batch.expectedTaxWithheld)),
      amountPaid,
      paymentReference,
      paymentVarianceNote: paymentVarianceNote ?? undefined,
    });
    if (!gate.ok) return Response.json({ error: gate.error }, { status: 409 });

    const [updated] = await db.update(birWithholdingRemittanceBatches).set({
      status: "reconciled",
      amountPaid: amountPaid.toFixed(2),
      paymentReference: paymentReference || null,
      paymentVarianceNote,
      paidAt,
      paymentRecordedByUserId: user.id,
      paymentRecordedBy: user.name,
      filingValidationId: filing.id,
      filingReference: filing.agencyReference,
      filedAt: filing.submittedAt,
      updatedAt: new Date(),
    }).where(and(
      eq(birWithholdingRemittanceBatches.id, batchId),
      eq(birWithholdingRemittanceBatches.organizationId, organizationId),
      eq(birWithholdingRemittanceBatches.status, "open"),
    )).returning();

    if (!updated) {
      return Response.json({ error: "BIR 1601-C reconciliation changed before payment evidence was recorded." }, { status: 409 });
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "BIR 1601-C filing and payment reconciled",
      resource: batch.applicableMonth,
      metadata: {
        batchId,
        filingValidationId: filing.id,
        filingReference: filing.agencyReference,
        filedAt: filing.submittedAt,
        expectedTaxWithheld: Number(batch.expectedTaxWithheld),
        filingReportedTotal: Number(filing.reportedTotal),
        employeeCount: batch.employeeCount,
        amountPaid,
        paymentReference: paymentReference || null,
        paymentVarianceNote,
        paidAt: paidAt.toISOString(),
      },
    });

    return Response.json({ batch: updated });
  }

  return Response.json({
    error: "Unsupported action. Use create_batch or record_payment.",
  }, { status: 400 });
}
