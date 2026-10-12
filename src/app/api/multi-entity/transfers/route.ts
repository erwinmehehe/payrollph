import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employees, employeeEntityAssignments, entityTransferRequests,
  historicalPayrollEntries, legalEntities, leaveBalances, payrollEntries, payrollRuns, workerEmploymentEvents,
  workerEffectiveChanges,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";
import { readBasicAndThirteenth } from "@/lib/final-pay";

export const dynamic = "force-dynamic";
const disabled = () => Response.json({ error: "Entity transfers are unavailable." }, { status: 404 });
const fail = (error: string, status = 409) => Response.json({ error }, { status });
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function previousDate(ymd: string) {
  const parsed = new Date(ymd + "T00:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
function validDate(ymd: string) {
  return datePattern.test(ymd) && !Number.isNaN(Date.parse(ymd + "T00:00:00Z"))
    && new Date(ymd + "T00:00:00Z").toISOString().slice(0, 10) === ymd;
}
const managementRoles = new Set(["owner", "admin", "bookkeeper", "hr"]);
const checkerRoles = new Set(["owner", "admin", "bookkeeper"]);

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("multiEntity")) return disabled();
  const user = await getSessionUser();
  if (!user) return fail("Authentication required.", 401);
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return fail("Invalid tenant.", 400);
  const scope = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!scope.ok) return scope.response;
  if (!managementRoles.has(scope.context.role) && scope.context.role !== "group_hr") return fail("People role required.", 403);
  const where = and(eq(entityTransferRequests.organizationId, organizationId),
    scope.context.legalEntityId === null ? undefined
      : eq(entityTransferRequests.fromLegalEntityId, scope.context.legalEntityId));
  const rows = await db.select().from(entityTransferRequests).where(where)
    .orderBy(desc(entityTransferRequests.id)).limit(100);
  const destinations = await db.select({
    id: legalEntities.id, legalName: legalEntities.legalName,
    displayName: legalEntities.displayName,
  }).from(legalEntities).where(and(
    eq(legalEntities.organizationId, organizationId), eq(legalEntities.active, true),
  ));
  return Response.json({
    transfers: rows, destinations: scope.context.group
      ? destinations
      : destinations.filter(entity => entity.id === scope.context.legalEntityId),
  }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: Request) {
  // No legal-employer or service/liability transfer mutations until policy is
  // explicitly reviewed. Enabling the read-only multi-entity UI is not authority.
  if (!criticalReleaseFlagEnabled("multiEntity") ||
      !criticalReleaseFlagEnabled("multiEntityTransfers")) return disabled();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return fail("Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const toLegalEntityId = Number(body.toLegalEntityId);
  const effectiveDate = String(body.effectiveDate ?? "");
  const reason = String(body.reason ?? "").trim().slice(0, 400);
  if (![organizationId, employeeId, toLegalEntityId].every(v => Number.isSafeInteger(v) && v > 0)
    || !validDate(effectiveDate) || effectiveDate < manilaCalendarDate() || reason.length < 8)
    return fail("A valid worker, target employer, future/current effective date and reason are required.", 422);
  const scope = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!scope.ok) return scope.response;
  if (!scope.context.group || !managementRoles.has(scope.context.role))
    return fail("A group-level People administrator is required to propose an inter-employer transfer.", 403);
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const [employee, target] = await Promise.all([
    db.select().from(employees).where(and(eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId))).limit(1),
    db.select().from(legalEntities).where(and(eq(legalEntities.id, toLegalEntityId),
      eq(legalEntities.organizationId, organizationId), eq(legalEntities.active, true))).limit(1),
  ]);
  const worker = employee[0];
  if (!worker || !worker.legalEntityId || !target[0] || toLegalEntityId === worker.legalEntityId)
    return fail("Worker and distinct target employer must belong to the same tenant.", 404);
  const scopeDenied = assertEntityResource(scope.context, worker.legalEntityId);
  if (scopeDenied) return scopeDenied;
  // A scoped maker can request a transfer out of their entity; independent
  // tenant-wide checker must approve destination ownership later.
  const [openMove, acrossCutoff, approvedHcm] = await Promise.all([
    db.select({ id: entityTransferRequests.id }).from(entityTransferRequests)
      .where(and(eq(entityTransferRequests.organizationId, organizationId),
        eq(entityTransferRequests.employeeId, employeeId),
        sql`${entityTransferRequests.status} in ('pending_approval','approved')`)).limit(1),
    db.select({ id: payrollRuns.id }).from(payrollRuns).innerJoin(payrollEntries,
      eq(payrollEntries.payrollRunId, payrollRuns.id)).where(and(
        eq(payrollEntries.employeeId, employeeId), eq(payrollRuns.organizationId, organizationId),
        eq(payrollRuns.legalEntityId, worker.legalEntityId),
        lte(payrollRuns.periodStart, effectiveDate), gte(payrollRuns.periodEnd, effectiveDate),
      )).limit(1),
    db.select({ id: workerEffectiveChanges.id }).from(workerEffectiveChanges).where(and(
      eq(workerEffectiveChanges.organizationId, organizationId),
      eq(workerEffectiveChanges.employeeId, employeeId),
      sql`${workerEffectiveChanges.status} in ('pending_approval','scheduled')`,
    )).limit(1),
  ]);
  if (openMove.length || approvedHcm.length) return fail("Resolve the earlier approved or pending move first.");
  if (acrossCutoff.length) return fail("Transfer intersects a payroll cutoff. Close/review the period or choose a later effective date.");
  const leaves = await db.select({
    leaveType: leaveBalances.leaveType, year: leaveBalances.year,
    opening: leaveBalances.opening, accrued: leaveBalances.accrued,
    used: leaveBalances.used, pending: leaveBalances.pending,
  }).from(leaveBalances).where(and(eq(leaveBalances.organizationId, organizationId),
    eq(leaveBalances.employeeId, employeeId)));
  const history = await db.select({
    payrollRunId: payrollRuns.id, periodStart: payrollRuns.periodStart,
    periodEnd: payrollRuns.periodEnd, lineItems: payrollEntries.lineItems,
  }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(eq(payrollEntries.employeeId, employeeId),
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.legalEntityId, worker.legalEntityId), eq(payrollRuns.status, "Released"),
      gte(payrollRuns.periodEnd, effectiveDate.slice(0, 4) + "-01-01"),
      lte(payrollRuns.periodEnd, previousDate(effectiveDate))));
  const importedHistory = await db.select({
    legalEntityId: historicalPayrollEntries.legalEntityId,
    basicSalary: historicalPayrollEntries.basicSalary,
    thirteenthMonth: historicalPayrollEntries.thirteenthMonth,
  }).from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, organizationId),
    eq(historicalPayrollEntries.employeeId, employeeId),
    gte(historicalPayrollEntries.payDate, effectiveDate.slice(0, 4) + "-01-01"),
    lte(historicalPayrollEntries.payDate, previousDate(effectiveDate)),
  ));
  if (importedHistory.some(row => row.legalEntityId === null
    || (row.legalEntityId === worker.legalEntityId && row.basicSalary === null))) {
    return fail("Historical payroll source employer or 13th-month basic salary is unattributed. Reconcile before transfer.", 409);
  }
  let sourceBasic = 0;
  let source13thPaid = 0;
  try {
    for (const row of history) {
      const source = readBasicAndThirteenth(row.lineItems);
      sourceBasic += source.basic;
      source13thPaid += source.thirteenthPaid;
    }
    for (const row of importedHistory) {
      if (row.legalEntityId !== worker.legalEntityId) continue;
      sourceBasic += Number(row.basicSalary ?? 0);
      source13thPaid += Number(row.thirteenthMonth ?? 0);
    }
  } catch {
    return fail("Existing payroll adjustment is missing verified year attribution. Reconcile 13th-month evidence before transfer.", 409);
  }
  try {
    const [created] = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(4219, ${employeeId})`);
      const [row] = await tx.insert(entityTransferRequests).values({
        organizationId, employeeId, fromLegalEntityId: worker.legalEntityId!,
        toLegalEntityId, effectiveDate, reason, serviceStartDate: worker.startDate,
        leaveSnapshot: leaves, thirteenthSnapshot: {
          sourceRunIds: history.map(row => row.payrollRunId),
          attributedImportCount: importedHistory.filter(row => row.legalEntityId === worker.legalEntityId).length,
          recordedLineItems: history.map(row => ({
            runId: row.payrollRunId, periodStart: row.periodStart,
            periodEnd: row.periodEnd, lineItems: row.lineItems,
          })),
          sourceBasicSalaryEarned: sourceBasic.toFixed(2),
          sourceThirteenthPaid: source13thPaid.toFixed(2),
          sourceLegalEntityId: worker.legalEntityId,
          sourceEmploymentStart: worker.startDate,
          taxYear: Number(effectiveDate.slice(0, 4)),
          reconciliation: "requires_employer_by_employer_payroll_review",
        },
        continuityNote: "Service date and leave records remain attached to the one worker. 13th-month base/paid amounts and legal liability must be reconciled by employer; a transfer is not a separation.",
        requestedByUserId: user.id,
      }).returning();
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Legal entity transfer requested",
        resource: String(employeeId), metadata: {
          requestId: row.id, fromLegalEntityId: worker.legalEntityId,
          toLegalEntityId, effectiveDate, requestedByUserId: user.id,
        },
      });
      return [row];
    });
    return Response.json({ transfer: created }, { status: 201 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not request transfer.");
  }
}

export async function PATCH(request: Request) {
  // Covers approve, reject AND apply. None may change state during the hold.
  if (!criticalReleaseFlagEnabled("multiEntity") ||
      !criticalReleaseFlagEnabled("multiEntityTransfers")) return disabled();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return fail("Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "");
  if (!Number.isSafeInteger(id) || id <= 0 || !["approve", "reject", "apply"].includes(action))
    return fail("Valid request ID and approve, reject or apply are required.", 400);
  const [requestRow] = await db.select().from(entityTransferRequests)
    .where(eq(entityTransferRequests.id, id)).limit(1);
  if (!requestRow) return fail("Transfer not found.", 404);
  const scope = await resolveMultiEntityContext({
    userId: user.id, organizationId: requestRow.organizationId, request,
  });
  if (!scope.ok) return scope.response;
  // The checker needs authority over BOTH legal employers, not just the
  // employee's current entity. Source-only HR cannot complete the move.
  if (!scope.context.group || !checkerRoles.has(scope.context.role))
    return fail("Independent group-level checker required.", 403);
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  if (requestRow.requestedByUserId === user.id)
    return fail("Maker-checker: requester cannot approve or apply their own transfer.", 403);
  const today = manilaCalendarDate();
  if (action === "apply" && (requestRow.status !== "approved" || requestRow.effectiveDate > today))
    return fail("Only approved and due transfers can be applied.");
  if (action !== "apply" && requestRow.status !== "pending_approval")
    return fail("Transfer already decided.");
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(4219, ${requestRow.employeeId})`);
      const [live] = await tx.select().from(entityTransferRequests)
        .where(eq(entityTransferRequests.id, id)).limit(1);
      if (!live || live.status !== requestRow.status) throw new Error("Transfer decision was changed. Reload.");
      if (action === "reject") {
        const [updated] = await tx.update(entityTransferRequests).set({
          status: "rejected", approvedByUserId: user.id, approvedAt: new Date(),
        }).where(and(eq(entityTransferRequests.id, id), eq(entityTransferRequests.status, "pending_approval"))).returning();
        if (!updated) throw new Error("Review conflict.");
        await tx.insert(auditEvents).values({ organizationId: live.organizationId,
          actor: user.name, action: "Legal entity transfer rejected",
          resource: String(live.employeeId), metadata: { transferId: id, reviewerId: user.id } });
        return updated;
      }
      let updated = live;
      if (action === "approve") {
        const [approved] = await tx.update(entityTransferRequests).set({
          status: "approved", approvedByUserId: user.id, approvedAt: new Date(),
        }).where(and(eq(entityTransferRequests.id, id),
          eq(entityTransferRequests.status, "pending_approval"))).returning();
        if (!approved) throw new Error("Review conflict.");
        updated = approved;
      }
      if (updated.effectiveDate <= today) {
        const [worker] = await tx.select().from(employees).where(and(
          eq(employees.id, updated.employeeId), eq(employees.organizationId, updated.organizationId),
        )).limit(1);
        if (!worker || worker.legalEntityId !== updated.fromLegalEntityId
          || worker.startDate !== updated.serviceStartDate)
          throw new Error("Source employer or service date changed. Request a new review.");
        const [current] = await tx.select().from(employeeEntityAssignments).where(and(
          eq(employeeEntityAssignments.organizationId, updated.organizationId),
          eq(employeeEntityAssignments.employeeId, updated.employeeId),
          eq(employeeEntityAssignments.legalEntityId, updated.fromLegalEntityId),
          sql`${employeeEntityAssignments.effectiveUntil} is null`,
        )).limit(1);
        if (!current || current.effectiveFrom >= updated.effectiveDate)
          throw new Error("Historical assignment is missing or move date is invalid.");
        const conflict = await tx.select({ id: payrollRuns.id }).from(payrollRuns)
          .innerJoin(payrollEntries, eq(payrollEntries.payrollRunId, payrollRuns.id))
          .where(and(eq(payrollRuns.organizationId, updated.organizationId),
            eq(payrollRuns.legalEntityId, updated.fromLegalEntityId),
            eq(payrollEntries.employeeId, updated.employeeId),
            gte(payrollRuns.periodEnd, updated.effectiveDate))).limit(1);
        if (conflict.length) throw new Error("New payroll appeared after approval; cannot mix employers.");
        const [closed] = await tx.update(employeeEntityAssignments).set({
          effectiveUntil: previousDate(updated.effectiveDate),
        }).where(and(eq(employeeEntityAssignments.id, current.id),
          sql`${employeeEntityAssignments.effectiveUntil} is null`)).returning();
        if (!closed) throw new Error("Concurrent transfer conflict.");
        await tx.insert(employeeEntityAssignments).values({
          organizationId: updated.organizationId, employeeId: updated.employeeId,
          legalEntityId: updated.toLegalEntityId, effectiveFrom: updated.effectiveDate,
        });
        const [changed] = await tx.update(employees).set({ legalEntityId: updated.toLegalEntityId })
          .where(and(eq(employees.id, updated.employeeId),
            eq(employees.organizationId, updated.organizationId),
            eq(employees.legalEntityId, updated.fromLegalEntityId))).returning();
        if (!changed) throw new Error("The worker changed concurrently.");
        await tx.insert(workerEmploymentEvents).values({
          organizationId: updated.organizationId, employeeId: updated.employeeId,
          effectiveDate: updated.effectiveDate, eventType: "legal_employer_transfer",
          fromLegalEntityId: updated.fromLegalEntityId, toLegalEntityId: updated.toLegalEntityId,
          reason: updated.reason.slice(0, 240), actorUserId: user.id, actorName: user.name,
          metadata: { transferId: updated.id, serviceStartDate: worker.startDate,
            leaveBalancesPreserved: true, thirteenthSourceRetained: true, separationCreated: false },
        });
        const [applied] = await tx.update(entityTransferRequests).set({
          status: "applied", appliedAt: new Date(),
        }).where(and(eq(entityTransferRequests.id, id),
          eq(entityTransferRequests.status, "approved"))).returning();
        if (!applied) throw new Error("Transfer already applied.");
        updated = applied;
      }
      await tx.insert(auditEvents).values({
        organizationId: updated.organizationId, actor: user.name,
        action: updated.status === "applied" ? "Legal employer transfer applied" : "Legal employer transfer approved",
        resource: String(updated.employeeId),
        metadata: { transferId: id, fromLegalEntityId: updated.fromLegalEntityId,
          toLegalEntityId: updated.toLegalEntityId, approvedByUserId: user.id,
          effectiveDate: updated.effectiveDate, status: updated.status },
      });
      return updated;
    });
    return Response.json({ transfer: result });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Transfer could not be decided.");
  }
}
