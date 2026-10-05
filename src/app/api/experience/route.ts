import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  feedbackRequests,
  feedbackRounds,
  mentorships,
  oneOnOneActionItems,
  oneOnOneMeetings,
  oneOnOneSeries,
  orgUnits,
  performanceCycles,
  performanceGoalAlignments,
  performanceGoals,
  positionAssignments,
  positions,
  strategicGoals,
} from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  ONE_ON_ONE_CADENCES,
  boundedProgress,
  isIsoDate,
  nextCadenceDate,
  type OneOnOneCadence,
} from "@/lib/employee-experience";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const EXPERIENCE_ROLES = new Set(["owner", "admin", "hr", "manager"]);
const STRATEGIC_SCOPES = ["company", "team"] as const;
const GOAL_STATUSES = ["active", "completed", "cancelled"] as const;
const MEETING_STATUSES = ["scheduled", "completed", "cancelled"] as const;
const ACTION_STATUSES = ["open", "completed", "cancelled"] as const;
const FEEDBACK_RELATIONSHIPS = ["manager", "peer", "direct_report", "cross_functional", "other"] as const;
const MENTORSHIP_STATUSES = ["requested", "active", "declined", "completed", "cancelled"] as const;

async function experienceAccess(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to manage manager and employee experience.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access || !EXPERIENCE_ROLES.has(access.role)) {
    return { error: Response.json({ error: "Your role is not allowed to manage manager and employee experience." }, { status: 403 }) };
  }
  return { access };
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const accessResult = await experienceAccess(userId, organizationId);
  if ("error" in accessResult) return accessResult;
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return { error: Response.json({ error: "Employee not found in this workspace." }, { status: 404 }) };
  const scope = assertScope(accessResult.access, employee.orgUnitId);
  if (!scope.ok) return { error: Response.json({ error: scope.error }, { status: scope.status }) };
  return { access: accessResult.access, employee };
}

async function activeManagerForEmployee(organizationId: number, employeeId: number) {
  const [assignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    isNull(positionAssignments.effectiveUntil),
  )).orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id)).limit(1);
  if (!assignment) return null;
  const [position] = await db.select().from(positions).where(and(
    eq(positions.id, assignment.positionId),
    eq(positions.organizationId, organizationId),
  )).limit(1);
  return position?.managerEmployeeId ?? null;
}

function limitedText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const accessResult = await experienceAccess(user.id, organizationId);
  if ("error" in accessResult) return accessResult.error;
  const { access } = accessResult;

  const [
    staff,
    units,
    strategicRows,
    employeeGoals,
    alignmentRows,
    seriesRows,
    meetingRows,
    actionRows,
    roundRows,
    requestRows,
    mentorshipRows,
    cycles,
    assignments,
    positionRows,
  ] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
    db.select().from(strategicGoals).where(eq(strategicGoals.organizationId, organizationId)).orderBy(desc(strategicGoals.id)),
    db.select().from(performanceGoals).where(eq(performanceGoals.organizationId, organizationId)).orderBy(desc(performanceGoals.id)),
    db.select().from(performanceGoalAlignments).where(eq(performanceGoalAlignments.organizationId, organizationId)),
    db.select().from(oneOnOneSeries).where(eq(oneOnOneSeries.organizationId, organizationId)).orderBy(desc(oneOnOneSeries.id)),
    db.select().from(oneOnOneMeetings).where(eq(oneOnOneMeetings.organizationId, organizationId)).orderBy(desc(oneOnOneMeetings.scheduledDate)),
    db.select().from(oneOnOneActionItems).where(eq(oneOnOneActionItems.organizationId, organizationId)).orderBy(desc(oneOnOneActionItems.id)),
    db.select().from(feedbackRounds).where(eq(feedbackRounds.organizationId, organizationId)).orderBy(desc(feedbackRounds.id)),
    db.select().from(feedbackRequests).where(eq(feedbackRequests.organizationId, organizationId)).orderBy(desc(feedbackRequests.id)),
    db.select().from(mentorships).where(eq(mentorships.organizationId, organizationId)).orderBy(desc(mentorships.id)),
    db.select().from(performanceCycles).where(eq(performanceCycles.organizationId, organizationId)).orderBy(desc(performanceCycles.startDate)),
    db.select().from(positionAssignments).where(and(eq(positionAssignments.organizationId, organizationId), isNull(positionAssignments.effectiveUntil))),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
  ]);

  const visibleEmployees = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));
  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));
  const visibleGoals = employeeGoals.filter((goal) => visibleIds.has(goal.employeeId));
  const visibleGoalIds = new Set(visibleGoals.map((goal) => goal.id));
  const visibleStrategic = strategicRows.filter((goal) =>
    access.companyWide || goal.scope === "company" || goal.orgUnitId === access.orgUnitId
  );
  const visibleStrategicIds = new Set(visibleStrategic.map((goal) => goal.id));

  const visibleSeries = seriesRows.filter((series) => visibleIds.has(series.employeeId));
  const visibleSeriesIds = new Set(visibleSeries.map((series) => series.id));
  const visibleMeetings = meetingRows.filter((meeting) => visibleSeriesIds.has(meeting.seriesId));
  const visibleMeetingIds = new Set(visibleMeetings.map((meeting) => meeting.id));

  const visibleRounds = roundRows.filter((round) => visibleIds.has(round.subjectEmployeeId));
  const visibleRoundIds = new Set(visibleRounds.map((round) => round.id));
  const activePositionByEmployee = new Map<number, typeof positionRows[number]>();
  const positionById = new Map(positionRows.map((position) => [position.id, position]));
  for (const assignment of assignments) {
    const position = positionById.get(assignment.positionId);
    if (position) activePositionByEmployee.set(assignment.employeeId, position);
  }

  return Response.json({
    access,
    currentEmployeeId: user.employeeId ?? null,
    orgUnits: access.companyWide ? units : units.filter((unit) => unit.id === access.orgUnitId),
    employees: visibleEmployees.map((employee) => ({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      title: employee.title,
      orgUnitId: employee.orgUnitId,
      status: employee.status,
    })),
    allActiveEmployees: access.companyWide
      ? staff.filter((employee) => employee.status === "Active").map((employee) => ({
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          title: employee.title,
          orgUnitId: employee.orgUnitId,
        }))
      : visibleEmployees.filter((employee) => employee.status === "Active").map((employee) => ({
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          title: employee.title,
          orgUnitId: employee.orgUnitId,
        })),
    cycles,
    strategicGoals: visibleStrategic,
    employeeGoals: visibleGoals,
    alignments: alignmentRows.filter((row) => visibleGoalIds.has(row.performanceGoalId) && visibleStrategicIds.has(row.strategicGoalId)),
    oneOnOneSeries: visibleSeries,
    oneOnOneMeetings: visibleMeetings.map((meeting) => {
      const series = seriesRows.find((row) => row.id === meeting.seriesId);
      const maySeePrivate = Boolean(user.employeeId && series?.managerEmployeeId === user.employeeId);
      return {
        ...meeting,
        managerPrivateNotes: maySeePrivate ? meeting.managerPrivateNotes : null,
      };
    }),
    oneOnOneActionItems: actionRows.filter((row) => visibleMeetingIds.has(row.meetingId)),
    feedbackRounds: visibleRounds,
    feedbackRequests: requestRows.filter((request) => visibleRoundIds.has(request.roundId)).map((request) => {
      const round = roundRows.find((row) => row.id === request.roundId);
      const managerEmployeeId = round ? activePositionByEmployee.get(round.subjectEmployeeId)?.managerEmployeeId ?? null : null;
      const maySeeResponse = Boolean(
        user.employeeId
        && round
        && (round.subjectEmployeeId === user.employeeId || managerEmployeeId === user.employeeId || request.reviewerEmployeeId === user.employeeId)
      );
      return {
        ...request,
        responseText: maySeeResponse ? request.responseText : null,
      };
    }),
    mentorships: mentorshipRows.filter((row) => visibleIds.has(row.menteeEmployeeId) || visibleIds.has(row.mentorEmployeeId)),
    employeeNames: Object.fromEntries(staff.map((employee) => [employee.id, employee.firstName + " " + employee.lastName])),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const accessResult = await experienceAccess(user.id, organizationId);
  if ("error" in accessResult) return accessResult.error;
  const { access } = accessResult;

  if (entityType === "strategic_goal") {
    const scope = String(body.scope ?? "team");
    const requestedUnitId = body.orgUnitId ? Number(body.orgUnitId) : null;
    const orgUnitId = scope === "company" ? null : (access.companyWide ? requestedUnitId : access.orgUnitId);
    const ownerEmployeeId = body.ownerEmployeeId ? Number(body.ownerEmployeeId) : null;
    const cycleId = body.cycleId ? Number(body.cycleId) : null;
    const title = String(body.title ?? "").trim();
    const dueDate = body.dueDate ? String(body.dueDate) : null;

    if (!(STRATEGIC_SCOPES as readonly string[]).includes(scope) || !title || (dueDate && !isIsoDate(dueDate))) {
      return Response.json({ error: "scope, title, and optional YYYY-MM-DD dueDate are required." }, { status: 400 });
    }
    if (scope === "company" && !access.companyWide) {
      return Response.json({ error: "Company goals require company-wide access." }, { status: 403 });
    }
    if (scope === "team" && !orgUnitId) {
      return Response.json({ error: "Team goals require an organization unit." }, { status: 400 });
    }
    if (orgUnitId) {
      const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
        eq(orgUnits.id, orgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1);
      if (!unit) return Response.json({ error: "Goal organization unit not found in this workspace." }, { status: 404 });
      if (!access.companyWide && orgUnitId !== access.orgUnitId) {
        return Response.json({ error: "Team goal is outside your assigned organization unit." }, { status: 403 });
      }
    }
    if (cycleId) {
      const [cycle] = await db.select({ id: performanceCycles.id }).from(performanceCycles).where(and(
        eq(performanceCycles.id, cycleId),
        eq(performanceCycles.organizationId, organizationId),
      )).limit(1);
      if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });
    }
    if (ownerEmployeeId) {
      const scoped = await scopedEmployee(user.id, organizationId, ownerEmployeeId);
      if ("error" in scoped) return scoped.error;
      if (orgUnitId && scoped.employee.orgUnitId !== orgUnitId) {
        return Response.json({ error: "Goal owner must belong to the selected team." }, { status: 409 });
      }
    }

    const [row] = await db.insert(strategicGoals).values({
      organizationId,
      cycleId,
      orgUnitId,
      ownerEmployeeId,
      scope,
      title: title.slice(0, 200),
      description: limitedText(body.description, 8000),
      progress: 0,
      status: "active",
      dueDate,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Strategic goal created",
      resource: row.title,
      metadata: { strategicGoalId: row.id, scope, orgUnitId, ownerEmployeeId, cycleId },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "goal_alignment") {
    const performanceGoalId = Number(body.performanceGoalId);
    const strategicGoalId = Number(body.strategicGoalId);
    const contributionWeight = Number(body.contributionWeight ?? 100);
    if (!Number.isInteger(performanceGoalId) || !Number.isInteger(strategicGoalId) || !Number.isInteger(contributionWeight) || contributionWeight < 1 || contributionWeight > 100) {
      return Response.json({ error: "performanceGoalId, strategicGoalId, and contributionWeight from 1 to 100 are required." }, { status: 400 });
    }

    const [employeeGoal] = await db.select().from(performanceGoals).where(and(
      eq(performanceGoals.id, performanceGoalId),
      eq(performanceGoals.organizationId, organizationId),
    )).limit(1);
    if (!employeeGoal) return Response.json({ error: "Employee goal not found." }, { status: 404 });
    const scoped = await scopedEmployee(user.id, organizationId, employeeGoal.employeeId);
    if ("error" in scoped) return scoped.error;

    const [strategicGoal] = await db.select().from(strategicGoals).where(and(
      eq(strategicGoals.id, strategicGoalId),
      eq(strategicGoals.organizationId, organizationId),
    )).limit(1);
    if (!strategicGoal) return Response.json({ error: "Strategic goal not found." }, { status: 404 });
    if (!access.companyWide && strategicGoal.scope !== "company" && strategicGoal.orgUnitId !== access.orgUnitId) {
      return Response.json({ error: "Strategic goal is outside your assigned organization unit." }, { status: 403 });
    }

    const [row] = await db.insert(performanceGoalAlignments).values({
      organizationId,
      performanceGoalId,
      strategicGoalId,
      contributionWeight,
      createdByUserId: user.id,
    }).onConflictDoUpdate({
      target: [performanceGoalAlignments.performanceGoalId, performanceGoalAlignments.strategicGoalId],
      set: { contributionWeight },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee goal aligned",
      resource: employeeGoal.title,
      metadata: { alignmentId: row.id, performanceGoalId, strategicGoalId, contributionWeight },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "one_on_one_series") {
    const employeeId = Number(body.employeeId);
    const requestedManagerId = body.managerEmployeeId ? Number(body.managerEmployeeId) : null;
    const cadence = String(body.cadence ?? "biweekly") as OneOnOneCadence;
    const firstMeetingDate = String(body.firstMeetingDate ?? "");
    if (!Number.isInteger(employeeId) || !(ONE_ON_ONE_CADENCES as readonly string[]).includes(cadence) || !isIsoDate(firstMeetingDate)) {
      return Response.json({ error: "employeeId, valid cadence, and firstMeetingDate are required." }, { status: 400 });
    }

    const target = await scopedEmployee(user.id, organizationId, employeeId);
    if ("error" in target) return target.error;
    const managerEmployeeId = access.role === "manager" ? user.employeeId : (requestedManagerId ?? user.employeeId);
    if (!managerEmployeeId) {
      return Response.json({ error: "A linked manager employee profile is required for a one-on-one series." }, { status: 409 });
    }
    if (managerEmployeeId === employeeId) return Response.json({ error: "A one-on-one requires two different employees." }, { status: 400 });

    const [manager] = await db.select().from(employees).where(and(
      eq(employees.id, managerEmployeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.status, "Active"),
    )).limit(1);
    if (!manager) return Response.json({ error: "Manager employee profile not found or inactive." }, { status: 404 });
    if (!access.companyWide && manager.orgUnitId !== access.orgUnitId) {
      return Response.json({ error: "Manager must belong to your assigned organization unit." }, { status: 403 });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [series] = await tx.insert(oneOnOneSeries).values({
          organizationId,
          managerEmployeeId,
          employeeId,
          cadence,
          agendaTemplate: limitedText(body.agendaTemplate, 4000),
          active: true,
          createdByUserId: user.id,
        }).returning();
        const [meeting] = await tx.insert(oneOnOneMeetings).values({
          organizationId,
          seriesId: series.id,
          scheduledDate: firstMeetingDate,
          status: "scheduled",
        }).returning();
        return { series, meeting };
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Recurring one-on-one created",
        resource: target.employee.firstName + " " + target.employee.lastName,
        metadata: { seriesId: result.series.id, meetingId: result.meeting.id, managerEmployeeId, employeeId, cadence, firstMeetingDate },
      });
      return Response.json(result, { status: 201 });
    } catch {
      return Response.json({ error: "A recurring one-on-one already exists for this manager and employee." }, { status: 409 });
    }
  }

  if (entityType === "one_on_one_action") {
    const meetingId = Number(body.meetingId);
    const ownerEmployeeId = body.ownerEmployeeId ? Number(body.ownerEmployeeId) : null;
    const title = String(body.title ?? "").trim();
    const dueDate = body.dueDate ? String(body.dueDate) : null;
    if (!Number.isInteger(meetingId) || !title || (dueDate && !isIsoDate(dueDate))) {
      return Response.json({ error: "meetingId, title, and optional YYYY-MM-DD dueDate are required." }, { status: 400 });
    }
    const [meeting] = await db.select().from(oneOnOneMeetings).where(and(
      eq(oneOnOneMeetings.id, meetingId),
      eq(oneOnOneMeetings.organizationId, organizationId),
    )).limit(1);
    if (!meeting) return Response.json({ error: "One-on-one meeting not found." }, { status: 404 });
    const [series] = await db.select().from(oneOnOneSeries).where(eq(oneOnOneSeries.id, meeting.seriesId)).limit(1);
    if (!series) return Response.json({ error: "One-on-one series is missing." }, { status: 409 });
    const scoped = await scopedEmployee(user.id, organizationId, series.employeeId);
    if ("error" in scoped) return scoped.error;
    if (!user.employeeId || series.managerEmployeeId !== user.employeeId) {
      return Response.json({ error: "Only the assigned manager can add one-on-one action items." }, { status: 403 });
    }
    if (ownerEmployeeId && ![series.employeeId, series.managerEmployeeId].includes(ownerEmployeeId)) {
      return Response.json({ error: "One-on-one action owner must be one of the meeting participants." }, { status: 409 });
    }

    const [row] = await db.insert(oneOnOneActionItems).values({
      organizationId,
      meetingId,
      ownerEmployeeId,
      title: title.slice(0, 240),
      dueDate,
      status: "open",
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "One-on-one action item created",
      resource: row.title,
      metadata: { actionItemId: row.id, meetingId, ownerEmployeeId },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "feedback_round") {
    const subjectEmployeeId = Number(body.subjectEmployeeId);
    const title = String(body.title ?? "").trim();
    const prompt = String(body.prompt ?? "").trim();
    const dueDate = body.dueDate ? String(body.dueDate) : null;
    const rawReviewers = Array.isArray(body.reviewers) ? body.reviewers : [];
    if (!Number.isInteger(subjectEmployeeId) || !title || !prompt || (dueDate && !isIsoDate(dueDate)) || rawReviewers.length < 1 || rawReviewers.length > 12) {
      return Response.json({ error: "subjectEmployeeId, title, prompt, optional dueDate, and 1-12 reviewers are required." }, { status: 400 });
    }
    const subject = await scopedEmployee(user.id, organizationId, subjectEmployeeId);
    if ("error" in subject) return subject.error;

    const reviewers: Array<{ employeeId: number; relationship: string }> = [];
    const seen = new Set<number>();
    for (const raw of rawReviewers) {
      const employeeId = Number(raw?.employeeId);
      const relationship = String(raw?.relationship ?? "peer");
      if (!Number.isInteger(employeeId) || employeeId === subjectEmployeeId || seen.has(employeeId) || !(FEEDBACK_RELATIONSHIPS as readonly string[]).includes(relationship)) {
        return Response.json({ error: "Each 360 reviewer must be unique, valid, not the subject, and have a valid relationship." }, { status: 400 });
      }
      const [reviewer] = await db.select({ id: employees.id }).from(employees).where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
        eq(employees.status, "Active"),
      )).limit(1);
      if (!reviewer) return Response.json({ error: "A selected feedback reviewer is not an active employee." }, { status: 404 });
      seen.add(employeeId);
      reviewers.push({ employeeId, relationship });
    }

    const result = await db.transaction(async (tx) => {
      const [round] = await tx.insert(feedbackRounds).values({
        organizationId,
        subjectEmployeeId,
        title: title.slice(0, 180),
        prompt: prompt.slice(0, 4000),
        dueDate,
        status: "open",
        createdByEmployeeId: user.employeeId ?? null,
        createdByUserId: user.id,
      }).returning();
      const requests = await tx.insert(feedbackRequests).values(reviewers.map((reviewer) => ({
        organizationId,
        roundId: round.id,
        reviewerEmployeeId: reviewer.employeeId,
        relationship: reviewer.relationship,
        status: "requested",
      }))).returning();
      return { round, requests };
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "360 feedback round opened",
      resource: subject.employee.firstName + " " + subject.employee.lastName,
      metadata: { roundId: result.round.id, subjectEmployeeId, reviewerCount: result.requests.length },
    });
    return Response.json(result, { status: 201 });
  }

  if (entityType === "mentorship") {
    const mentorEmployeeId = Number(body.mentorEmployeeId);
    const menteeEmployeeId = Number(body.menteeEmployeeId);
    const goal = String(body.goal ?? "").trim();
    const cadence = String(body.cadence ?? "monthly");
    if (!Number.isInteger(mentorEmployeeId) || !Number.isInteger(menteeEmployeeId) || mentorEmployeeId === menteeEmployeeId || !goal || !(ONE_ON_ONE_CADENCES as readonly string[]).includes(cadence)) {
      return Response.json({ error: "Two different employees, a goal, and a valid cadence are required." }, { status: 400 });
    }
    const mentee = await scopedEmployee(user.id, organizationId, menteeEmployeeId);
    if ("error" in mentee) return mentee.error;
    const [mentor] = await db.select().from(employees).where(and(
      eq(employees.id, mentorEmployeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.status, "Active"),
    )).limit(1);
    if (!mentor) return Response.json({ error: "Mentor employee profile not found or inactive." }, { status: 404 });

    const [row] = await db.insert(mentorships).values({
      organizationId,
      mentorEmployeeId,
      menteeEmployeeId,
      requestedByEmployeeId: user.employeeId ?? null,
      goal: goal.slice(0, 500),
      cadence,
      status: "active",
      startDate: isIsoDate(body.startDate) ? body.startDate : null,
      notes: limitedText(body.notes, 4000),
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Mentorship assigned",
      resource: mentee.employee.firstName + " " + mentee.employee.lastName,
      metadata: { mentorshipId: row.id, mentorEmployeeId, menteeEmployeeId, cadence },
    });
    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "Unsupported experience entityType." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const accessResult = await experienceAccess(user.id, organizationId);
  if ("error" in accessResult) return accessResult.error;
  const { access } = accessResult;

  if (action === "strategic_goal") {
    const id = Number(body.id);
    const progress = body.progress === undefined ? undefined : boundedProgress(body.progress);
    const status = body.status === undefined ? undefined : String(body.status);
    if (!Number.isInteger(id) || (body.progress !== undefined && progress === null) || (status !== undefined && !(GOAL_STATUSES as readonly string[]).includes(status))) {
      return Response.json({ error: "Valid strategic goal id, progress, and status are required." }, { status: 400 });
    }
    const [goal] = await db.select().from(strategicGoals).where(and(
      eq(strategicGoals.id, id),
      eq(strategicGoals.organizationId, organizationId),
    )).limit(1);
    if (!goal) return Response.json({ error: "Strategic goal not found." }, { status: 404 });
    if (!access.companyWide && goal.scope === "company") return Response.json({ error: "Company goals require company-wide access to edit." }, { status: 403 });
    if (!access.companyWide && goal.orgUnitId !== access.orgUnitId) return Response.json({ error: "Goal is outside your assigned organization unit." }, { status: 403 });

    const [row] = await db.update(strategicGoals).set({
      progress: progress ?? goal.progress,
      status: status ?? goal.status,
      updatedAt: new Date(),
    }).where(eq(strategicGoals.id, id)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Strategic goal updated", resource: row.title, metadata: { strategicGoalId: id, progress: row.progress, status: row.status } });
    return Response.json(row);
  }

  if (action === "one_on_one_meeting") {
    const meetingId = Number(body.meetingId);
    const status = String(body.status ?? "scheduled");
    if (!Number.isInteger(meetingId) || !(MEETING_STATUSES as readonly string[]).includes(status)) {
      return Response.json({ error: "meetingId and a valid meeting status are required." }, { status: 400 });
    }
    const [meeting] = await db.select().from(oneOnOneMeetings).where(and(
      eq(oneOnOneMeetings.id, meetingId),
      eq(oneOnOneMeetings.organizationId, organizationId),
    )).limit(1);
    if (!meeting) return Response.json({ error: "One-on-one meeting not found." }, { status: 404 });
    const [series] = await db.select().from(oneOnOneSeries).where(eq(oneOnOneSeries.id, meeting.seriesId)).limit(1);
    if (!series) return Response.json({ error: "One-on-one series is missing." }, { status: 409 });
    const scoped = await scopedEmployee(user.id, organizationId, series.employeeId);
    if ("error" in scoped) return scoped.error;
    if (!user.employeeId || series.managerEmployeeId !== user.employeeId) {
      return Response.json({ error: "Only the assigned manager can update or complete this one-on-one." }, { status: 403 });
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(oneOnOneMeetings).set({
        status,
        managerUpdate: body.managerUpdate === undefined ? meeting.managerUpdate : limitedText(body.managerUpdate, 8000),
        sharedNotes: body.sharedNotes === undefined ? meeting.sharedNotes : limitedText(body.sharedNotes, 8000),
        managerPrivateNotes: body.managerPrivateNotes === undefined ? meeting.managerPrivateNotes : limitedText(body.managerPrivateNotes, 8000),
        completedAt: status === "completed" ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(oneOnOneMeetings.id, meetingId)).returning();

      let nextMeeting = null;
      if (status === "completed" && series.active && meeting.status !== "completed") {
        const nextDate = nextCadenceDate(meeting.scheduledDate, series.cadence as OneOnOneCadence);
        const inserted = await tx.insert(oneOnOneMeetings).values({
          organizationId,
          seriesId: series.id,
          scheduledDate: nextDate,
          status: "scheduled",
        }).onConflictDoNothing({
          target: [oneOnOneMeetings.seriesId, oneOnOneMeetings.scheduledDate],
        }).returning();
        nextMeeting = inserted[0] ?? null;
      }
      return { meeting: updated, nextMeeting };
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: status === "completed" ? "One-on-one completed" : "One-on-one updated",
      resource: "One-on-one #" + meetingId,
      metadata: { meetingId, seriesId: series.id, employeeId: series.employeeId, status, nextMeetingId: result.nextMeeting?.id ?? null },
    });
    return Response.json(result);
  }

  if (action === "one_on_one_action_status") {
    const actionItemId = Number(body.actionItemId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(actionItemId) || !(ACTION_STATUSES as readonly string[]).includes(status)) {
      return Response.json({ error: "actionItemId and valid status are required." }, { status: 400 });
    }
    const [item] = await db.select().from(oneOnOneActionItems).where(and(
      eq(oneOnOneActionItems.id, actionItemId),
      eq(oneOnOneActionItems.organizationId, organizationId),
    )).limit(1);
    if (!item) return Response.json({ error: "One-on-one action item not found." }, { status: 404 });
    const [meeting] = await db.select().from(oneOnOneMeetings).where(eq(oneOnOneMeetings.id, item.meetingId)).limit(1);
    const [series] = meeting ? await db.select().from(oneOnOneSeries).where(eq(oneOnOneSeries.id, meeting.seriesId)).limit(1) : [];
    if (!meeting || !series) return Response.json({ error: "One-on-one context is missing." }, { status: 409 });
    const scoped = await scopedEmployee(user.id, organizationId, series.employeeId);
    if ("error" in scoped) return scoped.error;
    if (!user.employeeId || series.managerEmployeeId !== user.employeeId) {
      return Response.json({ error: "Only the assigned manager can update one-on-one action items." }, { status: 403 });
    }

    const [row] = await db.update(oneOnOneActionItems).set({ status, updatedAt: new Date() }).where(eq(oneOnOneActionItems.id, actionItemId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "One-on-one action item updated", resource: item.title, metadata: { actionItemId, status } });
    return Response.json(row);
  }

  if (action === "feedback_round_close") {
    const roundId = Number(body.roundId);
    if (!Number.isInteger(roundId)) return Response.json({ error: "roundId is required." }, { status: 400 });
    const [round] = await db.select().from(feedbackRounds).where(and(
      eq(feedbackRounds.id, roundId),
      eq(feedbackRounds.organizationId, organizationId),
    )).limit(1);
    if (!round) return Response.json({ error: "Feedback round not found." }, { status: 404 });
    const scoped = await scopedEmployee(user.id, organizationId, round.subjectEmployeeId);
    if ("error" in scoped) return scoped.error;
    const [row] = await db.update(feedbackRounds).set({ status: "closed", updatedAt: new Date() }).where(eq(feedbackRounds.id, roundId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "360 feedback round closed", resource: round.title, metadata: { roundId, subjectEmployeeId: round.subjectEmployeeId } });
    return Response.json(row);
  }

  if (action === "mentorship_status") {
    const mentorshipId = Number(body.mentorshipId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(mentorshipId) || !(MENTORSHIP_STATUSES as readonly string[]).includes(status)) {
      return Response.json({ error: "mentorshipId and valid status are required." }, { status: 400 });
    }
    const [mentorship] = await db.select().from(mentorships).where(and(
      eq(mentorships.id, mentorshipId),
      eq(mentorships.organizationId, organizationId),
    )).limit(1);
    if (!mentorship) return Response.json({ error: "Mentorship not found." }, { status: 404 });
    const scoped = await scopedEmployee(user.id, organizationId, mentorship.menteeEmployeeId);
    if ("error" in scoped) return scoped.error;
    const [row] = await db.update(mentorships).set({
      status,
      startDate: status === "active" && !mentorship.startDate ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()) : mentorship.startDate,
      endDate: ["completed", "cancelled", "declined"].includes(status) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()) : mentorship.endDate,
      updatedAt: new Date(),
    }).where(eq(mentorships.id, mentorshipId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Mentorship status changed", resource: "Mentorship #" + mentorshipId, metadata: { mentorshipId, status } });
    return Response.json(row);
  }

  return Response.json({ error: "Unsupported experience action." }, { status: 400 });
}
