import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLoans,
  employees,
  governmentLoanRemittanceBatches,
  governmentLoanRemittanceMembers,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { resolveComplianceLegalEntity } from "@/lib/legal-entity";
import {
  buildGovernmentLoanRemittanceSnapshot,
  canConfirmGovernmentLoanPosting,
  canRecordGovernmentLoanRemittance,
  governmentLoanRemittanceDueDate,
  type GovernmentLoanAgency,
} from "@/lib/government-loan-remittance";
import { currentManilaMonth } from "@/lib/statutory-remittance-state";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const AGENCIES = new Set<GovernmentLoanAgency>(["SSS", "Pag-IBIG"]);

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!access.companyWide) {
    return Response.json({
      error: "Government loan remittance reconciliation is company-wide and is not available to unit-scoped users.",
    }, { status: 403 });
  }
  if (!roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only authorized payroll operators can manage government loan remittance reconciliation.",
      role: access.role,
    }, { status: 403 });
  }
  return null;
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

  let legalEntity;
  try {
    legalEntity = await resolveComplianceLegalEntity({ organizationId, legalEntityId: requestedLegalEntityId || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Legal employer could not be resolved." }, { status: 409 });
  }

  const batches = await db.select().from(governmentLoanRemittanceBatches)
    .where(and(
      eq(governmentLoanRemittanceBatches.organizationId, organizationId),
      eq(governmentLoanRemittanceBatches.legalEntityId, legalEntity.id),
    ))
    .orderBy(asc(governmentLoanRemittanceBatches.applicableMonth), asc(governmentLoanRemittanceBatches.agency));
  const batchIds = batches.map((batch) => batch.id);
  const members = batchIds.length
    ? await db.select().from(governmentLoanRemittanceMembers)
        .where(inArray(governmentLoanRemittanceMembers.batchId, batchIds))
        .orderBy(asc(governmentLoanRemittanceMembers.batchId), asc(governmentLoanRemittanceMembers.employeeNo))
    : [];

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return Response.json({
    today,
    legalEntity: { id: legalEntity.id, code: legalEntity.code, displayName: legalEntity.displayName },
    batches: batches.map((batch) => ({
      ...batch,
      displayStatus:
        batch.status === "open" && String(batch.dueDate) < today
          ? "overdue"
          : batch.status,
      pendingPostingCount: members.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "pending",
      ).length,
      exceptionCount: members.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "exception",
      ).length,
    })),
    members,
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
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `government-loan-remittance-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_batch") {
    const agency = String(body.agency ?? "") as GovernmentLoanAgency;
    const applicableMonth = String(body.applicableMonth ?? "").trim();
    if (!AGENCIES.has(agency) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
      return Response.json({ error: "agency and applicableMonth (YYYY-MM) are required." }, { status: 400 });
    }
    if (applicableMonth >= currentManilaMonth()) {
      return Response.json({
        error: "Government loan remittance can only be opened after the applicable payroll month has closed.",
      }, { status: 409 });
    }

    const [existing] = await db.select({ id: governmentLoanRemittanceBatches.id })
      .from(governmentLoanRemittanceBatches)
      .where(and(
        eq(governmentLoanRemittanceBatches.organizationId, organizationId),
        eq(governmentLoanRemittanceBatches.legalEntityId, legalEntity.id),
        eq(governmentLoanRemittanceBatches.agency, agency),
        eq(governmentLoanRemittanceBatches.applicableMonth, applicableMonth),
      )).limit(1);
    if (existing) {
      return Response.json({ error: "A government loan remittance batch already exists for this agency and month." }, { status: 409 });
    }

    const start = monthStart(applicableMonth);
    const end = monthEnd(applicableMonth);
    const monthRuns = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.legalEntityId, legalEntity.id),
      gte(payrollRuns.periodEnd, start),
      lte(payrollRuns.periodEnd, end),
    ));
    if (monthRuns.length === 0) {
      return Response.json({ error: "No payroll runs exist for this applicable month." }, { status: 409 });
    }
    const notReleased = monthRuns.filter((run) => run.status !== "Released");
    if (notReleased.length > 0) {
      return Response.json({
        error: `All payroll runs for ${applicableMonth} must be Released before government loan remittance is snapshotted. Run #${notReleased[0].id} is ${notReleased[0].status}.`,
      }, { status: 409 });
    }

    const runIds = monthRuns.map((run) => run.id);
    const entries = await db.select({
      employeeId: payrollEntries.employeeId,
      lineItems: payrollEntries.lineItems,
    }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds));

    const loans = await db.select({
      id: employeeLoans.id,
      employeeId: employeeLoans.employeeId,
      employeeNo: employees.employeeNo,
      loanType: employeeLoans.loanType,
      referenceNo: employeeLoans.referenceNo,
    })
      .from(employeeLoans)
      .innerJoin(employees, eq(employeeLoans.employeeId, employees.id))
      .where(and(
        eq(employeeLoans.organizationId, organizationId),
        eq(employees.legalEntityId, legalEntity.id),
      ));

    const snapshot = buildGovernmentLoanRemittanceSnapshot({
      agency,
      applicableMonth,
      entries,
      loans,
    });
    if (snapshot.loanCount === 0 || snapshot.expectedTotal <= 0) {
      return Response.json({
        error: `Released payroll has no positive ${agency} loan deductions for this month.`,
      }, { status: 409 });
    }

    const dueDate = governmentLoanRemittanceDueDate(agency, applicableMonth);
    const created = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(governmentLoanRemittanceBatches).values({
        organizationId,
        legalEntityId: legalEntity.id,
        agency,
        applicableMonth,
        dueDate,
        status: "open",
        employeeCount: snapshot.employeeCount,
        loanCount: snapshot.loanCount,
        expectedTotal: snapshot.expectedTotal.toFixed(2),
        snapshotHash: snapshot.snapshotHash,
        createdBy: user.name,
      }).returning();

      await tx.insert(governmentLoanRemittanceMembers).values(
        snapshot.members.map((member) => ({
          batchId: batch.id,
          organizationId,
          legalEntityId: legalEntity.id,
          loanId: member.loanId,
          employeeId: member.employeeId,
          employeeNo: member.employeeNo,
          loanType: member.loanType,
          loanReferenceNo: member.loanReferenceNo,
          deductedAmount: member.deductedAmount.toFixed(2),
          postingStatus: "pending",
        })),
      );
      return batch;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Government loan remittance liability snapshotted",
      resource: `${agency} loans · ${applicableMonth}`,
      metadata: {
        batchId: created.id,
        legalEntityId: legalEntity.id,
        legalEntityCode: legalEntity.code,
        employeeCount: snapshot.employeeCount,
        loanCount: snapshot.loanCount,
        expectedTotal: snapshot.expectedTotal,
        dueDate,
        snapshotHash: snapshot.snapshotHash,
        payrollRunIds: runIds,
      },
    });

    return Response.json({ batch: created }, { status: 201 });
  }

  if (action === "record_payment") {
    const batchId = Number(body.batchId);
    const amountPaid = Number(body.amountPaid);
    const paymentReference = String(body.paymentReference ?? "").trim();
    const agencyAcknowledgementReference = String(body.agencyAcknowledgementReference ?? "").trim();
    const paymentVarianceNote = String(body.paymentVarianceNote ?? "").trim().slice(0, 240) || null;
    const paidAt = body.paidAt ? new Date(String(body.paidAt)) : new Date();

    const [batch] = await db.select().from(governmentLoanRemittanceBatches).where(and(
      eq(governmentLoanRemittanceBatches.id, batchId),
      eq(governmentLoanRemittanceBatches.organizationId, organizationId),
      eq(governmentLoanRemittanceBatches.legalEntityId, legalEntity.id),
    )).limit(1);
    if (!batch) return Response.json({ error: "Government loan remittance batch not found." }, { status: 404 });
    if (batch.status !== "open") {
      return Response.json({
        error: "Loan remittance payment evidence is immutable once recorded.",
      }, { status: 409 });
    }
    if (!Number.isFinite(paidAt.getTime())) {
      return Response.json({ error: "paidAt must be a valid date-time." }, { status: 400 });
    }

    const gate = canRecordGovernmentLoanRemittance({
      expectedTotal: Number(batch.expectedTotal),
      amountPaid,
      paymentReference,
      agencyAcknowledgementReference,
      paymentVarianceNote: paymentVarianceNote ?? undefined,
    });
    if (!gate.ok) return Response.json({ error: gate.error }, { status: 409 });

    const [updated] = await db.update(governmentLoanRemittanceBatches).set({
      status: "paid",
      amountPaid: amountPaid.toFixed(2),
      paymentReference,
      agencyAcknowledgementReference,
      paymentVarianceNote,
      paidAt,
      paymentRecordedBy: user.name,
      updatedAt: new Date(),
    }).where(and(
      eq(governmentLoanRemittanceBatches.id, batchId),
      eq(governmentLoanRemittanceBatches.organizationId, organizationId),
      eq(governmentLoanRemittanceBatches.legalEntityId, legalEntity.id),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Government loan remittance payment recorded",
      resource: `${batch.agency} loans · ${batch.applicableMonth}`,
      metadata: {
        batchId,
        expectedTotal: Number(batch.expectedTotal),
        amountPaid,
        paymentReference,
        agencyAcknowledgementReference,
        paymentVarianceNote,
        paidAt: paidAt.toISOString(),
      },
    });
    return Response.json({ batch: updated });
  }

  if (action === "confirm_member_posting" || action === "mark_member_exception") {
    const memberId = Number(body.memberId);
    const [member] = await db.select().from(governmentLoanRemittanceMembers).where(and(
      eq(governmentLoanRemittanceMembers.id, memberId),
      eq(governmentLoanRemittanceMembers.organizationId, organizationId),
      eq(governmentLoanRemittanceMembers.legalEntityId, legalEntity.id),
    )).limit(1);
    if (!member) return Response.json({ error: "Government loan remittance member not found." }, { status: 404 });

    const [batch] = await db.select().from(governmentLoanRemittanceBatches).where(and(
      eq(governmentLoanRemittanceBatches.id, member.batchId),
      eq(governmentLoanRemittanceBatches.organizationId, organizationId),
      eq(governmentLoanRemittanceBatches.legalEntityId, legalEntity.id),
    )).limit(1);
    if (!batch) return Response.json({ error: "Government loan remittance batch not found." }, { status: 404 });
    if (member.postingStatus === "confirmed") {
      return Response.json({ error: "Confirmed government loan posting evidence is immutable." }, { status: 409 });
    }
    if (batch.status === "open") {
      return Response.json({ error: "Record agency payment before confirming loan posting." }, { status: 409 });
    }
    if (batch.status === "reconciled") {
      return Response.json({ error: "A reconciled government loan remittance batch is immutable." }, { status: 409 });
    }

    if (action === "mark_member_exception") {
      const exceptionNote = String(body.exceptionNote ?? "").trim();
      if (exceptionNote.length < 4) {
        return Response.json({ error: "Explain the government loan posting exception." }, { status: 400 });
      }
      const [updatedMember] = await db.update(governmentLoanRemittanceMembers).set({
        postingStatus: "exception",
        postedAmount: null,
        postingReference: null,
        postedAt: null,
        confirmedBy: user.name,
        exceptionNote,
        updatedAt: new Date(),
      }).where(eq(governmentLoanRemittanceMembers.id, member.id)).returning();

      await db.update(governmentLoanRemittanceBatches).set({
        status: "exception",
        updatedAt: new Date(),
      }).where(eq(governmentLoanRemittanceBatches.id, batch.id));

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Government loan posting exception recorded",
        resource: `${batch.agency} · ${member.employeeNo} · ${member.loanReferenceNo}`,
        metadata: { batchId: batch.id, memberId: member.id, loanId: member.loanId, exceptionNote },
      });
      return Response.json({ member: updatedMember });
    }

    const postedAmount = Number(body.postedAmount);
    const postingReference = String(body.postingReference ?? "").trim();
    const postedAt = body.postedAt ? new Date(String(body.postedAt)) : new Date();
    if (!Number.isFinite(postedAt.getTime())) {
      return Response.json({ error: "A valid agency posting date is required." }, { status: 400 });
    }
    const postingGate = canConfirmGovernmentLoanPosting({
      expectedAmount: Number(member.deductedAmount),
      postedAmount,
      postingReference,
    });
    if (!postingGate.ok) return Response.json({ error: postingGate.error }, { status: 409 });

    const [updatedMember] = await db.update(governmentLoanRemittanceMembers).set({
      postingStatus: "confirmed",
      postedAmount: postedAmount.toFixed(2),
      postingReference,
      postedAt,
      confirmedBy: user.name,
      exceptionNote: null,
      updatedAt: new Date(),
    }).where(eq(governmentLoanRemittanceMembers.id, member.id)).returning();

    const pending = await db.select({ id: governmentLoanRemittanceMembers.id })
      .from(governmentLoanRemittanceMembers)
      .where(and(
        eq(governmentLoanRemittanceMembers.batchId, batch.id),
        eq(governmentLoanRemittanceMembers.postingStatus, "pending"),
      ));
    const exceptions = await db.select({ id: governmentLoanRemittanceMembers.id })
      .from(governmentLoanRemittanceMembers)
      .where(and(
        eq(governmentLoanRemittanceMembers.batchId, batch.id),
        eq(governmentLoanRemittanceMembers.postingStatus, "exception"),
      ));

    if (pending.length === 0 && exceptions.length === 0 && Number(batch.amountPaid ?? 0) + 0.01 >= Number(batch.expectedTotal)) {
      await db.update(governmentLoanRemittanceBatches).set({
        status: "reconciled",
        updatedAt: new Date(),
      }).where(eq(governmentLoanRemittanceBatches.id, batch.id));
    } else if (batch.status === "exception" && exceptions.length === 0) {
      await db.update(governmentLoanRemittanceBatches).set({
        status: "paid",
        updatedAt: new Date(),
      }).where(eq(governmentLoanRemittanceBatches.id, batch.id));
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Government loan posting confirmed",
      resource: `${batch.agency} · ${member.employeeNo} · ${member.loanReferenceNo}`,
      metadata: {
        batchId: batch.id,
        memberId: member.id,
        loanId: member.loanId,
        deductedAmount: Number(member.deductedAmount),
        postedAmount,
        postingReference,
        postedAt: postedAt.toISOString(),
      },
    });
    return Response.json({ member: updatedMember });
  }

  return Response.json({
    error: "Unsupported action. Use create_batch, record_payment, confirm_member_posting, or mark_member_exception.",
  }, { status: 400 });
}
