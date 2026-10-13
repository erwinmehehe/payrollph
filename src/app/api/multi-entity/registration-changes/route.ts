import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, legalEntities, legalEntityProfileChangeRequests,
  legalEntityStatutoryRegistrations,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, ORG_ADMIN_ROLES } from "@/lib/access";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";
import { encryptGovernmentId, decryptGovernmentId } from "@/lib/government-id-crypto";
import { encryptBankAccount } from "@/lib/bank-account-crypto";
import { validateEmployerProfileChanges } from "@/lib/multi-entity-registration";

export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: "Versioned registrations are not enabled." }, { status: 404 });
const errorResponse = (error: string, status = 409) => Response.json({ error }, { status });
const enabled = () => criticalReleaseFlagEnabled("multiEntity") &&
  criticalReleaseFlagEnabled("multiEntityRegistrations");

async function authorize(request: Request, userId: number, organizationId: number, legalEntityId: number) {
  const denied = await assertOrganizationRole(userId, organizationId, ORG_ADMIN_ROLES);
  if (denied) return { ok: false as const, response: denied };
  const resolved = await resolveMultiEntityContext({ userId, organizationId, request });
  if (!resolved.ok) return { ok: false as const, response: resolved.response };
  if (resolved.context.group) return {
    ok: false as const, response: errorResponse("Group HR is read-only.", 403),
  };
  const scopeDenied = assertEntityResource(resolved.context, legalEntityId);
  if (scopeDenied) return { ok: false as const, response: scopeDenied };
  return { ok: true as const };
}

function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export async function GET(request: Request) {
  if (!enabled()) return unavailable();
  const user = await getSessionUser();
  if (!user) return errorResponse("Authentication required.", 401);
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const legalEntityId = Number(url.searchParams.get("legalEntityId"));
  if (!validId(organizationId) || !validId(legalEntityId)) return errorResponse("Invalid employer.", 400);
  const auth = await authorize(request, user.id, organizationId, legalEntityId);
  if (!auth.ok) return auth.response;
  const where = and(
    eq(legalEntityProfileChangeRequests.organizationId, organizationId),
    eq(legalEntityProfileChangeRequests.legalEntityId, legalEntityId),
  );
  const [requests, versions] = await Promise.all([
    db.select({
      id: legalEntityProfileChangeRequests.id,
      effectiveDate: legalEntityProfileChangeRequests.effectiveDate,
      changedFields: legalEntityProfileChangeRequests.changedFields,
      status: legalEntityProfileChangeRequests.status,
      reason: legalEntityProfileChangeRequests.reason,
      requestedByUserId: legalEntityProfileChangeRequests.requestedByUserId,
      decidedByUserId: legalEntityProfileChangeRequests.decidedByUserId,
      createdAt: legalEntityProfileChangeRequests.createdAt,
      decidedAt: legalEntityProfileChangeRequests.decidedAt,
    }).from(legalEntityProfileChangeRequests).where(where)
      .orderBy(desc(legalEntityProfileChangeRequests.id)).limit(40),
    db.select({
      id: legalEntityStatutoryRegistrations.id,
      revision: legalEntityStatutoryRegistrations.revision,
      effectiveDate: legalEntityStatutoryRegistrations.effectiveDate,
      approvedByUserId: legalEntityStatutoryRegistrations.approvedByUserId,
      createdAt: legalEntityStatutoryRegistrations.createdAt,
    }).from(legalEntityStatutoryRegistrations).where(and(
      eq(legalEntityStatutoryRegistrations.organizationId, organizationId),
      eq(legalEntityStatutoryRegistrations.legalEntityId, legalEntityId),
    )).orderBy(desc(legalEntityStatutoryRegistrations.revision)).limit(30),
  ]);
  // Proposals and approved profiles are encrypted, and never returned by GET.
  return Response.json({
    requests: requests.map(row => ({
      ...row, canReview: row.status === "pending_approval" && row.requestedByUserId !== user.id,
    })),
    versions, today: manilaCalendarDate(),
  }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: Request) {
  if (!enabled()) return unavailable();
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const user = await getSessionUser();
  if (!user) return errorResponse("Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const legalEntityId = Number(body.legalEntityId);
  if (!validId(organizationId) || !validId(legalEntityId))
    return errorResponse("Invalid employer.", 400);
  const auth = await authorize(request, user.id, organizationId, legalEntityId);
  if (!auth.ok) return auth.response;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const limit = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "entity-registration-propose", resourceId: legalEntityId,
  });
  if (limit) return limit;
  const validation = validateEmployerProfileChanges(body.changes);
  if (!validation.ok) return errorResponse(validation.error, 422);
  const reason = String(body.reason ?? "").trim().slice(0, 400);
  if (reason.length < 8) return errorResponse("A reason of at least eight characters is required.", 422);
  // No retroactive registration mutation or unimplemented future-date scheduler.
  const effectiveDate = String(body.effectiveDate ?? "");
  if (effectiveDate !== manilaCalendarDate())
    return errorResponse("Only today's Manila effective date is supported until version activation scheduling is reviewed.", 422);
  const [employer] = await db.select({ id: legalEntities.id })
    .from(legalEntities).where(and(
      eq(legalEntities.id, legalEntityId), eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
    )).limit(1);
  if (!employer) return errorResponse("Legal employer not found.", 404);
  try {
    const envelope = encryptGovernmentId(JSON.stringify(validation.changes), { required: true });
    if (!envelope) throw new Error("Encryption unavailable");
    const [record] = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(4288, ${legalEntityId})`);
      const [newRecord] = await tx.insert(legalEntityProfileChangeRequests).values({
        organizationId, legalEntityId,
        // PostgreSQL now() timestamps can contain microseconds. A JavaScript
        // Date drops those last digits, causing a false stale-version 409 in
        // the approval UPDATE even when the employer has not changed.
        // Capture the exact source timestamp INSIDE PostgreSQL. Never round
        // the approval comparison, which must still detect real concurrent edits.
        expectedEntityUpdatedAt: sql<Date>`(
          SELECT ${legalEntities.updatedAt} FROM ${legalEntities}
          WHERE ${legalEntities.id} = ${legalEntityId}
            AND ${legalEntities.organizationId} = ${organizationId}
            AND ${legalEntities.active} = true
        )`,
        effectiveDate, profileEnvelope: envelope, changedFields: validation.changedFields,
        reason, requestedByUserId: user.id,
      }).returning();
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name, action: "Employer profile change requested",
        resource: String(legalEntityId), metadata: {
          requestId: newRecord.id, changedFields: validation.changedFields,
          makerUserId: user.id, valuesRedacted: true,
        },
      });
      return [newRecord];
    });
    return Response.json({ id: record.id, status: record.status }, { status: 201 });
  } catch {
    // Unique pending guard, missing encryption key or DB conflict fail closed.
    return errorResponse("A reviewed registration request already exists, or a protected dependency is unavailable.");
  }
}

export async function PATCH(request: Request) {
  if (!enabled()) return unavailable();
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const user = await getSessionUser();
  if (!user) return errorResponse("Authentication required.", 401);
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const legalEntityId = Number(body.legalEntityId);
  const requestId = Number(body.requestId);
  const action = String(body.action ?? "");
  if (![organizationId, legalEntityId, requestId].every(validId) ||
      !["approve", "reject"].includes(action))
    return errorResponse("Invalid employer, change request or review action.", 400);
  const auth = await authorize(request, user.id, organizationId, legalEntityId);
  if (!auth.ok) return auth.response;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const limit = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "entity-registration-decide", resourceId: legalEntityId,
  });
  if (limit) return limit;
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(4288, ${legalEntityId})`);
      const [pending] = await tx.select().from(legalEntityProfileChangeRequests).where(and(
        eq(legalEntityProfileChangeRequests.id, requestId),
        eq(legalEntityProfileChangeRequests.organizationId, organizationId),
        eq(legalEntityProfileChangeRequests.legalEntityId, legalEntityId),
      )).limit(1);
      if (!pending || pending.status !== "pending_approval") throw new Error("Not pending");
      if (pending.requestedByUserId === user.id) throw new Error("Self-approval blocked");
      const [member] = await tx.select({ id: legalEntities.id, updatedAt: legalEntities.updatedAt })
        .from(legalEntities).where(and(
          eq(legalEntities.organizationId, organizationId), eq(legalEntities.id, legalEntityId),
          eq(legalEntities.active, true),
        )).limit(1);
      if (!member) throw new Error("Employer missing");
      // Another operator may have changed the employer while this was awaiting
      // approval; never replay stale registration or bank data.
      if (member.updatedAt.getTime() !== pending.expectedEntityUpdatedAt.getTime())
        throw new Error("Stale source version");
      let revision: number | null = null;
      if (action === "approve") {
        if (pending.effectiveDate !== manilaCalendarDate()) throw new Error("Expired effective date");
        const decoded = decryptGovernmentId(pending.profileEnvelope);
        const validation = validateEmployerProfileChanges(JSON.parse(decoded ?? "null"));
        if (!validation.ok) throw new Error("Invalid sealed proposal");
        const c = validation.changes;
        const patch = {
          ...(c.legalName !== undefined ? { legalName: c.legalName } : {}),
          ...(c.registeredAddress !== undefined ? { registeredAddress: c.registeredAddress } : {}),
          ...(c.birTin !== undefined ? { birTin: c.birTin } : {}),
          ...(c.birBranchCode !== undefined ? { birBranchCode: c.birBranchCode } : {}),
          ...(c.sssEmployerNo !== undefined ? { sssEmployerNo: c.sssEmployerNo } : {}),
          ...(c.philHealthEmployerNo !== undefined ? { philHealthEmployerNo: c.philHealthEmployerNo } : {}),
          ...(c.pagIbigEmployerNo !== undefined ? { pagIbigEmployerNo: c.pagIbigEmployerNo } : {}),
          ...(c.disbursementBankCode !== undefined ? { disbursementBankCode: c.disbursementBankCode } : {}),
          ...(c.disbursementAccountName !== undefined ? { disbursementAccountName: c.disbursementAccountName } : {}),
          ...(c.disbursementAccount !== undefined
            ? { disbursementAccount: encryptBankAccount(c.disbursementAccount) } : {}),
          updatedAt: new Date(),
        };
        const [updated] = await tx.update(legalEntities).set(patch).where(and(
          eq(legalEntities.id, legalEntityId), eq(legalEntities.organizationId, organizationId),
          eq(legalEntities.updatedAt, pending.expectedEntityUpdatedAt),
        )).returning();
        if (!updated) throw new Error("Employer changed concurrently");
        const [latest] = await tx.select({ revision: legalEntityStatutoryRegistrations.revision })
          .from(legalEntityStatutoryRegistrations).where(and(
            eq(legalEntityStatutoryRegistrations.organizationId, organizationId),
            eq(legalEntityStatutoryRegistrations.legalEntityId, legalEntityId),
          )).orderBy(desc(legalEntityStatutoryRegistrations.revision)).limit(1);
        revision = (latest?.revision ?? 0) + 1;
        // Version 1 starts on its actual approval date. Do not assert any
        // historic identity period when migrating legacy unversioned records.
        const fullProfile = {
          legalName: updated.legalName, registeredAddress: updated.registeredAddress,
          birTin: updated.birTin, birBranchCode: updated.birBranchCode,
          sssEmployerNo: updated.sssEmployerNo,
          philHealthEmployerNo: updated.philHealthEmployerNo,
          pagIbigEmployerNo: updated.pagIbigEmployerNo,
          disbursementBankCode: updated.disbursementBankCode,
          disbursementAccountName: updated.disbursementAccountName,
          disbursementAccount: updated.disbursementAccount,
        };
        const historyEnvelope = encryptGovernmentId(JSON.stringify(fullProfile), { required: true });
        if (!historyEnvelope) throw new Error("Encryption unavailable");
        await tx.insert(legalEntityStatutoryRegistrations).values({
          organizationId, legalEntityId, revision, effectiveDate: pending.effectiveDate,
          profileEnvelope: historyEnvelope, approvedByUserId: user.id, sourceChangeId: pending.id,
        });
      }
      const [decided] = await tx.update(legalEntityProfileChangeRequests).set({
        status: action === "approve" ? "approved" : "rejected",
        decidedByUserId: user.id, decidedAt: new Date(),
      }).where(and(eq(legalEntityProfileChangeRequests.id, requestId),
        eq(legalEntityProfileChangeRequests.status, "pending_approval"))).returning();
      if (!decided) throw new Error("Already decided");
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: action === "approve" ? "Employer profile version approved" : "Employer profile change rejected",
        resource: String(legalEntityId), metadata: {
          requestId, revision, changedFields: pending.changedFields,
          makerUserId: pending.requestedByUserId, checkerUserId: user.id,
          sensitiveValuesRedacted: true,
        },
      });
      return { id: decided.id, status: decided.status, revision };
    });
    return Response.json(result);
  } catch {
    return errorResponse("The request is stale, unapproved for this user, or cannot be safely applied.");
  }
}
