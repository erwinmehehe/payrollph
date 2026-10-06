import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmEmploymentTermDecisions,
  hcmEmploymentTerms,
  hcmProbationReviews,
  positionAssignments,
  positions,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  roleAllowed,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  loadProbationReviewPacket,
  parseProbationReviewInput,
  probationReviewSnapshot,
  recordProbationReviewEvent,
} from "@/lib/hcm-probation-reviews";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function probationReviewAccess(
  user: Awaited<ReturnType<typeof getSessionUser>>,
  organizationId: number,
  employeeId: number,
  employmentTermId: number,
) {
  if (!user) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to access probation reviews.",
  );
  if (denied) return { error: denied };

  const access = await getAccess(user.id, organizationId);
  if (!access) return { error: Response.json({ error: "Workspace access required." }, { status: 403 }) };

  const [employee, term] = await Promise.all([
    db.select({
      id: employees.id,
      orgUnitId: employees.orgUnitId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNo: employees.employeeNo,
    }).from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.id, employmentTermId),
      eq(hcmEmploymentTerms.organizationId, organizationId),
      eq(hcmEmploymentTerms.employeeId, employeeId),
    )).limit(1).then((rows) => rows[0] ?? null),
  ]);
  if (!employee || !term) {
    return { error: Response.json({ error: "Probation employment terms were not found for this worker." }, { status: 404 }) };
  }
  if (term.termKind !== "probationary") {
    return { error: Response.json({ error: "Structured probation review is available only for probationary employment terms." }, { status: 409 }) };
  }

  if (access.companyWide && roleAllowed(access.role, PEOPLE_ADMIN_ROLES)) {
    return { access, employee, term, managerOnly: false as const };
  }

  if (access.role !== "manager" || !user.employeeId || user.employeeId === employeeId) {
    return { error: Response.json({
      error: "Probation reviews are limited to company-wide People administrators and the worker's current manager.",
    }, { status: 403 }) };
  }

  const [managed] = await db.select({ positionId: positionAssignments.positionId })
    .from(positionAssignments)
    .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
    .where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, employeeId),
      eq(positionAssignments.assignmentType, "primary"),
      isNull(positionAssignments.effectiveUntil),
      eq(positions.managerEmployeeId, user.employeeId),
    ))
    .limit(1);
  if (!managed) {
    return { error: Response.json({ error: "This worker is not currently assigned to you as manager." }, { status: 403 }) };
  }

  return { access, employee, term, managerOnly: true as const };
}

async function reviewMutable(
  organizationId: number,
  employmentTermId: number,
  termStatus: string,
) {
  if (termStatus !== "active") {
    return "Only the active probationary employment term can receive or update a probation review.";
  }
  const [lockedDecision] = await db.select({ id: hcmEmploymentTermDecisions.id })
    .from(hcmEmploymentTermDecisions)
    .where(and(
      eq(hcmEmploymentTermDecisions.organizationId, organizationId),
      eq(hcmEmploymentTermDecisions.employmentTermId, employmentTermId),
      inArray(hcmEmploymentTermDecisions.status, ["scheduled", "applied"]),
    ))
    .limit(1);
  return lockedDecision
    ? "The probation review cannot change after the employment decision has been approved."
    : null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId"));
  const employmentTermId = Number(url.searchParams.get("employmentTermId"));
  if (![organizationId, employeeId, employmentTermId].every(Number.isInteger)) {
    return Response.json({
      error: "Valid organizationId, employeeId, and employmentTermId are required.",
    }, { status: 400 });
  }

  const gate = await probationReviewAccess(user, organizationId, employeeId, employmentTermId);
  if ("error" in gate) return gate.error;

  const packet = await loadProbationReviewPacket({ organizationId, employmentTermId });
  return Response.json({
    review: packet?.review ?? null,
    acknowledgment: packet?.acknowledgment ?? null,
    events: packet?.events ?? [],
    canManage: true,
    mutable: !packet?.review || packet.review.status === "draft",
    employee: gate.employee,
    term: gate.term,
    guardrail: "A probation review is evidence and a manager recommendation only. It never changes employment status or approves an employment decision.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const employmentTermId = Number(body.employmentTermId);
  if (![organizationId, employeeId, employmentTermId].every(Number.isInteger)) {
    return Response.json({
      error: "Valid organizationId, employeeId, and employmentTermId are required.",
    }, { status: 400 });
  }

  const gate = await probationReviewAccess(user, organizationId, employeeId, employmentTermId);
  if ("error" in gate) return gate.error;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-probation-review-create",
    resourceId: employmentTermId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const lockReason = await reviewMutable(organizationId, employmentTermId, gate.term.status);
  if (lockReason) return Response.json({ error: lockReason }, { status: 409 });

  let fields;
  try {
    fields = parseProbationReviewInput(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid probation review." }, { status: 400 });
  }

  try {
    const now = new Date();
    const [review] = await db.insert(hcmProbationReviews).values({
      organizationId,
      employeeId,
      employmentTermId,
      status: "draft",
      ...fields,
      reviewerUserId: user.id,
      reviewerEmployeeId: user.employeeId ?? null,
      reviewerName: user.name,
      createdAt: now,
      updatedAt: now,
    }).returning();

    await recordProbationReviewEvent({
      organizationId,
      reviewId: review.id,
      employeeId,
      eventType: "created",
      actorUserId: user.id,
      actorName: user.name,
      metadata: { employmentTermId },
      createdAt: now,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM probation review opened",
      resource: `Employee #${employeeId}`,
      metadata: { probationReviewId: review.id, employmentTermId },
    });

    return Response.json({ review }, { status: 201 });
  } catch {
    return Response.json({ error: "A probation review already exists for this employment term." }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const id = Number(body.id);
  const action = String(body.action ?? "save").trim().toLowerCase();
  if (!Number.isInteger(organizationId) || !Number.isInteger(id) || !["save", "submit"].includes(action)) {
    return Response.json({ error: "Valid organizationId, review id, and save/submit action are required." }, { status: 400 });
  }

  const [existing] = await db.select().from(hcmProbationReviews).where(and(
    eq(hcmProbationReviews.id, id),
    eq(hcmProbationReviews.organizationId, organizationId),
  )).limit(1);
  if (!existing) return Response.json({ error: "Probation review not found." }, { status: 404 });

  const gate = await probationReviewAccess(
    user,
    organizationId,
    existing.employeeId,
    existing.employmentTermId,
  );
  if ("error" in gate) return gate.error;
  if (existing.status !== "draft") {
    return Response.json({ error: "Submitted probation reviews are immutable." }, { status: 409 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `hcm-probation-review-${action}`,
    resourceId: id,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "submit") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }

  const lockReason = await reviewMutable(organizationId, existing.employmentTermId, gate.term.status);
  if (lockReason) return Response.json({ error: lockReason }, { status: 409 });

  let fields;
  try {
    fields = parseProbationReviewInput(body, { requireComplete: action === "submit" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid probation review." }, { status: 400 });
  }

  const now = new Date();
  const [review] = await db.update(hcmProbationReviews).set({
    ...fields,
    status: action === "submit" ? "submitted" : "draft",
    submittedAt: action === "submit" ? now : null,
    updatedAt: now,
  }).where(and(
    eq(hcmProbationReviews.id, id),
    eq(hcmProbationReviews.status, "draft"),
  )).returning();
  if (!review) return Response.json({ error: "Probation review changed before this update." }, { status: 409 });

  await recordProbationReviewEvent({
    organizationId,
    reviewId: review.id,
    employeeId: review.employeeId,
    eventType: action === "submit" ? "submitted" : "updated",
    actorUserId: user.id,
    actorName: user.name,
    metadata: action === "submit"
      ? {
          recommendation: review.recommendation,
          ratings: probationReviewSnapshot(review).ratings,
        }
      : {},
    createdAt: now,
  });
  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: action === "submit" ? "HCM probation review submitted" : "HCM probation review updated",
    resource: `Employee #${review.employeeId}`,
    metadata: {
      probationReviewId: review.id,
      employmentTermId: review.employmentTermId,
      recommendation: review.recommendation,
    },
  });

  return Response.json({
    review,
    guardrail: "The submitted recommendation is evidence only. A separate governed employment decision remains required.",
  });
}
