import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { primaryOrganizationId } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Renames the signed-in user's display name (not their login email). */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "Name must be between 2 and 120 characters." }, { status: 422 });
  }

  const [updated] = await db.update(users).set({ name }).where(eq(users.id, user.id)).returning({ id: users.id, name: users.name });

  await recordAuditEvent({
    organizationId: await primaryOrganizationId(user.id),
    actor: user.name,
    action: "Display name updated",
    resource: updated.name,
    metadata: { previousName: user.name },
  });

  return Response.json({ ok: true, name: updated.name });
}
