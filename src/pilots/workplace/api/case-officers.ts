/**
 * SOURCE-ONLY PILOT: deliberately NOT registered under src/app.
 * Tenant-isolation inventory requires real own/foreign PG16 HTTP receipts,
 * independently reviewed before route promotion. Do not import into a
 * live route or expose under production flags without those proofs.
 */
import { and, eq, or, ne } from "drizzle-orm";
import { db } from "@/db";
import { userOrganizations, users } from "@/db/schema";
import { workplaceCaseOfficers, workplaceProtectedCases } from "@/db/workplace-compliance-schema";
import { recordAuditEvent } from "@/lib/audit";
import { getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { workplaceAdmin, workplaceFeatureEnabled, workplaceMember, workplacePrivateHeaders } from "@/lib/ph-workplace-context";
import { positiveId } from "@/lib/ph-workplace-compliance-policy";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const notEnabled = () => Response.json({ error: "Not found." }, { status: 404 });

/** Only members of the exact employer see the appointed intake-officer directory. */
export async function GET(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return notEnabled();
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = positiveId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const scope = await workplaceMember(session.id, organizationId);
  if (scope.denied) return scope.denied;
  const people = await db.select({
    userId: workplaceCaseOfficers.userId, name: users.name,
  }).from(workplaceCaseOfficers).innerJoin(users, eq(workplaceCaseOfficers.userId, users.id))
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.userId, users.id),
      eq(userOrganizations.organizationId, workplaceCaseOfficers.organizationId),
    ))
    .where(and(
      eq(workplaceCaseOfficers.organizationId, organizationId),
      eq(workplaceCaseOfficers.legalEntityId, scope.legalEntityId!),
      eq(workplaceCaseOfficers.active, true),
      eq(users.active, true), eq(userOrganizations.active, true),
    )).limit(40);
  return Response.json({ officers: people,
    note: "Appointed officers are not an independently certified CODI roster. Employer must separately document composition, impartiality and conflicts.",
  }, { headers: workplacePrivateHeaders });
}

export async function POST(request: Request) {
  if (!workplaceFeatureEnabled("phProtectedCases")) return notEnabled();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(session.email, "Changing protected case officer appointments");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const targetUserId = positiveId(body.userId);
  if (!organizationId || !targetUserId || !["appoint", "revoke"].includes(String(body.action))) {
    return Response.json({ error: "Valid organization, user and action required." }, { status: 400 });
  }
  const scope = await workplaceAdmin(session.id, organizationId);
  if (scope.denied) return scope.denied;
  const admin = await getAccess(session.id, organizationId);
  if (!admin?.companyWide || !["owner", "admin"].includes(admin.role) || session.id === targetUserId) {
    return Response.json({ error: "Independent company-wide owner/admin appointment required." }, { status: 403 });
  }
  const mfa = requireSensitiveActionMfa(session);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: session.id, action: "ph-officer-appointment", resourceId: organizationId, limit: 10, windowMs: 300_000,
  });
  if (rate) return rate;
  const [eligible] = await db.select({ id: users.id })
    .from(users).innerJoin(userOrganizations, eq(userOrganizations.userId, users.id)).where(and(
      eq(users.id, targetUserId), eq(users.active, true),
      eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.active, true),
    )).limit(1);
  if (!eligible) return Response.json({ error: "Active employer member required." }, { status: 404 });
  try {
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select().from(workplaceCaseOfficers).where(and(
        eq(workplaceCaseOfficers.organizationId, organizationId),
        eq(workplaceCaseOfficers.legalEntityId, scope.legalEntityId!),
        eq(workplaceCaseOfficers.userId, targetUserId),
      )).for("update").limit(1);
      if (body.action === "revoke" && !existing?.active) throw new Error("NOT_ACTIVE");
      if (body.action === "appoint" && existing?.active) throw new Error("ALREADY_ACTIVE");
      if (body.action === "revoke") {
        const [activeCase] = await tx.select({ id: workplaceProtectedCases.id }).from(workplaceProtectedCases)
          .where(and(eq(workplaceProtectedCases.organizationId, organizationId),
            eq(workplaceProtectedCases.legalEntityId, scope.legalEntityId!),
            ne(workplaceProtectedCases.status, "closed"),
            or(eq(workplaceProtectedCases.investigatorUserId, targetUserId),
              eq(workplaceProtectedCases.reviewerUserId, targetUserId)),
          )).limit(1);
        if (activeCase) throw new Error("OPEN_CASES");
      }
      const [row] = body.action === "appoint"
        ? existing
          ? await tx.update(workplaceCaseOfficers).set({
              active: true, revokedAt: null, appointedAt: new Date(), appointedByUserId: session.id,
            }).where(eq(workplaceCaseOfficers.id, existing.id)).returning()
          : await tx.insert(workplaceCaseOfficers).values({
              organizationId, legalEntityId: scope.legalEntityId!, userId: targetUserId,
              appointedByUserId: session.id,
            }).returning()
        : await tx.update(workplaceCaseOfficers).set({
            active: false, revokedAt: new Date(),
          }).where(eq(workplaceCaseOfficers.id, existing!.id)).returning();
      await recordAuditEvent({
        organizationId, actor: session.name, action: "Protected case officer " + String(body.action),
        resource: String(row.id), metadata: { officerUserId: targetUserId, active: row.active,
          legalEntityId: scope.legalEntityId },
      }, tx);
      return { id: row.id, userId: row.userId, active: row.active };
    });
    return Response.json({ officer: result }, { headers: workplacePrivateHeaders });
  } catch {
    return Response.json({
      error: "Appointment could not be changed. Active investigations must be reassigned through reviewed process first.",
    }, { status: 409 });
  }
}
