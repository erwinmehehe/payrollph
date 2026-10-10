import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employeeScheduleAssignments, employeeWorksiteAssignments, employees,
  hcmWorkArrangements, hcmWorksiteAuthorizations, leaveRequests, overtimeRequests,
  payrollRuns, scheduleOverrides, schedulePatternDays, schedulePatternSegments,
  schedulePatterns, separationRecords, shiftDefinitions, timePunches,
  workforceAttendancePeriodLocks, workforceRosterBatches,
  workforceScheduleGuardrailPolicies, workforceTimesheets, worksites,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  canReviewRosterBatch, parseRecordedBatchEmployeeIds, parseRosterBatchProposal,
  rosterBatchRequestSha, rosterBulkPublishEnabled, safeSha256,
} from "@/lib/workforce-bulk-publish";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import { rosterDateOffset } from "@/lib/workforce-team-roster";
import { evaluateHcmWorkPeriod } from "@/lib/hcm-work-period-guard";
import { evaluateSiteEligibility } from "@/lib/hcm-worksite-eligibility";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { resolveDailySchedule, type WorkforceScheduleOverride } from "@/lib/workforce-scheduling";
import {
  DEFAULT_SCHEDULE_GUARDRAIL_POLICY, evaluateScheduleGuardrails,
} from "@/lib/workforce-schedule-guardrails";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
const failure = (code: string, error: string, status = 409) =>
  ({ status, payload: { code, error } });

type DecisionResult = ReturnType<typeof failure> | {
  status: number; payload: Record<string, unknown>;
};

export async function GET(request: Request) {
  if (!rosterBulkPublishEnabled()) {
    return Response.json({ error: "Bulk roster approval is not enabled." }, { status: 404 });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || organizationId > 2147483647) {
    return Response.json({ error: "A valid employer is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Only People administrators may view governed roster batches.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Company-wide People access is required." }, { status: 403 });
  }
  const rows = await db.select().from(workforceRosterBatches).where(
    eq(workforceRosterBatches.organizationId, organizationId),
  ).orderBy(desc(workforceRosterBatches.id)).limit(50);
  const employeeIds = [...new Set(rows.flatMap(row =>
    Array.isArray(row.employeeIds) ? row.employeeIds.filter(
      id => Number.isSafeInteger(id) && Number(id) > 0,
    ) as number[] : []))];
  const people = employeeIds.length
    ? await db.select({
      id: employees.id, employeeNo: employees.employeeNo,
      firstName: employees.firstName, lastName: employees.lastName,
    }).from(employees).where(and(
      eq(employees.organizationId, organizationId), inArray(employees.id, employeeIds),
    ))
    : [];
  const person = new Map(people.map(p => [p.id, {
    id: p.id, employeeNo: p.employeeNo, name: (p.firstName + " " + p.lastName).trim(),
  }]));
  return Response.json({ batches: rows.map(row => ({
    id: row.id, workDate: String(row.workDate),
    shiftDefinitionId: row.shiftDefinitionId, reason: row.reason, status: row.status,
    requestedBy: row.requestedByName, requestedByUserId: row.requestedByUserId,
    requestedAt: row.requestedAt,
    decidedBy: row.decidedByName, decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    employees: Array.isArray(row.employeeIds)
      ? row.employeeIds.map(id => person.get(Number(id))).filter(Boolean) : [],
    overrideCount: Array.isArray(row.overrideIds) ? row.overrideIds.length : 0,
  })) }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!rosterBulkPublishEnabled()) {
    return Response.json({ error: "Bulk roster approval is not enabled." }, { status: 404 });
  }
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || organizationId > 2147483647
    || !["stage", "approve", "reject"].includes(action)) {
    return Response.json({ error: "Valid employer and stage/approve/reject action are required." },
      { status: 400 });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Only People administrators may stage or decide roster batches.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Company-wide People access is required." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "wfm-governed-roster-" + action,
    resourceId: organizationId, limit: 12, windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let proposal: ReturnType<typeof parseRosterBatchProposal> | null = null;
  if (action === "stage") {
    try {
      proposal = parseRosterBatchProposal(body, phWorkDateAt());
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
    }
  } else if (!Number.isSafeInteger(body.batchId) || Number(body.batchId) <= 0
    || body.acknowledged !== true
    || typeof body.decisionNote !== "string"
    || body.decisionNote.trim().length < 12
    || body.decisionNote.trim().length > 240) {
    return Response.json({
      error: "A valid batch, explicit impact acknowledgement and 12–240 character decision note are required.",
    }, { status: 400 });
  }

  try {
    const decision: DecisionResult = await db.transaction(async tx => {
      // Atomic per-employer staging/approval; other scheduling writers still
      // need the same lock before enterprise activation.
      await tx.execute(sql`select pg_advisory_xact_lock(6107, ${organizationId})`);

      async function inspect(employeeIds: number[], workDate: string, shiftId: number) {
        const start = rosterDateOffset(workDate, -7);
        const end = rosterDateOffset(workDate, 7);
        const [workerRows, shifts, patterns, patternDays, patternSegments, assignments,
          overrides, worksiteAssignments, sites, arrangements, siteAuthorizations,
          activeLeaves, punches, overtime, timecards, payroll, activeLocks, policies, separations] = await Promise.all([
          tx.select({
            id: employees.id, employeeNo: employees.employeeNo, status: employees.status,
            startDate: employees.startDate, orgUnitId: employees.orgUnitId,
          }).from(employees).where(and(
            eq(employees.organizationId, organizationId), inArray(employees.id, employeeIds),
          )).orderBy(asc(employees.id)),
          tx.select().from(shiftDefinitions).where(eq(shiftDefinitions.organizationId, organizationId)),
          tx.select().from(schedulePatterns).where(eq(schedulePatterns.organizationId, organizationId)),
          tx.select({
            id: schedulePatternDays.id, patternId: schedulePatternDays.patternId,
            dayIndex: schedulePatternDays.dayIndex, isRestDay: schedulePatternDays.isRestDay,
            label: schedulePatternDays.label,
          }).from(schedulePatternDays)
            .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
            .where(eq(schedulePatterns.organizationId, organizationId)),
          tx.select({
            patternDayId: schedulePatternSegments.patternDayId,
            shiftDefinitionId: schedulePatternSegments.shiftDefinitionId,
            segmentOrder: schedulePatternSegments.segmentOrder,
          }).from(schedulePatternSegments)
            .innerJoin(schedulePatternDays, eq(schedulePatternSegments.patternDayId, schedulePatternDays.id))
            .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
            .where(eq(schedulePatterns.organizationId, organizationId)),
          tx.select().from(employeeScheduleAssignments).where(and(
            eq(employeeScheduleAssignments.organizationId, organizationId),
            inArray(employeeScheduleAssignments.employeeId, employeeIds),
            lte(employeeScheduleAssignments.effectiveFrom, end),
          )),
          tx.select().from(scheduleOverrides).where(and(
            eq(scheduleOverrides.organizationId, organizationId),
            inArray(scheduleOverrides.employeeId, employeeIds),
            gte(scheduleOverrides.workDate, start), lte(scheduleOverrides.workDate, end),
          )),
          tx.select().from(employeeWorksiteAssignments).where(and(
            eq(employeeWorksiteAssignments.organizationId, organizationId),
            inArray(employeeWorksiteAssignments.employeeId, employeeIds),
          )),
          tx.select({
            id: worksites.id, active: worksites.active, siteType: worksites.siteType,
          }).from(worksites).where(eq(worksites.organizationId, organizationId)),
          tx.select().from(hcmWorkArrangements).where(and(
            eq(hcmWorkArrangements.organizationId, organizationId),
            inArray(hcmWorkArrangements.employeeId, employeeIds),
          )),
          tx.select().from(hcmWorksiteAuthorizations).where(and(
            eq(hcmWorksiteAuthorizations.organizationId, organizationId),
            inArray(hcmWorksiteAuthorizations.employeeId, employeeIds),
          )),
          tx.select({ id: leaveRequests.id, employeeId: leaveRequests.employeeId })
            .from(leaveRequests).where(and(
              eq(leaveRequests.organizationId, organizationId),
              inArray(leaveRequests.employeeId, employeeIds),
              eq(leaveRequests.status, "Approved"),
              lte(leaveRequests.startDate, workDate), gte(leaveRequests.endDate, workDate),
            )),
          tx.select({ id: timePunches.id }).from(timePunches).where(and(
            eq(timePunches.organizationId, organizationId),
            inArray(timePunches.employeeId, employeeIds), eq(timePunches.workDate, workDate),
          )).limit(1),
          tx.select({ id: overtimeRequests.id }).from(overtimeRequests).where(and(
            eq(overtimeRequests.organizationId, organizationId),
            inArray(overtimeRequests.employeeId, employeeIds), eq(overtimeRequests.workDate, workDate),
          )).limit(1),
          tx.select({ id: workforceTimesheets.id }).from(workforceTimesheets).where(and(
            eq(workforceTimesheets.organizationId, organizationId),
            inArray(workforceTimesheets.employeeId, employeeIds),
            lte(workforceTimesheets.periodStart, workDate), gte(workforceTimesheets.periodEnd, workDate),
          )).limit(1),
          tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(
            eq(payrollRuns.organizationId, organizationId),
            lte(payrollRuns.periodStart, workDate), gte(payrollRuns.periodEnd, workDate),
          )).limit(1),
          tx.select({ id: workforceAttendancePeriodLocks.id }).from(workforceAttendancePeriodLocks).where(and(
            eq(workforceAttendancePeriodLocks.organizationId, organizationId),
            eq(workforceAttendancePeriodLocks.status, "locked"),
            lte(workforceAttendancePeriodLocks.periodStart, workDate),
            gte(workforceAttendancePeriodLocks.periodEnd, workDate),
          )).limit(1),
          tx.select().from(workforceScheduleGuardrailPolicies).where(
            eq(workforceScheduleGuardrailPolicies.organizationId, organizationId),
          ).limit(1),
          tx.select({
            id: separationRecords.id, employeeId: separationRecords.employeeId,
            status: separationRecords.status, lastDay: separationRecords.lastDay,
          }).from(separationRecords).where(and(
            eq(separationRecords.organizationId, organizationId),
            inArray(separationRecords.employeeId, employeeIds),
            inArray(separationRecords.status, ["draft", "approved", "released"]),
          )).orderBy(desc(separationRecords.id)),
        ]);
        if (workerRows.length !== employeeIds.length ||
          !workerRows.every((row, i) => row.id === employeeIds[i])) {
          return { error: "One or more selected workers are no longer in this employer.", rows: [] as Array<{
            employeeId: number; worksiteId: number; workLocationOrgUnitId: number | null;
          }>, sha: "" };
        }
        const shift = shifts.find(s => s.id === shiftId && s.active);
        if (!shift) return { error: "The selected shift is not an active employer-owned shift.", rows: [], sha: "" };
        if (activeLeaves.length || punches.length || overtime.length || timecards.length ||
          payroll.length || activeLocks.length) {
          return {
            error: "Approved leave, captured time, overtime, timesheet, payroll period or attendance cutoff exists for this work date. Reconcile it individually.",
            rows: [], sha: "",
          };
        }
        const policy = policies[0] ? {
          minimumRestMinutes: policies[0].minimumRestMinutes,
          maxConsecutiveWorkingDays: policies[0].maxConsecutiveWorkingDays,
          rollingSevenDayMinutes: policies[0].rollingSevenDayMinutes,
          enforcementMode: policies[0].enforcementMode === "block" ? "block" as const : "advisory" as const,
          active: policies[0].active,
        } : DEFAULT_SCHEDULE_GUARDRAIL_POLICY;
        const mappedWorksites = worksiteAssignments.map(row => ({
          id: row.id, employeeId: row.employeeId, worksiteId: row.worksiteId,
          effectiveFrom: String(row.effectiveFrom),
          effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        }));
        const eligibilityEvidence = {
          sites, primaryAssignments: worksiteAssignments.map(row => ({
            id: row.id, employeeId: row.employeeId, worksiteId: row.worksiteId,
            decision: row.decision as "allow" | "deny",
            effectiveFrom: String(row.effectiveFrom),
            effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
          })),
          arrangements: arrangements.map(row => ({
            id: row.id, employeeId: row.employeeId, mode: row.mode,
            effectiveFrom: String(row.effectiveFrom),
            effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
          })),
          authorizations: siteAuthorizations.map(row => ({
            id: row.id, employeeId: row.employeeId, worksiteId: row.worksiteId,
            decision: row.decision as "allow" | "deny",
            effectiveFrom: String(row.effectiveFrom),
            effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
          })),
        };
        const dates = Array.from({ length: 15 }, (_, i) => rosterDateOffset(workDate, i - 7));
        const rows: Array<{ employeeId: number; worksiteId: number; workLocationOrgUnitId: number | null }> = [];
        const evidence: unknown[] = [];
        for (const employee of workerRows) {
          const latestSeparation = separations.find(row =>
            row.employeeId === employee.id && String(row.lastDay) >= String(employee.startDate),
          );
          const period = evaluateHcmWorkPeriod({
            employee: {
              employeeId: employee.id, organizationId, status: employee.status,
              startDate: String(employee.startDate),
            },
            startDate: workDate, endDate: workDate,
            separation: latestSeparation ? {
              status: latestSeparation.status, lastDay: String(latestSeparation.lastDay),
            } : null,
          });
          if (!period.ok || employee.status !== "Active") {
            return { error: "A worker has unresolved HCM employment authorization.", rows: [], sha: "" };
          }
          const employeeOverrides: WorkforceScheduleOverride[] = overrides
            .filter(row => row.employeeId === employee.id)
            .map(row => ({
              id: row.id, workDate: String(row.workDate),
              kind: row.kind as WorkforceScheduleOverride["kind"], isRestDay: row.isRestDay,
              segments: Array.isArray(row.segments)
                ? row.segments as WorkforceScheduleOverride["segments"] : [],
              status: row.status as WorkforceScheduleOverride["status"],
              worksiteId: row.worksiteId, workLocationOrgUnitId: row.workLocationOrgUnitId,
              reason: row.reason,
            }));
          if (employeeOverrides.some(row => row.workDate === workDate)) {
            return { error: "An existing day-level override requires individual reconciliation.", rows: [], sha: "" };
          }
          const employeeAssignments = assignments.filter(row => row.employeeId === employee.id).map(row => ({
            id: row.id, patternId: row.patternId,
            effectiveFrom: String(row.effectiveFrom),
            effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
            anchorDate: String(row.anchorDate),
            workLocationOrgUnitId: row.workLocationOrgUnitId, worksiteId: row.worksiteId,
          }));
          const workerWorksites = mappedWorksites.filter(row => row.employeeId === employee.id);
          const resolve = (date: string, additions: WorkforceScheduleOverride[]) =>
            resolveDailySchedule({
              date, assignments: employeeAssignments, patterns, patternDays, patternSegments,
              shifts, overrides: additions,
              defaultWorksiteId: selectEffectiveWorksiteAssignment(workerWorksites, date)?.worksiteId ?? null,
            });
          const originalDays = dates.map(date => resolve(date, employeeOverrides));
          const currentDay = originalDays[7];
          if (currentDay.source === "unassigned" || currentDay.isRestDay ||
            currentDay.segments.length !== 1 || currentDay.worksiteId == null) {
            return { error: "Only assigned single-shift working dates with governed worksite evidence may be changed in bulk.", rows: [], sha: "" };
          }
          if (currentDay.segments[0].shiftDefinitionId === shiftId) {
            return { error: "A selected worker already has the proposed shift; remove unchanged workers.", rows: [], sha: "" };
          }
          const siteReview = evaluateSiteEligibility({
            ...eligibilityEvidence,
            employeeId: employee.id, worksiteId: currentDay.worksiteId, date: workDate,
          });
          if (siteReview.status !== "eligible") {
            return { error: "A worker has missing, warning or denied worksite authorization.", rows: [], sha: "" };
          }
          const nextOverride: WorkforceScheduleOverride = {
            id: Number.MAX_SAFE_INTEGER, workDate, kind: "shift", isRestDay: false,
            segments: [{ shiftDefinitionId: shiftId, segmentOrder: 1 }],
            worksiteId: currentDay.worksiteId,
            workLocationOrgUnitId: currentDay.workLocationOrgUnitId,
            status: "approved", reason: "Proposed governed bulk shift",
          };
          const proposedDays = dates.map(date => resolve(date, [...employeeOverrides, nextOverride]));
          const issues = evaluateScheduleGuardrails({ days: proposedDays, policy });
          // Even advisory issues are blocked in this new bulk lane until a governed
          // labor-policy exception workflow is separately implemented.
          if (issues.length > 0) {
            return { error: "The proposed roster conflicts with binding workforce guardrails.", rows: [], sha: "" };
          }
          rows.push({
            employeeId: employee.id,
            worksiteId: currentDay.worksiteId,
            workLocationOrgUnitId: currentDay.workLocationOrgUnitId,
          });
          evidence.push({
            employeeId: employee.id,
            employment: [employee.status, String(employee.startDate), employee.orgUnitId],
            authorizedSite: [siteReview.status, siteReview.source, siteReview.arrangement],
            originalDays,
            proposedDays,
            guardrailIssues: issues,
          });
        }
        const sha = safeSha256({
          organizationId, workDate, shiftId, employeeIds, policy, shift, evidence,
        });
        return { error: null, rows, sha };
      }

      if (action === "stage") {
        const payload = proposal!;
        const requestSha = rosterBatchRequestSha(payload);
        const [existing] = await tx.select().from(workforceRosterBatches).where(and(
          eq(workforceRosterBatches.organizationId, organizationId),
          eq(workforceRosterBatches.requestedByUserId, user.id),
          eq(workforceRosterBatches.idempotencyKey, payload.idempotencyKey),
        )).limit(1);
        if (existing) {
          return existing.requestSha256 === requestSha
            ? { status: 200, payload: { id: existing.id, status: existing.status, replayed: true } }
            : failure("WFM_BATCH_KEY_REUSE", "This idempotency key is already bound to another proposal.");
        }
        const checked = await inspect(payload.employeeIds, payload.workDate, payload.shiftDefinitionId);
        if (checked.error) return failure("WFM_BATCH_SOURCE_REVIEW_REQUIRED", checked.error);
        const [batch] = await tx.insert(workforceRosterBatches).values({
          organizationId, workDate: payload.workDate, shiftDefinitionId: payload.shiftDefinitionId,
          employeeIds: payload.employeeIds, evidenceSha256: checked.sha,
          requestSha256: requestSha, idempotencyKey: payload.idempotencyKey,
          reason: payload.reason, status: "pending",
          requestedByUserId: user.id, requestedByName: user.name,
        }).returning({ id: workforceRosterBatches.id });
        await tx.insert(auditEvents).values({
          organizationId, actor: user.name, action: "WFM bulk roster batch staged",
          resource: "Batch #" + batch.id,
          metadata: { batchId: batch.id, workDate: payload.workDate,
            shiftDefinitionId: payload.shiftDefinitionId, employeeIds: payload.employeeIds,
            evidenceSha256: checked.sha, automaticPublish: false },
        });
        return { status: 201, payload: {
          id: batch.id, status: "pending", workers: payload.employeeIds.length,
          message: "Staged for a different authorized checker. No shifts were published.",
        } };
      }

      const batchId = Number(body.batchId);
      const [batch] = await tx.select().from(workforceRosterBatches).where(and(
        eq(workforceRosterBatches.id, batchId),
        eq(workforceRosterBatches.organizationId, organizationId),
      )).for("update").limit(1);
      if (!batch) return failure("WFM_BATCH_NOT_FOUND", "Batch not found in this employer.", 404);
      if (batch.status !== "pending") {
        return failure("WFM_BATCH_ALREADY_DECIDED", "This batch has already been decided.");
      }
      if (!canReviewRosterBatch(batch.requestedByUserId, user.id)) {
        return failure("WFM_BATCH_SELF_APPROVAL", "The maker cannot approve or reject their own batch.", 403);
      }
      const decidedAt = new Date();
      const decisionNote = String(body.decisionNote).trim();
      if (action === "reject") {
        await tx.update(workforceRosterBatches).set({
          status: "rejected", decidedByUserId: user.id, decidedByName: user.name,
          decidedAt, decisionNote, updatedAt: decidedAt,
        }).where(eq(workforceRosterBatches.id, batch.id));
        await tx.insert(auditEvents).values({
          organizationId, actor: user.name, action: "WFM bulk roster batch rejected",
          resource: "Batch #" + batch.id,
          metadata: { batchId: batch.id, reason: decisionNote },
        });
        return { status: 200, payload: { id: batch.id, status: "rejected" } };
      }
      let workerIds: number[];
      try {
        workerIds = parseRecordedBatchEmployeeIds(batch.employeeIds);
      } catch {
        return failure("WFM_BATCH_INVALID_SOURCE", "Stored batch evidence needs data reconciliation.");
      }
      let checked: Awaited<ReturnType<typeof inspect>>;
      try {
        if (String(batch.workDate) <= phWorkDateAt()) {
          throw new Error("The proposed work date is no longer in the future.");
        }
        checked = await inspect(workerIds, String(batch.workDate), batch.shiftDefinitionId);
      } catch {
        checked = { error: "Current scheduling source could not be verified.", rows: [], sha: "" };
      }
      if (checked.error || checked.sha !== batch.evidenceSha256) {
        await tx.update(workforceRosterBatches).set({
          status: "stale", decidedByUserId: user.id, decidedByName: user.name,
          decidedAt, decisionNote: ("Source changed/blocked. " + decisionNote).slice(0, 240),
          updatedAt: decidedAt,
        }).where(eq(workforceRosterBatches.id, batch.id));
        await tx.insert(auditEvents).values({
          organizationId, actor: user.name, action: "WFM bulk roster batch marked stale",
          resource: "Batch #" + batch.id,
          metadata: { batchId: batch.id, published: false, sourceMatch: checked.sha === batch.evidenceSha256 },
        });
        return failure("WFM_BATCH_STALE", "Batch source changed or is blocked. Stage a new independently reviewed proposal.");
      }
      const inserted = await tx.insert(scheduleOverrides).values(checked.rows.map(row => ({
        organizationId, employeeId: row.employeeId,
        workDate: String(batch.workDate), kind: "shift", isRestDay: false,
        segments: [{ shiftDefinitionId: batch.shiftDefinitionId, segmentOrder: 1 }],
        worksiteId: row.worksiteId, workLocationOrgUnitId: row.workLocationOrgUnitId,
        reason: batch.reason, status: "approved", createdBy: batch.requestedByName,
        approvedBy: user.name, approvedAt: decidedAt,
      }))).returning({ id: scheduleOverrides.id, employeeId: scheduleOverrides.employeeId });
      if (inserted.length !== workerIds.length) {
        throw new Error("Bulk publish did not write the full authorized cohort.");
      }
      const overrideIds = inserted.map(row => row.id);
      await tx.update(workforceRosterBatches).set({
        status: "approved", decidedByUserId: user.id, decidedByName: user.name,
        decidedAt, decisionNote, overrideIds, updatedAt: decidedAt,
      }).where(eq(workforceRosterBatches.id, batch.id));
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "WFM governed bulk roster published",
        resource: "Batch #" + batch.id,
        metadata: {
          batchId: batch.id, workDate: String(batch.workDate),
          employeeIds: workerIds, shiftDefinitionId: batch.shiftDefinitionId,
          sourceEvidenceSha256: checked.sha, overrideIds,
          makerUserId: batch.requestedByUserId, checkerUserId: user.id,
          payrollRelease: false,
        },
      });
      return { status: 200, payload: {
        id: batch.id, status: "approved", published: overrideIds.length, overrideIds,
      } };
    }, { isolationLevel: "serializable" });
    return Response.json(decision.payload, { status: decision.status, headers: noStore });
  } catch {
    // Unique override constraints and serializable retry conflicts roll back the ENTIRE batch.
    // Never treat partial inserts, advisory suggestions or an unknown error as success.
    return Response.json({
      code: "WFM_BATCH_TRANSACTION_ABORTED",
      error: "The atomic batch was not committed. Refresh source evidence before retrying.",
    }, { status: 409, headers: noStore });
  }
}
