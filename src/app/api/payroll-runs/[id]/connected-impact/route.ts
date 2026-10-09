import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests,
  attendanceExceptionEvents,
  compensationCycles,
  compensationProposals,
  employeePayRevisions,
  employeePayoutChangeRequests,
  employees,
  payrollRuns,
  workerEffectiveChanges,
  workforceTimesheets,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { buildPayrollConnectedImpact } from "@/lib/payroll-connected-impact";

export const dynamic = "force-dynamic";
const ROW_CAP = 500;

/**
 * Advisory, read-only integration of HRIS, WFM and HCM evidence. Not a release
 * gate; never changes an employee or payroll run. Explicitly require a
 * company-wide run rather than silently screening only the current org unit.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return Response.json({ error: "Invalid payroll run." }, { status: 400 });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (process.env.PAYROLL_CONNECTED_IMPACT_ENABLED !== "true") {
    // An intentionally disabled optional panel is not a missing route. Avoid
    // browser-console 404 errors while exposing neither evidence nor data.
    return new Response(null, {
      status: 204, headers: { "Cache-Control": "private, no-store" },
    });
  }

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const denied = await assertOrganizationRole(
    user.id, run.organizationId, PAYROLL_VIEW_ROLES,
    "Only authorized payroll reviewers can view upstream payroll evidence.",
  );
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id, run.organizationId, run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;
  if (run.scopeOrgUnitId !== null) {
    return Response.json({ error: "This version cannot safely reconcile org-unit payroll history; use the established payroll assurance checks." }, {
      status: 409, headers: { "Cache-Control": "private, no-store" },
    });
  }
  // Historical legal-entity transitions need effective-dated cross-entity
  // evidence, not a current-person snapshot. Fail closed rather than claim
  // a false clean review for an entity-scoped payroll.
  if (run.legalEntityId !== null) {
    return Response.json({ error: "Legal-entity payroll history requires effective-dated entity reconciliation; this view is not available for this run." }, {
      status: 409, headers: { "Cache-Control": "private, no-store" },
    });
  }

  const organizationId = run.organizationId;
  const [employment, payout, corrections, exceptions, timesheets, proposals, revisions] = await Promise.all([
    db.select({
      id: workerEffectiveChanges.id, employeeId: workerEffectiveChanges.employeeId,
      status: workerEffectiveChanges.status, effectiveDate: workerEffectiveChanges.effectiveDate,
    }).from(workerEffectiveChanges).where(and(
      eq(workerEffectiveChanges.organizationId, organizationId),
      lte(workerEffectiveChanges.effectiveDate, run.periodEnd),
    )).limit(ROW_CAP + 1),
    db.select({
      id: employeePayoutChangeRequests.id, employeeId: employeePayoutChangeRequests.employeeId,
      status: employeePayoutChangeRequests.status, appliedAt: employeePayoutChangeRequests.appliedAt,
    }).from(employeePayoutChangeRequests).where(eq(
      employeePayoutChangeRequests.organizationId, organizationId,
    )).limit(ROW_CAP + 1),
    db.select({
      id: attendanceCorrectionRequests.id, employeeId: attendanceCorrectionRequests.employeeId,
      status: attendanceCorrectionRequests.status, workDate: attendanceCorrectionRequests.workDate,
      appliedAt: attendanceCorrectionRequests.appliedAt,
    }).from(attendanceCorrectionRequests).where(and(
      eq(attendanceCorrectionRequests.organizationId, organizationId),
      gte(attendanceCorrectionRequests.workDate, run.periodStart),
      lte(attendanceCorrectionRequests.workDate, run.periodEnd),
    )).limit(ROW_CAP + 1),
    db.select({
      id: attendanceExceptionEvents.id, employeeId: attendanceExceptionEvents.employeeId,
      status: attendanceExceptionEvents.status, workDate: attendanceExceptionEvents.workDate,
      severity: attendanceExceptionEvents.severity,
    }).from(attendanceExceptionEvents).where(and(
      eq(attendanceExceptionEvents.organizationId, organizationId),
      gte(attendanceExceptionEvents.workDate, run.periodStart),
      lte(attendanceExceptionEvents.workDate, run.periodEnd),
    )).limit(ROW_CAP + 1),
    db.select({
      id: workforceTimesheets.id, employeeId: workforceTimesheets.employeeId,
      periodStart: workforceTimesheets.periodStart, periodEnd: workforceTimesheets.periodEnd,
      version: workforceTimesheets.version, status: workforceTimesheets.status,
    }).from(workforceTimesheets).where(and(
      eq(workforceTimesheets.organizationId, organizationId),
      eq(workforceTimesheets.periodStart, run.periodStart),
      eq(workforceTimesheets.periodEnd, run.periodEnd),
    )).limit(ROW_CAP + 1),
    db.select({
      id: compensationProposals.id, employeeId: compensationProposals.employeeId,
      status: compensationProposals.status, effectiveDate: compensationCycles.effectiveDate,
      approvedByUserId: compensationProposals.approvedByUserId,
      approvedAt: compensationProposals.approvedAt, appliedAt: compensationProposals.appliedAt,
      appliedPayRevisionId: compensationProposals.appliedPayRevisionId,
    }).from(compensationProposals).innerJoin(
      compensationCycles, eq(compensationProposals.cycleId, compensationCycles.id),
    ).where(and(
      eq(compensationProposals.organizationId, organizationId),
      eq(compensationCycles.organizationId, organizationId),
      lte(compensationCycles.effectiveDate, run.periodEnd),
    )).limit(ROW_CAP + 1),
    db.select({
      id: employeePayRevisions.id, employeeId: employeePayRevisions.employeeId,
      effectiveDate: employeePayRevisions.effectiveDate,
    }).from(employeePayRevisions).innerJoin(
      employees, eq(employeePayRevisions.employeeId, employees.id),
    ).where(and(
      eq(employeePayRevisions.organizationId, organizationId),
      eq(employees.organizationId, organizationId),
      gte(employeePayRevisions.effectiveDate, run.periodStart),
      lte(employeePayRevisions.effectiveDate, run.periodEnd),
    )).limit(ROW_CAP + 1),
  ]);

  const approvalByRevision = new Map<number, typeof proposals[number]>();
  for (const proposal of proposals) {
    if (proposal.status !== "applied" || !proposal.approvedByUserId
      || !proposal.approvedAt || !proposal.appliedAt || !proposal.appliedPayRevisionId) continue;
    approvalByRevision.set(proposal.appliedPayRevisionId, proposal);
  }
  const linkedRevisions = revisions.map((revision) => {
    const proposal = approvalByRevision.get(revision.id);
    return {
      ...revision,
      compensationProposalId: proposal?.employeeId === revision.employeeId
        && proposal.effectiveDate === revision.effectiveDate ? proposal.id : null,
    };
  });

  const sources = {
    employmentChanges: employment,
    payoutChanges: payout,
    attendanceCorrections: corrections,
    attendanceExceptions: exceptions,
    timesheets,
    compensationProposals: proposals,
    payRevisions: revisions,
  };
  const truncatedSources = Object.entries(sources)
    .filter(([, rows]) => rows.length > ROW_CAP)
    .map(([name]) => name);
  const report = buildPayrollConnectedImpact({
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    employmentChanges: employment.slice(0, ROW_CAP),
    payoutChanges: payout.slice(0, ROW_CAP),
    attendanceCorrections: corrections.slice(0, ROW_CAP),
    attendanceExceptions: exceptions.slice(0, ROW_CAP),
    timesheets: timesheets.slice(0, ROW_CAP),
    compensationProposals: proposals.slice(0, ROW_CAP),
    payRevisions: linkedRevisions.slice(0, ROW_CAP),
    truncatedSources,
  });

  return Response.json({ runId, runStatus: run.status, ...report }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
