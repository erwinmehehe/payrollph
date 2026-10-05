import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
  statutoryRemittancePaymentEvidence,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { currentManilaMonth, loadStatutoryRemittanceState } from "@/lib/statutory-remittance-state";
import { auditStatutoryContributionMonth } from "@/lib/statutory-contribution-assurance";
import {
  buildStatutoryRemittanceSnapshot,
  canConfirmMemberPosting,
  canMarkRemittancePaid,
  effectiveRemittanceDueDate,
  type StatutoryAgency,
} from "@/lib/statutory-remittance";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const AGENCIES = new Set<StatutoryAgency>(["SSS", "PhilHealth", "Pag-IBIG"]);

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
      error: "Statutory remittance reconciliation is company-wide and is not available to unit-scoped users.",
    }, { status: 403 });
  }
  if (!roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only authorized payroll operators can manage statutory remittance reconciliation.",
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
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  const state = await loadStatutoryRemittanceState(organizationId);
  if (!state) return Response.json({ error: "Organization not found." }, { status: 404 });

  return Response.json({
    today: state.today,
    batches: state.batches,
    members: state.members,
    coverageGaps: state.coverageGaps,
    alerts: state.alerts,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
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
    action: `statutory-remittance-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_batch") {
    const agency = String(body.agency ?? "") as StatutoryAgency;
    const applicableMonth = String(body.applicableMonth ?? "").trim();
    if (!AGENCIES.has(agency) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
      return Response.json({ error: "agency and applicableMonth (YYYY-MM) are required." }, { status: 400 });
    }
    if (applicableMonth >= currentManilaMonth()) {
      return Response.json({
        error: "Remittance reconciliation can only be opened after the applicable payroll month has closed.",
      }, { status: 409 });
    }

    const [existing] = await db.select({ id: statutoryRemittanceBatches.id })
      .from(statutoryRemittanceBatches)
      .where(and(
        eq(statutoryRemittanceBatches.organizationId, organizationId),
        eq(statutoryRemittanceBatches.agency, agency),
        eq(statutoryRemittanceBatches.applicableMonth, applicableMonth),
      )).limit(1);
    if (existing) {
      return Response.json({ error: "A remittance batch already exists for this agency and month." }, { status: 409 });
    }

    const start = monthStart(applicableMonth);
    const end = monthEnd(applicableMonth);
    const monthRuns = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      gte(payrollRuns.periodEnd, start),
      lte(payrollRuns.periodEnd, end),
    ));
    if (monthRuns.length === 0) {
      return Response.json({ error: "No payroll runs exist for this applicable month." }, { status: 409 });
    }
    const notReleased = monthRuns.filter((run) => run.status !== "Released");
    if (notReleased.length > 0) {
      return Response.json({
        error: `All payroll runs for ${applicableMonth} must be Released before remittance is snapshotted. Run #${notReleased[0].id} is ${notReleased[0].status}.`,
      }, { status: 409 });
    }

    const runIds = monthRuns.map((run) => run.id);
    const entries = await db.select({
      employeeId: payrollEntries.employeeId,
      grossPay: payrollEntries.grossPay,
      lineItems: payrollEntries.lineItems,
      trace: payrollEntries.trace,
    }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds));
    const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
    const employeeRows = employeeIds.length
      ? await db.select({
          id: employees.id,
          employeeNo: employees.employeeNo,
          sssNo: employees.sssNo,
          philHealthNo: employees.philHealthNo,
          pagIbigNo: employees.pagIbigNo,
        })
          .from(employees)
          .where(and(
            eq(employees.organizationId, organizationId),
            inArray(employees.id, employeeIds),
          ))
      : [];
    const [organization] = await db.select().from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) return Response.json({ error: "Organization not found." }, { status: 404 });

    const assurance = auditStatutoryContributionMonth({
      agency,
      entries,
      employees: employeeRows,
    });
    if (!assurance.ok) {
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Statutory remittance blocked by contribution assurance",
        resource: `${agency} · ${applicableMonth}`,
        metadata: {
          agency,
          applicableMonth,
          payrollRunIds: runIds,
          checkedEmployees: assurance.checkedEmployees,
          issueCount: assurance.issues.length,
          issues: assurance.issues.slice(0, 25),
        },
      });
      return Response.json({
        error:
          `Cannot open ${agency} remittance for ${applicableMonth}: `
          + `${assurance.issues.length} statutory contribution variance`
          + `${assurance.issues.length === 1 ? "" : "s"} must be corrected first. `
          + assurance.issues.slice(0, 3).map((issue) => issue.message).join(" "),
        assurance,
      }, { status: 409 });
    }

    const snapshot = buildStatutoryRemittanceSnapshot({
      agency,
      applicableMonth,
      entries,
      employees: employeeRows,
    });
    if (snapshot.employeeCount === 0 || snapshot.expectedTotal <= 0) {
      return Response.json({
        error: "Released payroll has no positive remittance liability for this agency and month.",
      }, { status: 409 });
    }

    let dueDate: string;
    try {
      dueDate = effectiveRemittanceDueDate({
        agency,
        applicableMonth,
        legalName: organization.legalName,
        philHealthEmployerNo: organization.philHealthEmployerNo,
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Could not determine statutory remittance deadline.",
      }, { status: 422 });
    }

    const created = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(statutoryRemittanceBatches).values({
        organizationId,
        agency,
        applicableMonth,
        dueDate,
        status: "open",
        employeeCount: snapshot.employeeCount,
        expectedEmployeeShare: snapshot.expectedEmployeeShare.toFixed(2),
        expectedEmployerShare: snapshot.expectedEmployerShare.toFixed(2),
        expectedTotal: snapshot.expectedTotal.toFixed(2),
        snapshotHash: snapshot.snapshotHash,
        createdBy: user.name,
      }).returning();

      await tx.insert(statutoryRemittanceMembers).values(
        snapshot.members.map((member) => ({
          batchId: batch.id,
          organizationId,
          employeeId: member.employeeId,
          employeeNo: member.employeeNo,
          employeeShare: member.employeeShare.toFixed(2),
          employerShare: member.employerShare.toFixed(2),
          totalContribution: member.totalContribution.toFixed(2),
          postingStatus: "pending",
        })),
      );
      return batch;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance liability snapshotted",
      resource: `${agency} · ${applicableMonth}`,
      metadata: {
        batchId: created.id,
        employeeCount: snapshot.employeeCount,
        expectedEmployeeShare: snapshot.expectedEmployeeShare,
        expectedEmployerShare: snapshot.expectedEmployerShare,
        expectedTotal: snapshot.expectedTotal,
        dueDate,
        snapshotHash: snapshot.snapshotHash,
        payrollRunIds: runIds,
        contributionAssurance: {
          checkedEmployees: assurance.checkedEmployees,
          issueCount: assurance.issues.length,
        },
      },
    });

    return Response.json({ batch: created }, { status: 201 });
  }

  if (action === "record_payment") {
    const batchId = Number(body.batchId);
    const amountPaid = Number(body.amountPaid);
    const paymentReference = String(body.paymentReference ?? "").trim();
    const agencyReceiptReference = String(body.agencyReceiptReference ?? "").trim();
    const paymentChannel = String(body.paymentChannel ?? "").trim().slice(0, 80) || null;
    const paymentVarianceNote = String(body.paymentVarianceNote ?? "").trim().slice(0, 240) || null;
    const paidAt = body.paidAt ? new Date(String(body.paidAt)) : new Date();

    const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
    if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });

    const [paymentProof] = await db.select({
      id: statutoryRemittancePaymentEvidence.id,
      fileName: statutoryRemittancePaymentEvidence.fileName,
      fileSha256: statutoryRemittancePaymentEvidence.fileSha256,
      byteSize: statutoryRemittancePaymentEvidence.byteSize,
      uploadedByName: statutoryRemittancePaymentEvidence.uploadedByName,
      uploadedAt: statutoryRemittancePaymentEvidence.uploadedAt,
    }).from(statutoryRemittancePaymentEvidence).where(and(
      eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
      eq(statutoryRemittancePaymentEvidence.batchId, batchId),
      eq(statutoryRemittancePaymentEvidence.status, "active"),
    )).limit(1);

    if (!paymentProof) {
      return Response.json({
        error: "Upload the official payment receipt or acknowledgement before recording this remittance as paid.",
      }, { status: 409 });
    }

    if (batch.status !== "open") {
      return Response.json({
        error: "Payment evidence is immutable once recorded. Create an audited correction workflow instead of overwriting remittance proof.",
      }, { status: 409 });
    }
    if (!Number.isFinite(paidAt.getTime())) {
      return Response.json({ error: "paidAt must be a valid date-time." }, { status: 400 });
    }

    const gate = canMarkRemittancePaid({
      expectedTotal: Number(batch.expectedTotal),
      amountPaid,
      paymentReference,
      agencyReceiptReference,
      paymentVarianceNote: paymentVarianceNote ?? undefined,
    });
    if (!gate.ok) return Response.json({ error: gate.error }, { status: 409 });

    const [updated] = await db.update(statutoryRemittanceBatches).set({
      status: "paid",
      amountPaid: amountPaid.toFixed(2),
      paymentReference,
      agencyReceiptReference,
      paymentChannel,
      paymentVarianceNote,
      paidAt,
      paymentRecordedByUserId: user.id,
      paymentRecordedBy: user.name,
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance payment recorded",
      resource: `${batch.agency} · ${batch.applicableMonth}`,
      metadata: {
        batchId,
        expectedTotal: Number(batch.expectedTotal),
        amountPaid,
        paymentReference,
        agencyReceiptReference,
        paymentChannel,
        paymentVarianceNote,
        paymentProofEvidenceId: paymentProof.id,
        paymentProofFileName: paymentProof.fileName,
        paymentProofSha256: paymentProof.fileSha256,
        paymentProofByteSize: paymentProof.byteSize,
        paymentProofUploadedBy: paymentProof.uploadedByName,
        paymentProofUploadedAt: paymentProof.uploadedAt.toISOString(),
        paidAt: paidAt.toISOString(),
      },
    });
    return Response.json({ batch: updated });
  }

  if (action === "confirm_member_posting" || action === "mark_member_exception") {
    const memberId = Number(body.memberId);
    const [member] = await db.select().from(statutoryRemittanceMembers).where(and(
      eq(statutoryRemittanceMembers.id, memberId),
      eq(statutoryRemittanceMembers.organizationId, organizationId),
    )).limit(1);
    if (!member) return Response.json({ error: "Remittance member row not found." }, { status: 404 });

    const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.id, member.batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
    if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });
    if (member.postingStatus === "confirmed") {
      return Response.json({
        error: "Confirmed employee posting evidence is immutable. Use an audited correction workflow for agency-posting corrections.",
      }, { status: 409 });
    }
    if (batch.status === "open") {
      return Response.json({ error: "Record the agency payment before confirming employee posting." }, { status: 409 });
    }
    if (batch.status === "reconciled") {
      return Response.json({ error: "A reconciled remittance batch is immutable." }, { status: 409 });
    }

    if (action === "mark_member_exception") {
      const exceptionNote = String(body.exceptionNote ?? "").trim();
      if (exceptionNote.length < 4) {
        return Response.json({ error: "Explain the posting exception." }, { status: 400 });
      }
      const [updatedMember] = await db.update(statutoryRemittanceMembers).set({
        postingStatus: "exception",
        exceptionNote,
        postingReference: null,
        postedAmount: null,
        postedAt: null,
        confirmedByUserId: user.id,
        confirmedBy: user.name,
        updatedAt: new Date(),
      }).where(eq(statutoryRemittanceMembers.id, memberId)).returning();
      await db.update(statutoryRemittanceBatches).set({
        status: "exception",
        updatedAt: new Date(),
      }).where(eq(statutoryRemittanceBatches.id, batch.id));

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Statutory contribution posting exception recorded",
        resource: `${batch.agency} · ${batch.applicableMonth} · ${member.employeeNo}`,
        metadata: { batchId: batch.id, memberId, employeeId: member.employeeId, exceptionNote },
      });
      return Response.json({ member: updatedMember });
    }

    const postingReference = String(body.postingReference ?? "").trim();
    const postedAmount = Number(body.postedAmount);
    const postedAt = body.postedAt ? new Date(String(body.postedAt)) : new Date();
    if (!Number.isFinite(postedAt.getTime())) {
      return Response.json({
        error: "A valid agency posting date is required.",
      }, { status: 400 });
    }
    const postingGate = canConfirmMemberPosting({
      expectedTotal: Number(member.totalContribution),
      postedAmount,
      postingReference,
    });
    if (!postingGate.ok) {
      return Response.json({ error: postingGate.error }, { status: 409 });
    }

    const [updatedMember] = await db.update(statutoryRemittanceMembers).set({
      postingStatus: "confirmed",
      postingReference,
      postedAmount: postedAmount.toFixed(2),
      postedAt,
      confirmedByUserId: user.id,
      confirmedBy: user.name,
      exceptionNote: null,
      updatedAt: new Date(),
    }).where(eq(statutoryRemittanceMembers.id, memberId)).returning();

    const remaining = await db.select({ id: statutoryRemittanceMembers.id })
      .from(statutoryRemittanceMembers)
      .where(and(
        eq(statutoryRemittanceMembers.batchId, batch.id),
        eq(statutoryRemittanceMembers.postingStatus, "pending"),
      ));
    const exceptions = await db.select({ id: statutoryRemittanceMembers.id })
      .from(statutoryRemittanceMembers)
      .where(and(
        eq(statutoryRemittanceMembers.batchId, batch.id),
        eq(statutoryRemittanceMembers.postingStatus, "exception"),
      ));

    const paymentShortfall = Math.max(
      0,
      Number(batch.expectedTotal) - Number(batch.amountPaid ?? 0),
    );
    const paymentCoversLiability = paymentShortfall <= 0.01;

    if (remaining.length === 0 && exceptions.length === 0 && paymentCoversLiability) {
      await db.update(statutoryRemittanceBatches).set({
        status: "reconciled",
        reconciledAt: new Date(),
        reconciledByUserId: user.id,
        reconciledBy: user.name,
        updatedAt: new Date(),
      }).where(eq(statutoryRemittanceBatches.id, batch.id));
    } else if (!paymentCoversLiability) {
      await db.update(statutoryRemittanceBatches).set({
        status: "exception",
        reconciledAt: null,
        reconciledByUserId: null,
        reconciledBy: null,
        updatedAt: new Date(),
      }).where(eq(statutoryRemittanceBatches.id, batch.id));
    } else if (batch.status === "exception" && exceptions.length === 0) {
      await db.update(statutoryRemittanceBatches).set({
        status: "paid",
        reconciledAt: null,
        reconciledByUserId: null,
        reconciledBy: null,
        updatedAt: new Date(),
      }).where(eq(statutoryRemittanceBatches.id, batch.id));
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee statutory contribution posting confirmed",
      resource: `${batch.agency} · ${batch.applicableMonth} · ${member.employeeNo}`,
      metadata: {
        batchId: batch.id,
        memberId,
        employeeId: member.employeeId,
        postingReference,
        expectedContribution: Number(member.totalContribution),
        postedAmount,
        postedAt: postedAt.toISOString(),
      },
    });
    return Response.json({ member: updatedMember });
  }

  return Response.json({
    error: "Unsupported action. Use create_batch, record_payment, confirm_member_posting, or mark_member_exception.",
  }, { status: 400 });
}
