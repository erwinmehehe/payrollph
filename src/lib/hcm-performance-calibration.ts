import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  performanceCalibrationFlags,
  performanceCalibrationPolicies,
  performanceReviews,
  users,
} from "@/db/schema";

export type CalibrationPolicySnapshot = {
  version: number;
  minimumManagerSample: number;
  managerMeanDeviationThreshold: number;
  highRatingThreshold: number;
  highRatingShareThreshold: number;
  lowRatingThreshold: number;
  lowRatingShareThreshold: number;
  largeScoreChangeThreshold: number;
  requireFlagResolution: boolean;
};

export const DEFAULT_CALIBRATION_POLICY: CalibrationPolicySnapshot = {
  version: 0,
  minimumManagerSample: 3,
  managerMeanDeviationThreshold: 0.75,
  highRatingThreshold: 4.5,
  highRatingShareThreshold: 60,
  lowRatingThreshold: 2,
  lowRatingShareThreshold: 40,
  largeScoreChangeThreshold: 1,
  requireFlagResolution: true,
};

export function calibrationPolicySnapshot(
  row: typeof performanceCalibrationPolicies.$inferSelect | null | undefined,
): CalibrationPolicySnapshot {
  if (!row) return DEFAULT_CALIBRATION_POLICY;
  return {
    version: row.version,
    minimumManagerSample: row.minimumManagerSample,
    managerMeanDeviationThreshold: Number(row.managerMeanDeviationThreshold),
    highRatingThreshold: Number(row.highRatingThreshold),
    highRatingShareThreshold: Number(row.highRatingShareThreshold),
    lowRatingThreshold: Number(row.lowRatingThreshold),
    lowRatingShareThreshold: Number(row.lowRatingShareThreshold),
    largeScoreChangeThreshold: Number(row.largeScoreChangeThreshold),
    requireFlagResolution: row.requireFlagResolution,
  };
}

export function calibrationPolicyFromUnknown(value: unknown): CalibrationPolicySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const numberField = (key: keyof CalibrationPolicySnapshot) => Number(row[key]);
  const snapshot: CalibrationPolicySnapshot = {
    version: numberField("version"),
    minimumManagerSample: numberField("minimumManagerSample"),
    managerMeanDeviationThreshold: numberField("managerMeanDeviationThreshold"),
    highRatingThreshold: numberField("highRatingThreshold"),
    highRatingShareThreshold: numberField("highRatingShareThreshold"),
    lowRatingThreshold: numberField("lowRatingThreshold"),
    lowRatingShareThreshold: numberField("lowRatingShareThreshold"),
    largeScoreChangeThreshold: numberField("largeScoreChangeThreshold"),
    requireFlagResolution: row.requireFlagResolution === true,
  };
  if (
    !Number.isInteger(snapshot.version)
    || !Number.isInteger(snapshot.minimumManagerSample)
    || [
      snapshot.managerMeanDeviationThreshold,
      snapshot.highRatingThreshold,
      snapshot.highRatingShareThreshold,
      snapshot.lowRatingThreshold,
      snapshot.lowRatingShareThreshold,
      snapshot.largeScoreChangeThreshold,
    ].some((item) => !Number.isFinite(item))
  ) return null;
  return snapshot;
}

export async function loadCalibrationPolicy(organizationId: number) {
  const [row] = await db.select().from(performanceCalibrationPolicies).where(
    eq(performanceCalibrationPolicies.organizationId, organizationId),
  ).limit(1);
  return { row: row ?? null, snapshot: calibrationPolicySnapshot(row) };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentage(count: number, total: number) {
  return total > 0 ? (count / total) * 100 : 0;
}

export async function createCalibrationDistributionFlags(input: {
  organizationId: number;
  sessionId: number;
  reviews: Array<typeof performanceReviews.$inferSelect>;
  policy: CalibrationPolicySnapshot;
}) {
  const scored = input.reviews
    .filter((review) => review.finalScore != null)
    .map((review) => ({ review, score: Number(review.finalScore) }))
    .filter((row) => Number.isFinite(row.score));
  if (!scored.length) return [];

  const orgAverage = average(scored.map((row) => row.score));
  const reviewerIds = [...new Set(
    scored.map((row) => row.review.reviewerUserId).filter((id): id is number => id != null),
  )];
  const reviewerRows = reviewerIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, reviewerIds))
    : [];
  const reviewerName = new Map(reviewerRows.map((row) => [row.id, row.name]));
  const grouped = new Map<number, typeof scored>();

  for (const row of scored) {
    const reviewerUserId = row.review.reviewerUserId;
    if (!reviewerUserId) continue;
    const group = grouped.get(reviewerUserId) ?? [];
    group.push(row);
    grouped.set(reviewerUserId, group);
  }

  const flags: Array<typeof performanceCalibrationFlags.$inferInsert> = [];
  for (const [reviewerUserId, rows] of grouped) {
    if (rows.length < input.policy.minimumManagerSample) continue;
    const scores = rows.map((row) => row.score);
    const managerAverage = average(scores);
    const meanDeviation = Math.abs(managerAverage - orgAverage);
    const highShare = percentage(scores.filter((value) => value >= input.policy.highRatingThreshold).length, scores.length);
    const lowShare = percentage(scores.filter((value) => value <= input.policy.lowRatingThreshold).length, scores.length);
    const manager = reviewerName.get(reviewerUserId) ?? "Reviewer #" + reviewerUserId;

    if (meanDeviation >= input.policy.managerMeanDeviationThreshold) {
      flags.push({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        reviewerUserId,
        flagType: "manager_mean_outlier",
        severity: "warning",
        title: manager + " rating mean differs from cycle average",
        detail: "Manager mean " + managerAverage.toFixed(2) + " vs cycle mean " + orgAverage.toFixed(2) + " across " + scores.length + " completed reviews.",
        observedValue: meanDeviation.toFixed(2),
        thresholdValue: input.policy.managerMeanDeviationThreshold.toFixed(2),
        status: "open",
      });
    }
    if (highShare >= input.policy.highRatingShareThreshold) {
      flags.push({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        reviewerUserId,
        flagType: "high_rating_concentration",
        severity: "warning",
        title: manager + " has a high-rating concentration",
        detail: highShare.toFixed(1) + "% of this manager's ratings are at or above " + input.policy.highRatingThreshold.toFixed(2) + "/5.",
        observedValue: highShare.toFixed(2),
        thresholdValue: input.policy.highRatingShareThreshold.toFixed(2),
        status: "open",
      });
    }
    if (lowShare >= input.policy.lowRatingShareThreshold) {
      flags.push({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        reviewerUserId,
        flagType: "low_rating_concentration",
        severity: "warning",
        title: manager + " has a low-rating concentration",
        detail: lowShare.toFixed(1) + "% of this manager's ratings are at or below " + input.policy.lowRatingThreshold.toFixed(2) + "/5.",
        observedValue: lowShare.toFixed(2),
        thresholdValue: input.policy.lowRatingShareThreshold.toFixed(2),
        status: "open",
      });
    }
  }

  if (!flags.length) return [];
  return db.insert(performanceCalibrationFlags).values(flags).returning();
}

export async function syncLargeScoreChangeFlag(input: {
  organizationId: number;
  sessionId: number;
  reviewId: number;
  originalScore: number;
  calibratedScore: number;
  policy: CalibrationPolicySnapshot;
  actorUserId: number;
  actorName: string;
}) {
  const delta = Math.abs(input.calibratedScore - input.originalScore);
  const [existing] = await db.select().from(performanceCalibrationFlags).where(and(
    eq(performanceCalibrationFlags.organizationId, input.organizationId),
    eq(performanceCalibrationFlags.sessionId, input.sessionId),
    eq(performanceCalibrationFlags.reviewId, input.reviewId),
    eq(performanceCalibrationFlags.flagType, "large_score_change"),
  )).limit(1);

  if (delta >= input.policy.largeScoreChangeThreshold) {
    if (existing) {
      const observedChanged = existing.observedValue == null
        || Math.abs(Number(existing.observedValue) - delta) > 0.001;
      const [row] = await db.update(performanceCalibrationFlags).set({
        observedValue: delta.toFixed(2),
        thresholdValue: input.policy.largeScoreChangeThreshold.toFixed(2),
        detail: "Calibration changes the rating by " + delta.toFixed(2) + " points from the manager final rating.",
        status: observedChanged ? "open" : existing.status,
        resolutionNote: observedChanged ? null : existing.resolutionNote,
        resolvedByUserId: observedChanged ? null : existing.resolvedByUserId,
        resolvedByName: observedChanged ? null : existing.resolvedByName,
        resolvedAt: observedChanged ? null : existing.resolvedAt,
        updatedAt: new Date(),
      }).where(eq(performanceCalibrationFlags.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(performanceCalibrationFlags).values({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      reviewId: input.reviewId,
      flagType: "large_score_change",
      severity: "blocker",
      title: "Large calibration score change",
      detail: "Calibration changes the rating by " + delta.toFixed(2) + " points from the manager final rating.",
      observedValue: delta.toFixed(2),
      thresholdValue: input.policy.largeScoreChangeThreshold.toFixed(2),
      status: "open",
    }).returning();
    return row;
  }

  if (existing?.status === "open") {
    const [row] = await db.update(performanceCalibrationFlags).set({
      status: "resolved",
      resolutionNote: "Calibration delta returned below the session policy threshold.",
      resolvedByUserId: input.actorUserId,
      resolvedByName: input.actorName,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(performanceCalibrationFlags.id, existing.id)).returning();
    return row;
  }

  return existing ?? null;
}
