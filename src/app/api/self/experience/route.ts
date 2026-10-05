import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import {
  continuousFeedback,
  employees,
  feedbackRequests,
  feedbackRounds,
  mentorships,
  oneOnOneActionItems,
  oneOnOneMeetings,
  oneOnOneSeries,
  performanceGoalAlignments,
  performanceGoals,
  performanceReviews,
  strategicGoals,
} from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  ONE_ON_ONE_CADENCES,
  boundedProgress,
  isIsoDate,
  reviewScore,
} from "@/lib/employee-experience";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const FEEDBACK_RELATIONSHIPS = ["manager", "peer", "direct_report", "cross_functional", "other"] as const;

async function currentEmployee(userId: number, employeeId: number | null, organizationId: number) {
  const denied = await assertMembership(userId, organizationId);
  if (denied) return { error: denied };
  if (!employeeId) return { error: Response.json({ error: "A linked employee profile is required." }, { status: 403 }) };
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
    eq(employees.status, "Active"),
  )).limit(1);
  if (!employee) return { error: Response.json({ error: "Your linked employee profile is missing or inactive." }, { status: 403 }) };
  return { employee };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const current = await currentEmployee(user.id, user.employeeId, organizationId);
  if ("error" in current) return current.error;
  const { employee } = current;

  const [
    staff,
    goals,
    reviews,
    alignments,
    strategicRows,
    seriesRows,
    meetingRows,
    actionRows,
    rounds,
    requests,
    mentorshipRows,
    receivedFeedback,
  ] = await Promise.all([
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
      status: employees.status,
    }).from(employees).where(and(eq(employees.organizationId, organizationId), eq(employees.status, "Active"))),
    db.select().from(performanceGoals).where(and(
      eq(performanceGoals.organizationId, organizationId),
      eq(performanceGoals.employeeId, employee.id),
    )).orderBy(desc(performanceGoals.id)),
    db.select().from(performanceReviews).where(and(
      eq(performanceReviews.organizationId, organizationId),
      eq(performanceReviews.employeeId, employee.id),
    )).orderBy(desc(performanceReviews.id)),
    db.select().from(performanceGoalAlignments).where(eq(performanceGoalAlignments.organizationId, organizationId)),
    db.select().from(strategicGoals).where(eq(strategicGoals.organizationId, organizationId)),
    db.select().from(oneOnOneSeries).where(and(
      eq(oneOnOneSeries.organizationId, organizationId),
      eq(oneOnOneSeries.employeeId, employee.id),
    )).orderBy(desc(oneOnOneSeries.id)),
    db.select().from(oneOnOneMeetings).where(eq(oneOnOneMeetings.organizationId, organizationId)).orderBy(desc(oneOnOneMeetings.scheduledDate)),
    db.select().from(oneOnOneActionItems).where(eq(oneOnOneActionItems.organizationId, organizationId)).orderBy(desc(oneOnOneActionItems.id)),
    db.select().from(feedbackRounds).where(and(
      eq(feedbackRounds.organizationId, organizationId),
      eq(feedbackRounds.subjectEmployeeId, employee.id),
    )).orderBy(desc(feedbackRounds.id)),
    db.select().from(feedbackRequests).where(eq(feedbackRequests.organizationId, organizationId)).orderBy(desc(feedbackRequests.id)),
    db.select().from(mentorships).where(and(
      eq(mentorships.organizationId, organizationId),
      or(eq(mentorships.mentorEmployeeId, employee.id), eq(mentorships.menteeEmployeeId, employee.id)),
    )).orderBy(desc(mentorships.id)),
    db.select().from(continuousFeedback).where(and(
      eq(continuousFeedback.organizationId, organizationId),
      eq(continuousFeedback.recipientEmployeeId, employee.id),
      eq(continuousFeedback.visibility, "manager_and_recipient"),
    )).orderBy(desc(continuousFeedback.createdAt)),
  ]);

  const seriesIds = new Set(seriesRows.map((row) => row.id));
  const meetings = meetingRows.filter((row) => seriesIds.has(row.seriesId)).map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    seriesId: row.seriesId,
    scheduledDate: row.scheduledDate,
    status: row.status,
    employeeUpdate: row.employeeUpdate,
    managerUpdate: row.status === "completed" ? row.managerUpdate : null,
    sharedNotes: row.status === "completed" ? row.sharedNotes : null,
    managerPrivateNotes: null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const meetingIds = new Set(meetings.map((row) => row.id));
  const roundIds = new Set(rounds.map((row) => row.id));
  const ownGoalIds = new Set(goals.map((row) => row.id));
  const aligned = alignments.filter((row) => ownGoalIds.has(row.performanceGoalId));
  const employeeById = new Map(staff.map((row) => [row.id, row]));

  // A reviewer may be asked to give feedback about somebody else, so fetch those
  // round headers separately without exposing anybody else's submitted feedback.
  const requestedRoundIds = new Set(
    requests.filter((request) => request.reviewerEmployeeId === employee.id && request.status === "requested").map((request) => request.roundId),
  );
  const externalRequestedRounds = requestedRoundIds.size
    ? await db.select().from(feedbackRounds).where(eq(feedbackRounds.organizationId, organizationId))
    : [];
  const externalRoundById = new Map(externalRequestedRounds.filter((row) => requestedRoundIds.has(row.id)).map((row) => [row.id, row]));
  const incoming = requests.filter((request) => request.reviewerEmployeeId === employee.id && request.status === "requested").flatMap((request) => {
    const round = externalRoundById.get(request.roundId);
    if (!round) return [];
    const subject = employeeById.get(round.subjectEmployeeId);
    return [{
      ...request,
      responseText: null,
      round: {
        id: round.id,
        title: round.title,
        prompt: round.prompt,
        dueDate: round.dueDate,
      },
      subjectName: subject ? subject.firstName + " " + subject.lastName : "Employee",
    }];
  });

  const ownRequests = requests.filter((request) => roundIds.has(request.roundId) && request.status === "submitted");
  const strategicById = new Map(strategicRows.map((row) => [row.id, row]));

  return Response.json({
    employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, title: employee.title },
    employees: staff.filter((row) => row.id !== employee.id),
    goals: goals.map((goal) => ({
      ...goal,
      alignments: aligned.filter((row) => row.performanceGoalId === goal.id).map((row) => ({
        ...row,
        strategicGoal: strategicById.get(row.strategicGoalId) ?? null,
      })),
    })),
    reviews: reviews.map((review) => review.status === "completed"
      ? review
      : { ...review, managerScore: null, finalScore: null, managerSummary: null, completedAt: null }),
    oneOnOneSeries: seriesRows,
    oneOnOneMeetings: meetings,
    oneOnOneActionItems: actionRows.filter((row) => meetingIds.has(row.meetingId)),
    feedbackRounds: rounds.map((round) => ({
      ...round,
      responses: ownRequests.filter((request) => request.roundId === round.id).map((request) => ({
        id: request.id,
        relationship: request.relationship,
        responseText: request.responseText,
        submittedAt: request.submittedAt,
        reviewerName: employeeById.get(request.reviewerEmployeeId)
          ? employeeById.get(request.reviewerEmployeeId)!.firstName + " " + employeeById.get(request.reviewerEmployeeId)!.lastName
          : "Reviewer",
      })),
      requestedCount: requests.filter((request) => request.roundId === round.id).length,
      submittedCount: requests.filter((request) => request.roundId === round.id && request.status === "submitted").length,
    })),
    incomingFeedbackRequests: incoming,
    mentorships: mentorshipRows,
    continuousFeedback: receivedFeedback.map((row) => ({
      id: row.id,
      kind: row.kind,
      message: row.message,
      createdAt: row.createdAt,
      authorName: row.authorEmployeeId && employeeById.get(row.authorEmployeeId)
        ? employeeById.get(row.authorEmployeeId)!.firstName + " " + employeeById.get(row.authorEmployeeId)!.lastName
        : "Manager",
    })),
    employeeNames: Object.fromEntries(staff.map((row) => [row.id, row.firstName + " " + row.lastName])),
    feedbackPolicy: "360 feedback in this foundation is named, not anonymous. Anonymous multi-rater feedback requires a separate threshold-protected workflow.",
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

  const current = await currentEmployee(user.id, user.employeeId, organizationId);
  if ("error" in current) return current.error;
  const { employee } = current;

  if (entityType === "feedback_round") {
    const title = String(body.title ?? "").trim();
    const prompt = String(body.prompt ?? "").trim();
    const dueDate = body.dueDate ? String(body.dueDate) : null;
    const rawReviewers = Array.isArray(body.reviewers) ? body.reviewers : [];
    if (!title || !prompt || (dueDate && !isIsoDate(dueDate)) || rawReviewers.length < 1 || rawReviewers.length > 8) {
      return Response.json({ error: "title, prompt, optional dueDate, and 1-8 reviewers are required." }, { status: 400 });
    }

    const reviewers: Array<{ employeeId: number; relationship: string }> = [];
    const seen = new Set<number>();
    for (const raw of rawReviewers) {
      const reviewerEmployeeId = Number(raw?.employeeId);
      const relationship = String(raw?.relationship ?? "peer");
      if (!Number.isInteger(reviewerEmployeeId) || reviewerEmployeeId === employee.id || seen.has(reviewerEmployeeId) || !(FEEDBACK_RELATIONSHIPS as readonly string[]).includes(relationship)) {
        return Response.json({ error: "Each reviewer must be unique, valid, not you, and have a valid relationship." }, { status: 400 });
      }
      const [reviewer] = await db.select({ id: employees.id }).from(employees).where(and(
        eq(employees.id, reviewerEmployeeId),
        eq(employees.organizationId, organizationId),
        eq(employees.status, "Active"),
      )).limit(1);
      if (!reviewer) return Response.json({ error: "A selected reviewer is not an active employee." }, { status: 404 });
      seen.add(reviewerEmployeeId);
      reviewers.push({ employeeId: reviewerEmployeeId, relationship });
    }

    const result = await db.transaction(async (tx) => {
      const [round] = await tx.insert(feedbackRounds).values({
        organizationId,
        subjectEmployeeId: employee.id,
        title: title.slice(0, 180),
        prompt: prompt.slice(0, 4000),
        dueDate,
        status: "open",
        createdByEmployeeId: employee.id,
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
      action: "Employee 360 feedback requested",
      resource: employee.firstName + " " + employee.lastName,
      metadata: { roundId: result.round.id, reviewerCount: result.requests.length },
    });
    return Response.json(result, { status: 201 });
  }

  if (entityType === "mentorship_request") {
    const mentorEmployeeId = Number(body.mentorEmployeeId);
    const goal = String(body.goal ?? "").trim();
    const cadence = String(body.cadence ?? "monthly");
    if (!Number.isInteger(mentorEmployeeId) || mentorEmployeeId === employee.id || !goal || !(ONE_ON_ONE_CADENCES as readonly string[]).includes(cadence)) {
      return Response.json({ error: "A different mentor, a goal, and a valid cadence are required." }, { status: 400 });
    }
    const [mentor] = await db.select().from(employees).where(and(
      eq(employees.id, mentorEmployeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.status, "Active"),
    )).limit(1);
    if (!mentor) return Response.json({ error: "Mentor is not an active employee." }, { status: 404 });

    const [existing] = await db.select({ id: mentorships.id }).from(mentorships).where(and(
      eq(mentorships.organizationId, organizationId),
      eq(mentorships.mentorEmployeeId, mentorEmployeeId),
      eq(mentorships.menteeEmployeeId, employee.id),
    )).orderBy(desc(mentorships.id)).limit(1);
    if (existing) return Response.json({ error: "A mentorship record already exists with this mentor." }, { status: 409 });

    const [row] = await db.insert(mentorships).values({
      organizationId,
      mentorEmployeeId,
      menteeEmployeeId: employee.id,
      requestedByEmployeeId: employee.id,
      goal: goal.slice(0, 500),
      cadence,
      status: "requested",
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Mentorship requested",
      resource: mentor.firstName + " " + mentor.lastName,
      metadata: { mentorshipId: row.id, mentorEmployeeId, menteeEmployeeId: employee.id, cadence },
    });
    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "entityType must be feedback_round or mentorship_request." }, { status: 400 });
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

  const current = await currentEmployee(user.id, user.employeeId, organizationId);
  if ("error" in current) return current.error;
  const { employee } = current;

  if (action === "goal_progress") {
    const goalId = Number(body.goalId);
    const progress = boundedProgress(body.progress);
    if (!Number.isInteger(goalId) || progress === null) return Response.json({ error: "goalId and progress from 0 to 100 are required." }, { status: 400 });
    const [goal] = await db.select().from(performanceGoals).where(and(
      eq(performanceGoals.id, goalId),
      eq(performanceGoals.organizationId, organizationId),
      eq(performanceGoals.employeeId, employee.id),
    )).limit(1);
    if (!goal) return Response.json({ error: "Goal not found in your employee record." }, { status: 404 });

    const [row] = await db.update(performanceGoals).set({
      progress,
      status: progress === 100 ? "completed" : (goal.status === "cancelled" ? "cancelled" : "active"),
      updatedAt: new Date(),
    }).where(eq(performanceGoals.id, goalId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Employee updated goal progress", resource: goal.title, metadata: { goalId, progress: row.progress, status: row.status } });
    return Response.json(row);
  }

  if (action === "self_assessment") {
    const reviewId = Number(body.reviewId);
    const selfScore = reviewScore(body.selfScore);
    const reflection = String(body.employeeReflection ?? "").trim();
    if (!Number.isInteger(reviewId) || selfScore === null || !reflection || reflection.length > 8000) {
      return Response.json({ error: "reviewId, a self score from 1.00 to 5.00, and reflection up to 8,000 characters are required." }, { status: 400 });
    }
    const [review] = await db.select().from(performanceReviews).where(and(
      eq(performanceReviews.id, reviewId),
      eq(performanceReviews.organizationId, organizationId),
      eq(performanceReviews.employeeId, employee.id),
    )).limit(1);
    if (!review) return Response.json({ error: "Performance review not found in your employee record." }, { status: 404 });
    if (review.status === "completed") return Response.json({ error: "A completed performance review cannot be changed by self-service." }, { status: 409 });

    const [row] = await db.update(performanceReviews).set({
      selfScore,
      employeeReflection: reflection,
      selfSubmittedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(performanceReviews.id, reviewId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Employee self-assessment submitted", resource: "Review #" + reviewId, metadata: { reviewId, employeeId: employee.id } });
    return Response.json(row);
  }

  if (action === "one_on_one_update") {
    const meetingId = Number(body.meetingId);
    const employeeUpdate = String(body.employeeUpdate ?? "").trim();
    if (!Number.isInteger(meetingId) || !employeeUpdate || employeeUpdate.length > 8000) {
      return Response.json({ error: "meetingId and an employee update up to 8,000 characters are required." }, { status: 400 });
    }
    const [meeting] = await db.select().from(oneOnOneMeetings).where(and(
      eq(oneOnOneMeetings.id, meetingId),
      eq(oneOnOneMeetings.organizationId, organizationId),
    )).limit(1);
    if (!meeting) return Response.json({ error: "One-on-one meeting not found." }, { status: 404 });
    const [series] = await db.select().from(oneOnOneSeries).where(and(
      eq(oneOnOneSeries.id, meeting.seriesId),
      eq(oneOnOneSeries.organizationId, organizationId),
      eq(oneOnOneSeries.employeeId, employee.id),
    )).limit(1);
    if (!series) return Response.json({ error: "This one-on-one is not assigned to you as the employee participant." }, { status: 403 });
    if (meeting.status !== "scheduled") return Response.json({ error: "Only a scheduled one-on-one can be updated." }, { status: 409 });

    const [row] = await db.update(oneOnOneMeetings).set({ employeeUpdate, updatedAt: new Date() }).where(eq(oneOnOneMeetings.id, meetingId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Employee prepared one-on-one update", resource: "One-on-one #" + meetingId, metadata: { meetingId, seriesId: series.id, employeeId: employee.id } });
    return Response.json(row);
  }

  if (action === "feedback_response") {
    const requestId = Number(body.requestId);
    const responseText = String(body.responseText ?? "").trim();
    if (!Number.isInteger(requestId) || !responseText || responseText.length > 8000) {
      return Response.json({ error: "requestId and feedback up to 8,000 characters are required." }, { status: 400 });
    }
    const [feedbackRequest] = await db.select().from(feedbackRequests).where(and(
      eq(feedbackRequests.id, requestId),
      eq(feedbackRequests.organizationId, organizationId),
      eq(feedbackRequests.reviewerEmployeeId, employee.id),
    )).limit(1);
    if (!feedbackRequest) return Response.json({ error: "Feedback request not found in your inbox." }, { status: 404 });
    if (feedbackRequest.status !== "requested") return Response.json({ error: "This feedback request has already been answered or closed." }, { status: 409 });

    const [round] = await db.select().from(feedbackRounds).where(eq(feedbackRounds.id, feedbackRequest.roundId)).limit(1);
    if (!round || round.status !== "open") return Response.json({ error: "The feedback round is no longer open." }, { status: 409 });

    const [row] = await db.update(feedbackRequests).set({
      status: "submitted",
      responseText,
      submittedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(feedbackRequests.id, requestId)).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Named 360 feedback submitted",
      resource: round.title,
      metadata: { requestId, roundId: round.id, reviewerEmployeeId: employee.id, subjectEmployeeId: round.subjectEmployeeId },
    });
    return Response.json(row);
  }

  if (action === "mentorship_status") {
    const mentorshipId = Number(body.mentorshipId);
    const status = String(body.status ?? "");
    const [mentorship] = await db.select().from(mentorships).where(and(
      eq(mentorships.id, mentorshipId),
      eq(mentorships.organizationId, organizationId),
    )).limit(1);
    if (!mentorship) return Response.json({ error: "Mentorship not found." }, { status: 404 });

    const isMentor = mentorship.mentorEmployeeId === employee.id;
    const isMentee = mentorship.menteeEmployeeId === employee.id;
    if (!isMentor && !isMentee) return Response.json({ error: "This mentorship does not belong to your employee record." }, { status: 403 });

    const allowed = isMentor ? ["active", "declined", "completed"] : ["cancelled", "completed"];
    if (!allowed.includes(status)) {
      return Response.json({ error: "That mentorship transition is not available to you." }, { status: 400 });
    }
    if (isMentor && mentorship.status !== "requested" && status !== "completed") {
      return Response.json({ error: "Only a requested mentorship can be accepted or declined." }, { status: 409 });
    }

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    const [row] = await db.update(mentorships).set({
      status,
      startDate: status === "active" && !mentorship.startDate ? today : mentorship.startDate,
      endDate: ["declined", "cancelled", "completed"].includes(status) ? today : mentorship.endDate,
      updatedAt: new Date(),
    }).where(eq(mentorships.id, mentorshipId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Employee mentorship status changed", resource: "Mentorship #" + mentorshipId, metadata: { mentorshipId, employeeId: employee.id, status } });
    return Response.json(row);
  }

  if (action === "one_on_one_action_status") {
    const actionItemId = Number(body.actionItemId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(actionItemId) || !["open", "completed"].includes(status)) {
      return Response.json({ error: "actionItemId and open/completed status are required." }, { status: 400 });
    }
    const [item] = await db.select().from(oneOnOneActionItems).where(and(
      eq(oneOnOneActionItems.id, actionItemId),
      eq(oneOnOneActionItems.organizationId, organizationId),
    )).limit(1);
    if (!item) return Response.json({ error: "One-on-one action item not found." }, { status: 404 });
    if (item.ownerEmployeeId !== employee.id) return Response.json({ error: "Only the assigned action owner can update this item in self-service." }, { status: 403 });

    const [row] = await db.update(oneOnOneActionItems).set({ status, updatedAt: new Date() }).where(eq(oneOnOneActionItems.id, actionItemId)).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Employee one-on-one action updated", resource: item.title, metadata: { actionItemId, employeeId: employee.id, status } });
    return Response.json(row);
  }

  return Response.json({ error: "Unsupported self-service experience action." }, { status: 400 });
}
