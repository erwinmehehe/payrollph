import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmSkills,
  performanceCalibrationEntries,
  performanceCalibrationFlags,
  performanceCalibrationSessions,
  performanceCycleEvidenceAmendments,
  performanceCycleEvidenceSeals,
  performanceCycles,
  performanceFeedback,
  performanceGoals,
  performanceOneOnOneActionItemEvents,
  performanceOneOnOneActionItems,
  performanceOneOnOneAgendaContributions,
  performanceOneOnOnes,
  performanceReviewItems,
  performanceReviews,
  performanceTemplates,
} from "@/db/schema";

const SCHEMA_VERSION = "performance-evidence-v1";

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function section<T>(rows: T[]) {
  return { rowCount: rows.length, rows };
}

export async function buildPerformanceEvidencePackage(input: {
  organizationId: number;
  employeeId: number;
  cycleId?: number | null;
  generatedBy: string;
}) {
  const [employee] = await db.select({
    id: employees.id,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
    orgUnitId: employees.orgUnitId,
    status: employees.status,
    startDate: employees.startDate,
    employmentType: employees.employmentType,
  }).from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!employee) throw new Error("Employee not found in this workspace.");

  const cycles = input.cycleId
    ? await db.select().from(performanceCycles).where(and(
        eq(performanceCycles.id, input.cycleId),
        eq(performanceCycles.organizationId, input.organizationId),
      ))
    : await db.select().from(performanceCycles)
        .where(eq(performanceCycles.organizationId, input.organizationId))
        .orderBy(performanceCycles.startDate);

  if (input.cycleId && !cycles[0]) {
    throw new Error("Performance cycle not found in this workspace.");
  }

  const cycleIds = new Set(cycles.map((cycle) => cycle.id));
  const allReviews = await db.select().from(performanceReviews).where(and(
    eq(performanceReviews.organizationId, input.organizationId),
    eq(performanceReviews.employeeId, input.employeeId),
  ));
  const reviews = allReviews
    .filter((review) => !input.cycleId || cycleIds.has(review.cycleId))
    .sort((left, right) => left.cycleId - right.cycleId || left.id - right.id);
  const reviewIds = reviews.map((review) => review.id);

  const allItems = await db.select().from(performanceReviewItems)
    .where(eq(performanceReviewItems.organizationId, input.organizationId));
  const reviewItems = reviewIds.length
    ? allItems.filter((item) => reviewIds.includes(item.reviewId)).sort((left, right) => left.reviewId - right.reviewId || left.id - right.id)
    : [];
  const templateIds = [...new Set(reviewItems.map((item) => item.templateId))];
  const skillIds = [...new Set(reviewItems.map((item) => item.skillId).filter((id): id is number => id != null))];
  const [templates, skills] = await Promise.all([
    templateIds.length
      ? db.select().from(performanceTemplates).where(and(
          eq(performanceTemplates.organizationId, input.organizationId),
          inArray(performanceTemplates.id, templateIds),
        ))
      : Promise.resolve([]),
    skillIds.length
      ? db.select().from(hcmSkills).where(and(
          eq(hcmSkills.organizationId, input.organizationId),
          inArray(hcmSkills.id, skillIds),
        ))
      : Promise.resolve([]),
  ]);

  const cycleStart = input.cycleId ? Date.parse(cycles[0].startDate + "T00:00:00Z") : null;
  const cycleEnd = input.cycleId ? Date.parse(cycles[0].endDate + "T23:59:59Z") : null;

  const allGoals = await db.select().from(performanceGoals).where(and(
    eq(performanceGoals.organizationId, input.organizationId),
    eq(performanceGoals.employeeId, input.employeeId),
  ));
  const goals = allGoals
    .filter((goal) => !input.cycleId || goal.cycleId === input.cycleId)
    .sort((left, right) => left.id - right.id);

  const allMeetings = await db.select({
    id: performanceOneOnOnes.id,
    employeeId: performanceOneOnOnes.employeeId,
    managerUserId: performanceOneOnOnes.managerUserId,
    managerEmployeeId: performanceOneOnOnes.managerEmployeeId,
    scheduledFor: performanceOneOnOnes.scheduledFor,
    status: performanceOneOnOnes.status,
    agenda: performanceOneOnOnes.agenda,
    sharedSummary: performanceOneOnOnes.sharedSummary,
    completedAt: performanceOneOnOnes.completedAt,
    cancelledAt: performanceOneOnOnes.cancelledAt,
    createdByName: performanceOneOnOnes.createdByName,
    createdAt: performanceOneOnOnes.createdAt,
    updatedAt: performanceOneOnOnes.updatedAt,
  }).from(performanceOneOnOnes).where(and(
    eq(performanceOneOnOnes.organizationId, input.organizationId),
    eq(performanceOneOnOnes.employeeId, input.employeeId),
  ));
  const meetings = allMeetings
    .filter((meeting) =>
      cycleStart == null
      || cycleEnd == null
      || (meeting.scheduledFor.getTime() >= cycleStart && meeting.scheduledFor.getTime() <= cycleEnd)
    )
    .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime());
  const meetingIds = meetings.map((meeting) => meeting.id);

  const [agendaContributions, sharedActionItems, sharedFeedback] = await Promise.all([
    meetingIds.length
      ? db.select().from(performanceOneOnOneAgendaContributions).where(and(
          eq(performanceOneOnOneAgendaContributions.organizationId, input.organizationId),
          eq(performanceOneOnOneAgendaContributions.employeeId, input.employeeId),
          inArray(performanceOneOnOneAgendaContributions.oneOnOneId, meetingIds),
        ))
      : Promise.resolve([]),
    meetingIds.length
      ? db.select().from(performanceOneOnOneActionItems).where(and(
          eq(performanceOneOnOneActionItems.organizationId, input.organizationId),
          eq(performanceOneOnOneActionItems.employeeId, input.employeeId),
          eq(performanceOneOnOneActionItems.visibility, "employee_shared"),
          inArray(performanceOneOnOneActionItems.oneOnOneId, meetingIds),
        ))
      : Promise.resolve([]),
    db.select().from(performanceFeedback).where(and(
      eq(performanceFeedback.organizationId, input.organizationId),
      eq(performanceFeedback.employeeId, input.employeeId),
      eq(performanceFeedback.visibility, "employee_shared"),
    )),
  ]);

  const feedback = sharedFeedback
    .filter((item) =>
      cycleStart == null
      || cycleEnd == null
      || (item.occurredAt.getTime() >= cycleStart && item.occurredAt.getTime() <= cycleEnd)
    )
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const actionItemIds = sharedActionItems.map((item) => item.id);
  const actionItemEvents = actionItemIds.length
    ? await db.select().from(performanceOneOnOneActionItemEvents).where(and(
        eq(performanceOneOnOneActionItemEvents.organizationId, input.organizationId),
        inArray(performanceOneOnOneActionItemEvents.actionItemId, actionItemIds),
      ))
    : [];

  const allCalibrationEntries = await db.select().from(performanceCalibrationEntries)
    .where(eq(performanceCalibrationEntries.organizationId, input.organizationId));
  const calibrationEntries = allCalibrationEntries
    .filter((entry) => reviewIds.includes(entry.reviewId))
    .sort((left, right) => left.id - right.id);
  const sessionIds = [...new Set(calibrationEntries.map((entry) => entry.sessionId))];
  const [calibrationSessions, allCalibrationFlags] = await Promise.all([
    sessionIds.length
      ? db.select().from(performanceCalibrationSessions).where(and(
          eq(performanceCalibrationSessions.organizationId, input.organizationId),
          inArray(performanceCalibrationSessions.id, sessionIds),
        ))
      : Promise.resolve([]),
    sessionIds.length
      ? db.select().from(performanceCalibrationFlags).where(and(
          eq(performanceCalibrationFlags.organizationId, input.organizationId),
          inArray(performanceCalibrationFlags.sessionId, sessionIds),
        ))
      : Promise.resolve([]),
  ]);
  const calibrationFlags = allCalibrationFlags
    .filter((flag) => flag.reviewId != null && reviewIds.includes(flag.reviewId))
    .sort((left, right) => left.id - right.id);

  const sections = {
    cycles: section(cycles.sort((left, right) => left.startDate.localeCompare(right.startDate))),
    reviews: section(reviews),
    reviewItems: section(reviewItems),
    templates: section(templates.sort((left, right) => left.id - right.id)),
    skills: section(skills.sort((left, right) => left.id - right.id)),
    goals: section(goals),
    oneOnOnes: section(meetings),
    agendaContributions: section(agendaContributions.sort((left, right) => left.id - right.id)),
    actionItems: section(sharedActionItems.sort((left, right) => left.id - right.id)),
    actionItemEvents: section(actionItemEvents.sort((left, right) => left.id - right.id)),
    sharedFeedback: section(feedback),
    calibrationSessions: section(calibrationSessions.sort((left, right) => left.id - right.id)),
    calibrationEntries: section(calibrationEntries),
    calibrationFlags: section(calibrationFlags),
  };

  const sectionHashes = Object.fromEntries(
    Object.entries(sections).map(([name, value]) => [name, sha256(value.rows)]),
  );
  const generatedAt = new Date().toISOString();
  const identity = {
    schemaVersion: SCHEMA_VERSION,
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    cycleId: input.cycleId ?? null,
    employee,
    sectionHashes,
  };
  const snapshotHash = sha256(identity);

  const cycleIdList = [...cycleIds];
  const seals = cycleIdList.length
    ? await db.select().from(performanceCycleEvidenceSeals).where(and(
        eq(performanceCycleEvidenceSeals.organizationId, input.organizationId),
        inArray(performanceCycleEvidenceSeals.cycleId, cycleIdList),
      ))
    : [];
  const sealIds = seals.map((seal) => seal.id);
  const amendments = sealIds.length
    ? await db.select().from(performanceCycleEvidenceAmendments).where(and(
        eq(performanceCycleEvidenceAmendments.organizationId, input.organizationId),
        inArray(performanceCycleEvidenceAmendments.sealId, sealIds),
      ))
    : [];

  const sealVerification = seals.map((seal) => {
    const manifest = seal.manifest && typeof seal.manifest === "object" && !Array.isArray(seal.manifest)
      ? seal.manifest as Record<string, unknown>
      : {};
    const employeeEvidence = Array.isArray(manifest.employeeEvidence)
      ? manifest.employeeEvidence as Array<Record<string, unknown>>
      : [];
    const employeeEntry = employeeEvidence.find((entry) => Number(entry.employeeId) === input.employeeId) ?? null;
    const expectedEvidenceHash = employeeEntry ? String(employeeEntry.evidenceHash ?? "") : null;
    return {
      cycleId: seal.cycleId,
      sealId: seal.id,
      sealedAt: seal.sealedAt,
      retentionUntil: seal.retentionUntil,
      legalHold: seal.legalHold,
      manifestHash: seal.manifestHash,
      expectedEmployeeEvidenceHash: expectedEvidenceHash,
      currentEmployeeEvidenceHash: input.cycleId === seal.cycleId ? snapshotHash : null,
      employeeEvidenceMatchesSeal:
        input.cycleId === seal.cycleId && expectedEvidenceHash
          ? expectedEvidenceHash === snapshotHash
          : null,
      latestAmendmentNumber: seal.latestAmendmentNumber,
      amendments: amendments
        .filter((item) => item.sealId === seal.id)
        .map((item) => ({
          amendmentNumber: item.amendmentNumber,
          employeeId: item.employeeId,
          reason: item.reason,
          detail: item.detail,
          chainHash: item.chainHash,
          actorName: item.actorName,
          createdAt: item.createdAt,
        })),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    generatedBy: input.generatedBy,
    organizationId: input.organizationId,
    filters: {
      employeeId: input.employeeId,
      cycleId: input.cycleId ?? null,
    },
    employee,
    exclusions: [
      "manager-private 1:1 notes",
      "manager-private continuous feedback",
      "manager-private 1:1 action items",
      "compensation and payroll records",
      "bank and government identifiers",
      "calibration distribution flags not tied to this employee's reviews",
    ],
    sections,
    snapshot: {
      sectionHashes,
      sha256: snapshotHash,
    },
    sealVerification,
  };
}
