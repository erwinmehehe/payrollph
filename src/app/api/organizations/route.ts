import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, userOrganizations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Roles permitted to rename the legal entity / workspace defaults. */
const ADMINS = new Set(["admin", "owner", "bookkeeper"]);

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [membership] = await db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.userId, user.id), eq(userOrganizations.organizationId, organizationId)))
    .limit(1);
  const role = membership?.role ?? "";
  if (!ADMINS.has(role)) {
    return Response.json({ error: `Your role (${role || "member"}) cannot edit the organization profile.` }, { status: 403 });
  }

  const name = String(body.name ?? "").trim();
  const legalName = String(body.legalName ?? "").trim();
  if (name.length < 2) return Response.json({ error: "Company name must be at least 2 characters." }, { status: 422 });

  const [updated] = await db.update(organizations).set({
    name,
    legalName: legalName || name,
  }).where(eq(organizations.id, organizationId)).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Organization profile updated",
    resource: updated.name,
    metadata: { legalName: updated.legalName },
  });

  return Response.json({ ok: true, organization: updated });
}
