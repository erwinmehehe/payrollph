import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  orgUnits,
  performanceCalibrationEntries,
  performanceCalibrationFlags,
  performanceCalibrationSessions,
  performanceCycles,
  performanceFeedback,
  performanceGoals,
  performanceOneOnOnes,
  performanceReminderTasks,
  performanceReviewItems,
  performanceReviews,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  roleAllowed,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function ratingBucket(value: number) {
  if (value < 2) return "1.00–1.99";
  if (value < 3) return "2.00–2.99";
  if (value < 4) return "3.00–3.99";
  if (value < 4.5) return "4.00–4.49";
  return "4.50–5.00";
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const requestedCycleId = Number(url.searchParams.get("cycleId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to view performance analytics.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const companyPeopleAdmin = access.companyWide && roleAllowed(access.role, PEOPLE_ADMIN_ROLES);

  const [cycles, staff, units, memberships] = await Promise.all([
    db.select().from(performanceCycles)
      .where(eq(performanceCycles.organizationId, organizationId))
      .orderBy(desc(performanceCycles.startDate)),
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      orgUnitId: employees.orgUnitId,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      id: orgUnits.id,
      name: orgUnits.name,
    }).from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
    db.select({
      userId: users.id,
      name: users.name,
      role: userOrganizations.role,
    })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
        eq(users.active, true),
      )),
  ]);

  const cycle = Number.isInteger(requestedCycleId)
    ? cycles.find((item) => item.id === requestedCycleId) ?? null
    : cycles.find((item) => item.status === "active") ?? cycles[0] ?? null;
  if (!cycle) {
    return Response.json({
      cycle: null,
      summary: {
        completionRate: 0,
        completedReviews: 0,
        totalReviews: 0,
        averageFinalScore: null,
        goalAttainment: 0,
        oneOnOneCoverage: 0,
        openReminders: 0,
        overdueReminders: 0,
      },
      byManager: [],
      byOrgUnit: [],
      ratingDistribution: [],
      cycleTrends: [],
      activity: { completedOneOnOnes: 0, feedbackEntries: 0 },
      calibration: null,
    });
  }

  const visibleEmployees = access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));
  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  const userName = new Map(memberships.map((membership) => [membership.userId, membership.name]));

  const [allReviews, allGoals, allMeetings, allFeedback, allReminders, allReviewItems, calibrationSessions] = await Promise.all([
    db.select().from(performanceReviews)
      .where(eq(performanceReviews.organizationId, organizationId)),
    db.select().from(performanceGoals)
      .where(eq(performanceGoals.organizationId, organizationId)),
    db.select().from(performanceOneOnOnes)
      .where(eq(performanceOneOnOnes.organizationId, organizationId)),
    db.select().from(performanceFeedback)
      .where(eq(performanceFeedback.organizationId, organizationId)),
    db.select().from(performanceReminderTasks).where(and(
      eq(performanceReminderTasks.organizationId, organizationId),
      eq(performanceReminderTasks.cycleId, cycle.id),
    )),
    db.select().from(performanceReviewItems)
      .where(eq(performanceReviewItems.organizationId, organizationId)),
    companyPeopleAdmin
      ? db.select().from(performanceCalibrationSessions).where(and(
          eq(performanceCalibrationSessions.organizationId, organizationId),
          eq(performanceCalibrationSessions.cycleId, cycle.id),
        ))
      : Promise.resolve([]),
  ]);

  const visibleReviews = allReviews.filter((review) => visibleEmployeeIds.has(review.employeeId));
  const reviews = visibleReviews.filter((review) => review.cycleId === cycle.id);
  const goals = allGoals.filter((goal) =>
    goal.cycleId === cycle.id
    && (
      goal.scope === "company"
      || (goal.scope === "team" && (access.companyWide || goal.orgUnitId === access.orgUnitId))
      || (goal.employeeId != null && visibleEmployeeIds.has(goal.employeeId))
    )
  );
  const reminders = allReminders.filter((task) => visibleEmployeeIds.has(task.employeeId));
  const cycleStart = Date.parse(cycle.startDate + "T00:00:00Z");
  const cycleEnd = Date.parse(cycle.endDate + "T23:59:59Z");
  const meetings = allMeetings.filter((meeting) =>
    visibleEmployeeIds.has(meeting.employeeId)
    && meeting.completedAt
    && meeting.completedAt.getTime() >= cycleStart
    && meeting.completedAt.getTime() <= cycleEnd,
  );
  const feedback = allFeedback.filter((item) =>
    visibleEmployeeIds.has(item.employeeId)
    && item.occurredAt.getTime() >= cycleStart
    && item.occurredAt.getTime() <= cycleEnd,
  );

  const reviewIds = new Set(reviews.map((review) => review.id));
  const competencyItems = allReviewItems
    .filter((item) => reviewIds.has(item.reviewId) && item.expectedProficiency != null && item.finalScore != null);
  const belowRoleExpectation = competencyItems.filter((item) =>
    Number(item.finalScore) < Number(item.expectedProficiency)
  );

  const completed = reviews.filter((review) => review.status === "completed");
  const scores = completed
    .map((review) => review.finalScore == null ? null : Number(review.finalScore))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const averageFinalScore = scores.length
    ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100) / 100
    : null;

  const employeeGoals = goals.filter((goal) => goal.scope === "employee");
  const goalAttainment = employeeGoals.length
    ? Math.round((employeeGoals.reduce((sum, goal) => sum + goal.progress, 0) / employeeGoals.length) * 10) / 10
    : 0;

  const completedMeetingEmployeeIds = new Set(meetings.map((meeting) => meeting.employeeId));
  const activeVisibleEmployees = visibleEmployees.filter((employee) => employee.status.toLowerCase() === "active");
  const openReminders = reminders.filter((task) => task.status === "open");
  const overdueReminders = openReminders.filter((task) => task.stage.startsWith("overdue"));

  const managerGroups = new Map<number | null, typeof reviews>();
  for (const review of reviews) {
    const key = review.reviewerUserId ?? null;
    const group = managerGroups.get(key) ?? [];
    group.push(review);
    managerGroups.set(key, group);
  }
  const byManager = [...managerGroups.entries()].map(([managerUserId, rows]) => {
    const done = rows.filter((row) => row.status === "completed");
    const managerScores = done
      .map((row) => row.finalScore == null ? null : Number(row.finalScore))
      .filter((value): value is number => value != null && Number.isFinite(value));
    return {
      managerUserId,
      managerName: managerUserId ? userName.get(managerUserId) ?? "Unknown manager" : "Unassigned reviewer",
      totalReviews: rows.length,
      completedReviews: done.length,
      completionRate: percentage(done.length, rows.length),
      averageFinalScore: managerScores.length
        ? Math.round((managerScores.reduce((sum, value) => sum + value, 0) / managerScores.length) * 100) / 100
        : null,
    };
  }).sort((left, right) => left.completionRate - right.completionRate || right.totalReviews - left.totalReviews);

  const unitGroups = new Map<number | null, typeof reviews>();
  for (const review of reviews) {
    const orgUnitId = employeeById.get(review.employeeId)?.orgUnitId ?? null;
    const group = unitGroups.get(orgUnitId) ?? [];
    group.push(review);
    unitGroups.set(orgUnitId, group);
  }
  const byOrgUnit = [...unitGroups.entries()].map(([orgUnitId, rows]) => {
    const done = rows.filter((row) => row.status === "completed");
    const unitScores = done
      .map((row) => row.finalScore == null ? null : Number(row.finalScore))
      .filter((value): value is number => value != null && Number.isFinite(value));
    return {
      orgUnitId,
      orgUnitName: orgUnitId ? unitName.get(orgUnitId) ?? "Unknown org unit" : "Unassigned org unit",
      totalReviews: rows.length,
      completedReviews: done.length,
      completionRate: percentage(done.length, rows.length),
      averageFinalScore: unitScores.length
        ? Math.round((unitScores.reduce((sum, value) => sum + value, 0) / unitScores.length) * 100) / 100
        : null,
    };
  }).sort((left, right) => left.completionRate - right.completionRate || right.totalReviews - left.totalReviews);

  const bucketCounts = new Map<string, number>();
  for (const value of scores) {
    const bucket = ratingBucket(value);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const bucketOrder = ["1.00–1.99", "2.00–2.99", "3.00–3.99", "4.00–4.49", "4.50–5.00"];
  const ratingDistribution = bucketOrder.map((bucket) => ({
    bucket,
    count: bucketCounts.get(bucket) ?? 0,
    percentage: percentage(bucketCounts.get(bucket) ?? 0, scores.length),
  }));

  const trendCycles = cycles
    .filter((item) => item.status === "completed")
    .slice()
    .sort((left, right) => left.startDate.localeCompare(right.startDate));

  const cycleTrends = trendCycles.map((trendCycle) => {
    const trendReviews = visibleReviews.filter((review) => review.cycleId === trendCycle.id);
    const trendCompleted = trendReviews.filter((review) => review.status === "completed");
    const trendScores = trendCompleted
      .map((review) => review.finalScore == null ? null : Number(review.finalScore))
      .filter((value): value is number => value != null && Number.isFinite(value));
    const trendSelfScores = trendCompleted
      .map((review) => review.selfScore == null ? null : Number(review.selfScore))
      .filter((value): value is number => value != null && Number.isFinite(value));
    const trendManagerScores = trendCompleted
      .map((review) => review.managerScore == null ? null : Number(review.managerScore))
      .filter((value): value is number => value != null && Number.isFinite(value));
    const trendGoals = allGoals.filter((goal) =>
      goal.cycleId === trendCycle.id
      && goal.scope === "employee"
      && goal.employeeId != null
      && visibleEmployeeIds.has(goal.employeeId)
    );
    const trendReviewIds = new Set(trendReviews.map((review) => review.id));
    const trendCompetencies = allReviewItems.filter((item) =>
      trendReviewIds.has(item.reviewId)
      && item.expectedProficiency != null
      && item.finalScore != null
    );
    const trendBelowExpectation = trendCompetencies.filter((item) =>
      Number(item.finalScore) < Number(item.expectedProficiency)
    );
    const average = (values: number[]) => values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
      : null;

    return {
      cycleId: trendCycle.id,
      cycleName: trendCycle.name,
      startDate: trendCycle.startDate,
      endDate: trendCycle.endDate,
      completedAt: trendCycle.completedAt,
      totalReviews: trendReviews.length,
      completedReviews: trendCompleted.length,
      completionRate: percentage(trendCompleted.length, trendReviews.length),
      averageFinalScore: average(trendScores),
      averageSelfScore: average(trendSelfScores),
      averageManagerScore: average(trendManagerScores),
      goalAttainment: trendGoals.length
        ? Math.round((trendGoals.reduce((sum, goal) => sum + goal.progress, 0) / trendGoals.length) * 10) / 10
        : 0,
      competencyItems: trendCompetencies.length,
      belowRoleExpectation: trendBelowExpectation.length,
      roleExpectationGapRate: percentage(trendBelowExpectation.length, trendCompetencies.length),
    };
  }).map((row, index, rows) => {
    const previous = index > 0 ? rows[index - 1] : null;
    return {
      ...row,
      finalScoreDelta:
        previous?.averageFinalScore != null && row.averageFinalScore != null
          ? Math.round((row.averageFinalScore - previous.averageFinalScore) * 100) / 100
          : null,
      goalAttainmentDelta:
        previous
          ? Math.round((row.goalAttainment - previous.goalAttainment) * 10) / 10
          : null,
      roleExpectationGapRateDelta:
        previous
          ? Math.round((row.roleExpectationGapRate - previous.roleExpectationGapRate) * 10) / 10
          : null,
    };
  });

  let calibration: null | {
    status: string;
    changedRatings: number;
    totalRatings: number;
    openFlags: number;
    acceptedFlags: number;
    resolvedFlags: number;
  } = null;
  if (companyPeopleAdmin && calibrationSessions[0]) {
    const [entries, flags] = await Promise.all([
      db.select().from(performanceCalibrationEntries).where(and(
        eq(performanceCalibrationEntries.organizationId, organizationId),
        eq(performanceCalibrationEntries.sessionId, calibrationSessions[0].id),
      )),
      db.select().from(performanceCalibrationFlags).where(and(
        eq(performanceCalibrationFlags.organizationId, organizationId),
        eq(performanceCalibrationFlags.sessionId, calibrationSessions[0].id),
      )),
    ]);
    calibration = {
      status: calibrationSessions[0].status,
      changedRatings: entries.filter((entry) =>
        entry.calibratedScore != null
        && Math.abs(Number(entry.calibratedScore) - Number(entry.originalScore)) > 0.001
      ).length,
      totalRatings: entries.length,
      openFlags: flags.filter((flag) => flag.status === "open").length,
      acceptedFlags: flags.filter((flag) => flag.status === "accepted").length,
      resolvedFlags: flags.filter((flag) => flag.status === "resolved").length,
    };
  }

  return Response.json({
    cycle,
    summary: {
      completionRate: percentage(completed.length, reviews.length),
      completedReviews: completed.length,
      totalReviews: reviews.length,
      averageFinalScore,
      goalAttainment,
      oneOnOneCoverage: percentage(completedMeetingEmployeeIds.size, activeVisibleEmployees.length),
      openReminders: openReminders.length,
      overdueReminders: overdueReminders.length,
      roleCompetencyItems: competencyItems.length,
      belowRoleExpectation: belowRoleExpectation.length,
    },
    byManager,
    byOrgUnit,
    ratingDistribution,
    cycleTrends,
    activity: {
      completedOneOnOnes: meetings.length,
      feedbackEntries: feedback.length,
    },
    calibration,
  });
}
