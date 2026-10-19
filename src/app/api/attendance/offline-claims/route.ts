import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, offlinePunchClaims } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { rateLimitDistributed } from "@/lib/rate-limit";
import { sameOfflineClaimReplay } from "@/lib/offline-claim-replay";

export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Offline punch review disabled." }, { status: 404 });
const failure = (error: string, status = 400) => Response.json({ error }, { status });
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

async function member(userId: number, organizationId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return failure("Valid employer required.");
  return await assertMembership(userId, organizationId);
}
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("faceOfflinePunch")) return unavailable();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const user = await getSessionUser();
  if (!user) return failure("Sign in required.", 401);
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const denied = await member(user.id, organizationId);
  if (denied) return denied;
  const membership = await getAccess(user.id, organizationId);
  if (membership?.role === "employee") {
    if (!user.employeeId) return failure("Employee account must be linked.", 403);
    const rows = await db.select({
      id: offlinePunchClaims.id, organizationId: offlinePunchClaims.organizationId,
      actionType: offlinePunchClaims.actionType,
      claimedAt: offlinePunchClaims.claimedAt, status: offlinePunchClaims.status,
      createdAt: offlinePunchClaims.createdAt,
    }).from(offlinePunchClaims).where(and(
      eq(offlinePunchClaims.organizationId, organizationId),
      eq(offlinePunchClaims.employeeId, user.employeeId),
    )).orderBy(desc(offlinePunchClaims.createdAt)).limit(40);
    return Response.json({ organizationId, claims: rows }, { headers: { "Cache-Control": "private,no-store" } });
  }
  const deniedRole = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (deniedRole) return deniedRole;
  const access = await getAccess(user.id, organizationId);
  if (!access || !["owner","admin","hr"].includes(access.role)) return failure("Authorized HR reviewers only.", 403);
  const rows = await db.select({
    id: offlinePunchClaims.id, organizationId: offlinePunchClaims.organizationId,
    employeeId: offlinePunchClaims.employeeId,
    submittedByUserId: offlinePunchClaims.submittedByUserId,
    actionType: offlinePunchClaims.actionType, claimedAt: offlinePunchClaims.claimedAt,
    status: offlinePunchClaims.status, createdAt: offlinePunchClaims.createdAt,
    reviewedAt: offlinePunchClaims.reviewedAt, reviewNote: offlinePunchClaims.reviewNote,
    firstName: employees.firstName, lastName: employees.lastName,
  }).from(offlinePunchClaims).innerJoin(employees, eq(offlinePunchClaims.employeeId, employees.id))
    .where(and(
      eq(offlinePunchClaims.organizationId, organizationId),
      eq(employees.organizationId, organizationId),
      access.companyWide ? undefined : eq(employees.orgUnitId, access.orgUnitId!),
    )).orderBy(desc(offlinePunchClaims.createdAt)).limit(100);
  return Response.json({ organizationId, claims: rows.map(row => ({
    ...row, employeeName: row.firstName + " " + row.lastName,
    firstName: undefined, lastName: undefined,
  })) }, { headers: { "Cache-Control": "private,no-store" } });
}
export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("faceOfflinePunch")) return unavailable();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return failure("Sign in required.", 401);
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return failure("A JSON object is required.",400);
  const body = payload as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const access = Number.isSafeInteger(organizationId) && organizationId > 0
    ? await getAccess(user.id, organizationId) : null;
  if (access?.role !== "employee" || !user.employeeId)
    return failure("Only the linked employee can submit their own offline attendance claim.",403);
  const denied = await member(user.id, organizationId); if (denied) return denied;
  const employeeId = Number(body.employeeId);
  const eventId = String(body.clientEventId ?? "");
  const actionType = String(body.actionType ?? "");
  const claimedAt = new Date(String(body.claimedAt ?? ""));
  const now = Date.now();
  if (employeeId !== user.employeeId || !UUID.test(eventId)
    || !["clock_in","clock_out"].includes(actionType)
    || !Number.isFinite(claimedAt.getTime())
    || claimedAt.getTime() > now + 5*60_000
    || claimedAt.getTime() < now - 7*24*60*60_000
    || body.acknowledged !== true) return failure("Offline claim must belong to this employee, use a valid recent timestamp, and acknowledge that it is unverified.",422);
  const [worker] = await db.select({ id: employees.id }).from(employees).where(and(
    eq(employees.organizationId, organizationId), eq(employees.id, employeeId),
  )).limit(1);
  if (!worker) return failure("Employee not in this workspace.",403);
  const limit = await rateLimitDistributed("offline-punch-claim:" + organizationId + ":" + user.id,
    { limit: 10, windowMs: 24*60*60_000 });
  // A per-process fallback cannot enforce a durable cross-instance intake bound.
  if (limit.mode !== "distributed-postgres")
    return failure("Offline claim service cannot verify its shared rate limit. Retry later.",503);
  if (!limit.allowed) return failure("Too many attendance claims; contact HR.",429);
  const created = await db.transaction(async tx => {
    const [row] = await tx.insert(offlinePunchClaims).values({
      organizationId, employeeId, submittedByUserId: user.id, clientEventId: eventId,
      actionType, claimedAt, status: "pending_review",
    }).onConflictDoNothing().returning();
    if (row) await tx.insert(auditEvents).values({
      organizationId, actor: user.name, action: "Offline attendance claim submitted (unverified)",
      resource: String(row.id), metadata: {
        actorUserId: user.id, employeeId, actionType, claimedAt: claimedAt.toISOString(),
        noAttendanceLedgerWrite: true,
      },
    });
    return row;
  });
  if (!created) {
    // A unique-key clash is an idempotent replay ONLY when the actual stored
    // actor, action and timestamp match. Never acknowledge a changed claim.
    const [prior] = await db.select({
      id: offlinePunchClaims.id, submittedByUserId: offlinePunchClaims.submittedByUserId,
      actionType: offlinePunchClaims.actionType, claimedAt: offlinePunchClaims.claimedAt,
    }).from(offlinePunchClaims).where(and(
      eq(offlinePunchClaims.organizationId, organizationId),
      eq(offlinePunchClaims.employeeId, employeeId),
      eq(offlinePunchClaims.clientEventId, eventId),
    )).limit(1);
    if (!prior || !sameOfflineClaimReplay(prior, {
      submittedByUserId: user.id, actionType, claimedAt,
    })) return failure("The offline event ID was already used for a different claim.",409);
    return Response.json({ received: true, claimId: prior.id, replayed: true, verified: false,
      message: "Already received for HR review, not clocked in/out." },
      { status: 200, headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({ received: true, claimId: created.id, replayed: false, verified: false,
    message: "Received for HR review, not clocked in/out." },
    { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("faceOfflinePunch")) return unavailable();
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return failure("Sign in required.",401);
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return failure("A JSON object is required.", 400);
  const body = payload as Record<string, unknown>;
  const organizationId = Number(body.organizationId), id = Number(body.id);
  const action = String(body.action ?? "");
  const note = String(body.note ?? "").trim();
  if (![organizationId,id].every(x => Number.isSafeInteger(x) && x > 0)
    || !["flag","dismiss"].includes(action) || note.length < 12 || note.length > 400)
    return failure("Valid case, flag/dismiss decision and 12–400 character reviewer note are required.",422);
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access || !["owner","admin","hr"].includes(access.role)) return failure("HR reviewer role required.",403);
  const [claim] = await db.select({
    item: offlinePunchClaims, orgUnitId: employees.orgUnitId,
  }).from(offlinePunchClaims).innerJoin(employees,eq(offlinePunchClaims.employeeId,employees.id))
    .where(and(eq(offlinePunchClaims.id,id),eq(offlinePunchClaims.organizationId,organizationId),
      eq(employees.organizationId, organizationId))).limit(1);
  if (!claim || (!access.companyWide && claim.orgUnitId !== access.orgUnitId))
    return failure("Claim not available.",404);
  if (claim.item.submittedByUserId === user.id)
    return failure("The claimant cannot independently review the same claim.",403);
  const [updated] = await db.transaction(async tx => {
    const [row] = await tx.update(offlinePunchClaims).set({
      status: action==="flag" ? "flagged" : "dismissed",
      reviewNote: note, reviewedByUserId: user.id, reviewedAt: new Date(),
    }).where(and(eq(offlinePunchClaims.id,id),eq(offlinePunchClaims.organizationId,organizationId),
      eq(offlinePunchClaims.status, "pending_review"))).returning();
    if (!row) return [null];
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: action==="flag" ? "Offline attendance claim flagged for correction" : "Offline attendance claim dismissed",
      resource: String(id), metadata: { reviewerUserId: user.id, employeeId: row.employeeId,
        noPayrollOrTimePunchMutation: true } });
    return [row];
  });
  if (!updated) return failure("Already reviewed or changed; reload the queue.",409);
  return Response.json({ claim: updated, verified: false,
    nextAction: action==="flag" ? "Use the existing governed attendance correction workflow." : "No attendance modification." });
}
