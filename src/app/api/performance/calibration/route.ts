import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  performanceCalibrationEntries,
  performanceCalibrationFlags,
  performanceCalibrationPolicies,
  performanceCalibrationPolicyEvents,
  performanceCalibrationSessions,
  performanceCycles,
  performanceReviews,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  calibrationPolicyFromUnknown,
  calibrationPolicySnapshot,
  createCalibrationDistributionFlags,
  loadCalibrationPolicy,
  syncLargeScoreChangeFlag,
} from "@/lib/hcm-performance-calibration";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function score(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n.toFixed(2) : null;
}

async function companyWidePeopleAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage performance calibration.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({ error: "Performance calibration requires company-wide access." }, { status: 403 }) };
  }
  return { access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const authorized = await companyWidePeopleAdmin(user.id, organizationId);
  if ("error" in authorized) return authorized.error;

  const [sessions, entries, flags, reviews, staff, cycles, policyState] = await Promise.all([
    db.select().from(performanceCalibrationSessions)
      .where(eq(performanceCalibrationSessions.organizationId, organizationId)),
    db.select().from(performanceCalibrationEntries)
      .where(eq(performanceCalibrationEntries.organizationId, organizationId)),
    db.select().from(performanceCalibrationFlags)
      .where(eq(performanceCalibrationFlags.organizationId, organizationId)),
    db.select().from(performanceReviews)
      .where(eq(performanceReviews.organizationId, organizationId)),
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(performanceCycles)
      .where(eq(performanceCycles.organizationId, organizationId)),
    loadCalibrationPolicy(organizationId),
  ]);

  return Response.json({
    sessions,
    entries,
    flags,
    reviews,
    employees: staff,
    cycles,
    policy: policyState.snapshot,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const cycleId = Number(body.cycleId);
  const name = String(body.name ?? "").trim();
  const notes = String(body.notes ?? "").trim().slice(0, 8000) || null;

  if (!Number.isInteger(organizationId) || !Number.isInteger(cycleId) || !name) {
    return Response.json({ error: "organizationId, cycleId and calibration session name are required." }, { status: 400 });
  }

  const authorized = await companyWidePeopleAdmin(user.id, organizationId);
  if ("error" in authorized) return authorized.error;

  const [cycle] = await db.select().from(performanceCycles).where(and(
    eq(performanceCycles.id, cycleId),
    eq(performanceCycles.organizationId, organizationId),
  )).limit(1);
  if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });
  if (cycle.status === "completed") {
    return Response.json({ error: "Completed performance cycles cannot be calibrated." }, { status: 409 });
  }

  const reviews = await db.select().from(performanceReviews).where(and(
    eq(performanceReviews.organizationId, organizationId),
    eq(performanceReviews.cycleId, cycleId),
  ));
  if (!reviews.length) {
    return Response.json({ error: "Calibration requires at least one completed performance review." }, { status: 409 });
  }
  const incomplete = reviews.filter((review) => review.status !== "completed" || !review.finalScore);
  if (incomplete.length) {
    return Response.json({
      error: "Complete every manager review with a final rating before opening calibration.",
      incompleteReviewIds: incomplete.map((review) => review.id),
    }, { status: 409 });
  }

  try {
    const [session] = await db.insert(performanceCalibrationSessions).values({
      organizationId,
      cycleId,
      name: name.slice(0, 180),
      status: "open",
      notes,
      createdByUserId: user.id,
      createdByName: user.name,
    }).returning();

    await db.insert(performanceCalibrationEntries).values(reviews.map((review) => ({
      organizationId,
      sessionId: session.id,
      reviewId: review.id,
      originalScore: review.finalScore!,
    })));

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance calibration opened",
      resource: cycle.name,
      metadata: {
        calibrationSessionId: session.id,
        cycleId,
        reviewCount: reviews.length,
      },
    });

    return Response.json(session, { status: 201 });
  } catch {
    return Response.json({ error: "A calibration session already exists for this performance cycle." }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const organizationId = Number(body.organizationId);
  const sessionId = Number(body.sessionId);

  if (!Number.isInteger(organizationId) || !Number.isInteger(sessionId)) {
    return Response.json({ error: "organizationId and sessionId are required." }, { status: 400 });
  }

  const authorized = await companyWidePeopleAdmin(user.id, organizationId);
  if ("error" in authorized) return authorized.error;

  const [session] = await db.select().from(performanceCalibrationSessions).where(and(
    eq(performanceCalibrationSessions.id, sessionId),
    eq(performanceCalibrationSessions.organizationId, organizationId),
  )).limit(1);
  if (!session) return Response.json({ error: "Calibration session not found." }, { status: 404 });
  if (session.status === "finalized") {
    return Response.json({ error: "Finalized calibration sessions are locked." }, { status: 409 });
  }

  const [cycle] = await db.select().from(performanceCycles).where(and(
    eq(performanceCycles.id, session.cycleId),
    eq(performanceCycles.organizationId, organizationId),
  )).limit(1);
  if (!cycle) return Response.json({ error: "Performance cycle not found." }, { status: 404 });
  if (cycle.status === "completed") {
    return Response.json({ error: "Completed performance cycles cannot be changed by calibration." }, { status: 409 });
  }

  if (action === "score") {
    const entryId = Number(body.entryId);
    const calibratedScore = score(body.calibratedScore);
    const rationale = String(body.rationale ?? "").trim().slice(0, 8000) || null;
    if (!Number.isInteger(entryId) || calibratedScore === null) {
      return Response.json({ error: "entryId and a calibrated score from 1.00 to 5.00 are required." }, { status: 400 });
    }

    const [entry] = await db.select().from(performanceCalibrationEntries).where(and(
      eq(performanceCalibrationEntries.id, entryId),
      eq(performanceCalibrationEntries.organizationId, organizationId),
      eq(performanceCalibrationEntries.sessionId, sessionId),
    )).limit(1);
    if (!entry) return Response.json({ error: "Calibration entry not found." }, { status: 404 });

    const changed = Math.abs(Number(calibratedScore) - Number(entry.originalScore)) > 0.001;
    if (changed && (!rationale || rationale.length < 10)) {
      return Response.json({ error: "A written rationale of at least 10 characters is required when changing a manager final rating." }, { status: 400 });
    }

    const [row] = await db.update(performanceCalibrationEntries).set({
      calibratedScore,
      rationale,
      calibratedByUserId: user.id,
      calibratedByName: user.name,
      calibratedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(performanceCalibrationEntries.id, entryId)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: changed ? "Performance rating calibration changed" : "Performance rating calibration confirmed",
      resource: "Review #" + entry.reviewId,
      metadata: {
        calibrationSessionId: sessionId,
        calibrationEntryId: entryId,
        originalScore: entry.originalScore,
        calibratedScore,
        changed,
        rationaleProvided: Boolean(rationale),
      },
    });

    return Response.json(row);
  }

  if (action === "finalize") {
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id,
      action: "performance-calibration-finalize",
      resourceId: sessionId,
      limit: 5,
      windowMs: 5 * 60_000,
    });
    if (rateDenied) return rateDenied;

    const entries = await db.select().from(performanceCalibrationEntries).where(and(
      eq(performanceCalibrationEntries.organizationId, organizationId),
      eq(performanceCalibrationEntries.sessionId, sessionId),
    ));
    if (!entries.length) {
      return Response.json({ error: "Calibration has no review entries to finalize." }, { status: 409 });
    }

    for (const entry of entries) {
      if (!entry.calibratedScore) {
        return Response.json({ error: "Every calibration entry must have a calibrated score before finalization." }, { status: 409 });
      }
      const changed = Math.abs(Number(entry.calibratedScore) - Number(entry.originalScore)) > 0.001;
      if (changed && (!entry.rationale || entry.rationale.trim().length < 10)) {
        return Response.json({ error: "Every changed rating requires written calibration rationale before finalization." }, { status: 409 });
      }
    }

    for (const entry of entries) {
      await db.update(performanceReviews).set({
        finalScore: entry.calibratedScore!,
        updatedAt: new Date(),
      }).where(and(
        eq(performanceReviews.id, entry.reviewId),
        eq(performanceReviews.organizationId, organizationId),
        eq(performanceReviews.cycleId, session.cycleId),
      ));
    }

    const now = new Date();
    const [row] = await db.update(performanceCalibrationSessions).set({
      status: "finalized",
      finalizedByUserId: user.id,
      finalizedByName: user.name,
      finalizedAt: now,
      updatedAt: now,
    }).where(eq(performanceCalibrationSessions.id, sessionId)).returning();

    const changedCount = entries.filter((entry) =>
      Math.abs(Number(entry.calibratedScore) - Number(entry.originalScore)) > 0.001
    ).length;

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Performance calibration finalized",
      resource: cycle.name,
      metadata: {
        calibrationSessionId: sessionId,
        cycleId: session.cycleId,
        entryCount: entries.length,
        changedCount,
      },
    });

    return Response.json({ ...row, changedCount });
  }

  return Response.json({ error: "action must be score or finalize." }, { status: 400 });
}
