import { and, desc, eq, inArray, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employees, payrollEntries, payrollRuns,
  payrollUnderpaymentRequests, supplementaryEarnings,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES,
  PAYROLL_TAX_APPROVER_ROLES, PAYROLL_VIEW_ROLES,
} from "@/lib/access";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  conflictingCutoff, hasOriginalBasicPayLine, parsePositiveUnderpaymentCents,
  payrollSourceFingerprint, validCalendarDate,
} from "@/lib/payroll-underpayment";

export const dynamic = "force-dynamic";

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

async function cutoffConflict(
  organizationId: number,
  orgUnitId: number | null,
  effectiveDate: string,
  executor: Pick<typeof db, "select" | "execute">,
) {
  // Lock the applicable cutoff rows through the same transaction used for
  // the correction write. Payroll enqueue/process/release must update these
  // rows; they cannot move from Draft until our posting commits or aborts.
  await executor.execute(sql`
    SELECT id FROM payroll_runs
    WHERE organization_id = ${organizationId}
      AND period_start <= ${effectiveDate}
      AND period_end >= ${effectiveDate}
      AND (scope_org_unit_id IS NULL OR scope_org_unit_id = ${orgUnitId})
    ORDER BY id FOR UPDATE
  `);
  const runs = await executor.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    lte(payrollRuns.periodStart, effectiveDate),
    gte(payrollRuns.periodEnd, effectiveDate),
  ));
  return conflictingCutoff(runs, orgUnitId, effectiveDate);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PAYROLL_VIEW_ROLES,
    "Only payroll personnel can view underpayment corrections.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide payroll evidence access required." }, { status: 403 });

  const [claims, workerRows, sourceRuns] = await Promise.all([
    db.select().from(payrollUnderpaymentRequests)
      .where(eq(payrollUnderpaymentRequests.organizationId, organizationId))
      .orderBy(desc(payrollUnderpaymentRequests.id)).limit(100),
    db.select({ id: employees.id, employeeNo: employees.employeeNo, firstName: employees.firstName,
      lastName: employees.lastName, status: employees.status })
      .from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({ id: payrollRuns.id, periodLabel: payrollRuns.periodLabel,
      periodEnd: payrollRuns.periodEnd, status: payrollRuns.status })
      .from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId))
      .orderBy(desc(payrollRuns.id)).limit(150),
  ]);
  const earningIds = claims.flatMap(row => row.postedEarningId == null ? [] : [row.postedEarningId]);
  const posted = earningIds.length
    ? await db.select({ id: supplementaryEarnings.id, status: supplementaryEarnings.status,
        payrollRunId: supplementaryEarnings.payrollRunId })
      .from(supplementaryEarnings)
      .where(and(eq(supplementaryEarnings.organizationId, organizationId),
        inArray(supplementaryEarnings.id, earningIds)))
    : [];
  const staff = new Map(workerRows.map(row => [row.id, row]));
  const earnings = new Map(posted.map(row => [row.id, row]));
  return Response.json({
    currentUserId: user.id,
    postingEnabled: process.env.PAYROLL_UNDERPAYMENT_POSTING_ENABLED === "true",
    employees: workerRows,
    releasedRuns: sourceRuns.filter(row => row.status === "Released"),
    requests: claims.map(row => ({
      ...row,
      employee: staff.get(row.employeeId) ?? null,
      postedEarning: row.postedEarningId == null ? null : earnings.get(row.postedEarningId) ?? null,
    })),
    correctionType: "Positive taxable basic-pay underpayment only; no released register or base-pay history rewriting.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const sourcePayrollRunId = Number(body.sourcePayrollRunId);
  const effectiveDate = String(body.effectiveDate ?? "").trim();
  const amountCents = parsePositiveUnderpaymentCents(body.amount);
  const reason = String(body.reason ?? "").trim();
  const evidenceReference = String(body.evidenceReference ?? "").trim();
  if (
    !Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(employeeId) || employeeId <= 0
    || !Number.isSafeInteger(sourcePayrollRunId) || sourcePayrollRunId <= 0
    || amountCents == null || !validCalendarDate(effectiveDate)
    || reason.length < 20 || reason.length > 500
    || evidenceReference.length < 8 || evidenceReference.length > 200
  ) {
    return Response.json({
      error: "Provide a worker, Released source run, future/current open-cutoff date, positive underpayment of PHP 0.01-1,000,000.00, 20-500 character reason and an 8-200 character evidence reference.",
    }, { status: 400 });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "A company-wide payroll operator must initiate the correction." }, { status: 403 });
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "payroll-underpayment-request", resourceId: employeeId,
    limit: 5, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [[worker], [sourceRun], sourceEntries] = await Promise.all([
    db.select().from(employees).where(and(eq(employees.organizationId, organizationId),
      eq(employees.id, employeeId))).limit(1),
    db.select().from(payrollRuns).where(and(eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.id, sourcePayrollRunId))).limit(1),
    db.select().from(payrollEntries).where(and(eq(payrollEntries.payrollRunId, sourcePayrollRunId),
      eq(payrollEntries.employeeId, employeeId))).limit(2),
  ]);
  if (!worker || !sourceRun) {
    return Response.json({ error: "The worker or original payroll run does not belong to this company." }, { status: 404 });
  }
  // Never choose the first arbitrary row if a broken source run contains
  // duplicate employee payroll entries. Reconcile source first.
  if (sourceEntries.length !== 1) {
    return Response.json({
      code: "UNDERPAYMENT_SOURCE_ENTRY_COUNT",
      error: "The original Released register must have exactly one entry for the worker before it can support a correction.",
    }, { status: 409 });
  }
  const sourceEntry = sourceEntries[0];
  if (!hasOriginalBasicPayLine(sourceEntry.lineItems)) {
    return Response.json({
      code: "UNDERPAYMENT_NO_BASIC_SOURCE",
      error: "The source Released register has no BASIC earning line for this worker. Reconcile that source before submitting a basic-pay underpayment.",
    }, { status: 409 });
  }
  if (sourceRun.status !== "Released" || !["Active", "On leave"].includes(worker.status)) {
    return Response.json({ error: "Source must be Released and the worker must be eligible for the next payroll." }, { status: 409 });
  }
  if (effectiveDate < todayPh() || effectiveDate <= String(sourceRun.periodEnd)) {
    return Response.json({ error: "Corrections must post in a current/future open cutoff after the Released source period." }, { status: 409 });
  }
  try {
    const created = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(4251, ${employeeId})`);
      const [[freshRun], freshEntries, [freshWorker]] = await Promise.all([
        tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, sourcePayrollRunId),
          eq(payrollRuns.organizationId, organizationId))).limit(1),
        tx.select().from(payrollEntries).where(and(
          eq(payrollEntries.payrollRunId, sourcePayrollRunId), eq(payrollEntries.employeeId, employeeId),
        )).limit(2),
        tx.select().from(employees).where(and(eq(employees.id, employeeId),
          eq(employees.organizationId, organizationId))).limit(1),
      ]);
      if (freshRun?.status !== "Released" || freshEntries.length !== 1
        || freshEntries[0].id !== sourceEntry.id
        || !hasOriginalBasicPayLine(freshEntries[0].lineItems)
        || payrollSourceFingerprint(freshEntries[0]) !== payrollSourceFingerprint(sourceEntry)) {
        throw new Error("UNDERPAYMENT_SOURCE_CHANGED");
      }
      if (!freshWorker || !["Active", "On leave"].includes(freshWorker.status)) {
        throw new Error("UNDERPAYMENT_WORKER_UNAVAILABLE");
      }
      if (await cutoffConflict(organizationId, freshWorker.orgUnitId, effectiveDate, tx as unknown as Pick<typeof db, "select" | "execute">)) {
        throw new Error("UNDERPAYMENT_TARGET_NOT_DRAFT");
      }
      const [row] = await tx.insert(payrollUnderpaymentRequests).values({
        organizationId, employeeId, sourcePayrollRunId, sourcePayrollEntryId: sourceEntry.id,
        sourceEntryHash: payrollSourceFingerprint(sourceEntry),
        amount: (amountCents / 100).toFixed(2),
        effectiveDate, reason, evidenceReference,
        status: "pending_review", requestedByUserId: user.id, requestedBy: user.name,
      }).returning();
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: "Historical taxable basic-pay underpayment requested",
        resource: `Underpayment #${row.id}`,
        metadata: {
          requestId: row.id, employeeId, sourcePayrollRunId, sourcePayrollEntryId: sourceEntry.id,
          sourceEntryHash: row.sourceEntryHash, amount: row.amount,
          effectiveDate, evidenceReference, reason,
        },
      });
      return row;
    });
    return Response.json({
      request: created,
      message: "Submitted. An independent reviewer must validate wage, statutory and tax treatment against original payroll and evidence before posting.",
    }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["UNDERPAYMENT_SOURCE_CHANGED", "UNDERPAYMENT_TARGET_NOT_DRAFT", "UNDERPAYMENT_WORKER_UNAVAILABLE"].includes(code)) {
      return Response.json({ code, error: "Source evidence, worker eligibility or target payroll changed. Refresh, reconcile and try a fresh request." }, { status: 409 });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return Response.json({ code: "UNDERPAYMENT_DUPLICATE", error: "There is already a pending or posted correction for this source employee and run. Reconcile it rather than paying twice." }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  const reviewReason = String(body.reviewReason ?? "").trim();
  const taxVerificationReference = String(body.taxVerificationReference ?? "").trim();
  if (
    !Number.isSafeInteger(id) || id <= 0
    || !Number.isSafeInteger(organizationId) || organizationId <= 0
    || !["approve", "reject"].includes(action)
    || reviewReason.length < 20 || reviewReason.length > 500
    || (action === "approve" && (taxVerificationReference.length < 8 || taxVerificationReference.length > 200))
  ) {
    return Response.json({
      error: "Valid request/action and 20-500 character reviewer rationale are required. Approval also needs an 8-200 character payroll/tax verification reference.",
    }, { status: 400 });
  }
  // A signed-off feature gate defaults OFF even if the code is present or
  // a draft preview deployment shares a real payroll connection. Requests
  // and rejection reviews remain possible; only posting money is gated.
  if (action === "approve" && process.env.PAYROLL_UNDERPAYMENT_POSTING_ENABLED !== "true") {
    return Response.json({
      code: "UNDERPAYMENT_POSTING_NOT_CERTIFIED",
      error: "Historical underpayment posting is disabled until independent payroll/tax validation, staging reconciliation and controlled-pilot sign-off are complete.",
    }, { status: 409 });
  }

  const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_TAX_APPROVER_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide independent payroll approval is required." }, { status: 403 });
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "payroll-underpayment-review",
    resourceId: id, limit: 5, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;
  try {
    const reviewed = await db.transaction(async tx => {
      await tx.execute(sql`select id from payroll_underpayment_requests where id = ${id} and organization_id = ${organizationId} for update`);
      const [pending] = await tx.select().from(payrollUnderpaymentRequests)
        .where(and(eq(payrollUnderpaymentRequests.id, id),
          eq(payrollUnderpaymentRequests.organizationId, organizationId))).limit(1);
      if (!pending) throw new Error("UNDERPAYMENT_NOT_FOUND");
      if (pending.status !== "pending_review") throw new Error("UNDERPAYMENT_ALREADY_DECIDED");
      if (pending.requestedByUserId === user.id) throw new Error("UNDERPAYMENT_SELF_REVIEW");

      const [[run], entries, [worker]] = await Promise.all([
        tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, pending.sourcePayrollRunId),
          eq(payrollRuns.organizationId, organizationId))).limit(1),
        tx.select().from(payrollEntries).where(and(
          eq(payrollEntries.payrollRunId, pending.sourcePayrollRunId),
          eq(payrollEntries.employeeId, pending.employeeId),
        )).limit(2),
        tx.select().from(employees).where(and(eq(employees.id, pending.employeeId),
          eq(employees.organizationId, organizationId))).limit(1),
      ]);
      if (run?.status !== "Released" || entries.length !== 1
        || entries[0].id !== pending.sourcePayrollEntryId
        || !hasOriginalBasicPayLine(entries[0].lineItems)
        || payrollSourceFingerprint(entries[0]) !== pending.sourceEntryHash) {
        throw new Error("UNDERPAYMENT_SOURCE_CHANGED");
      }
      if (!worker) throw new Error("UNDERPAYMENT_WORKER_UNAVAILABLE");

      let postedEarningId: number | null = null;
      if (action === "approve") {
        if (!["Active", "On leave"].includes(worker.status)) throw new Error("UNDERPAYMENT_WORKER_UNAVAILABLE");
        if (String(pending.effectiveDate) < todayPh() || String(pending.effectiveDate) <= String(run.periodEnd)) {
          throw new Error("UNDERPAYMENT_DATE_EXPIRED");
        }
        if (await cutoffConflict(organizationId, worker.orgUnitId, String(pending.effectiveDate), tx as unknown as Pick<typeof db, "select" | "execute">)) {
          throw new Error("UNDERPAYMENT_TARGET_NOT_DRAFT");
        }
        // Uses the existing taxable supplementary earning and one-time
        // settlement paths. No source history or current pay rate is rewritten.
        const [earning] = await tx.insert(supplementaryEarnings).values({
          organizationId, employeeId: pending.employeeId,
          earningType: "other_taxable",
          label: `Reviewed basic-pay shortfall #${pending.id}`.slice(0, 120),
          amount: pending.amount, taxable: true,
          includeInSssBase: true, includeInPagIbigBase: true,
          effectiveDate: String(pending.effectiveDate),
          status: "approved", createdBy: user.name,
        }).returning({ id: supplementaryEarnings.id });
        postedEarningId = earning.id;
      }

      const [row] = await tx.update(payrollUnderpaymentRequests).set({
        status: action === "approve" ? "posted" : "rejected",
        postedEarningId,
        reviewedByUserId: user.id,
        reviewedBy: user.name,
        reviewedAt: new Date(),
        reviewReason: reviewReason.slice(0, 500),
      }).where(and(eq(payrollUnderpaymentRequests.id, id),
        eq(payrollUnderpaymentRequests.organizationId, organizationId),
        eq(payrollUnderpaymentRequests.status, "pending_review"))).returning();
      if (!row) throw new Error("UNDERPAYMENT_ALREADY_DECIDED");
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: action === "approve" ? "Historical underpayment independently reviewed and posted" : "Historical underpayment rejected",
        resource: `Underpayment #${id}`,
        metadata: {
          requestId: id, employeeId: pending.employeeId,
          sourcePayrollRunId: pending.sourcePayrollRunId,
          sourceEntryHash: pending.sourceEntryHash,
          amount: pending.amount, effectiveDate: pending.effectiveDate,
          postedEarningId, requesterId: pending.requestedByUserId, reviewerId: user.id,
          reviewReason, evidenceReference: pending.evidenceReference,
          taxVerificationReference: action === "approve" ? taxVerificationReference : undefined,
        },
      });
      return row;
    });
    return Response.json({
      request: reviewed,
      message: action === "approve"
        ? "Posted into the one-time taxable earnings ledger for the next eligible cutoff; payroll calculation, checker approval and release are still required."
        : "Rejected without any payroll posting.",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const errors: Record<string, string> = {
      UNDERPAYMENT_NOT_FOUND: "The correction does not belong to this workspace.",
      UNDERPAYMENT_ALREADY_DECIDED: "This correction is already decided; it cannot be applied twice.",
      UNDERPAYMENT_SELF_REVIEW: "Maker-checker: the requester cannot review their own correction.",
      UNDERPAYMENT_SOURCE_CHANGED: "The released source payroll no longer matches its sealed review fingerprint.",
      UNDERPAYMENT_WORKER_UNAVAILABLE: "The employee is not eligible for an upcoming payroll; use the separation/final-pay workflow.",
      UNDERPAYMENT_DATE_EXPIRED: "The cutoff date is now past; reject and request a new correction to a valid date.",
      UNDERPAYMENT_TARGET_NOT_DRAFT: "The target payroll is already calculated or has progressed beyond an empty Draft; reject and resubmit to a later cutoff.",
    };
    if (errors[code]) return Response.json({ code, error: errors[code] }, { status: code === "UNDERPAYMENT_NOT_FOUND" ? 404 : 409 });
    throw error;
  }
}
