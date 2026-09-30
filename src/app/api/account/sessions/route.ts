import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { primaryOrganizationId } from "@/lib/access";
import { getSessionUser, revokeSessionsByIds } from "@/lib/auth";
import { canRevoke, sessionsSummary, toSessionViews } from "@/lib/account";
import { safeSessionSelect } from "@/lib/session-select";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const rows = await db.select(safeSessionSelect).from(sessions).where(eq(sessions.userId, user.id)).orderBy(asc(sessions.id));
  const views = toSessionViews(rows, user.sessionId);
  return Response.json({ sessions: views, summary: sessionsSummary(views) });
}

/**
 * Revokes one session by id, or all others when `all` is true. Ownership is
 * checked against the row's own userId, the client cannot revoke a session it
 * merely guessed the id of.
 */
export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Session revocation");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const revokeAllOthers = Boolean(body.all);
  const id = Number(body.id);

  const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));

  if (revokeAllOthers) {
    const targets = rows
      .filter((row) => canRevoke(row, user.id, user.sessionId).ok)
      .map((row) => row.id);
    const revoked = await revokeSessionsByIds(targets);
    if (revoked) {
      await recordAuditEvent({
        organizationId: await primaryOrganizationId(user.id),
        actor: user.name,
        action: "Sessions revoked",
        resource: "all other sessions",
        metadata: { count: revoked },
      });
    }
    return Response.json({ ok: true, revoked });
  }

  const target = rows.find((row) => row.id === id);
  if (!target) return Response.json({ error: "Session not found." }, { status: 404 });

  const verdict = canRevoke(target, user.id, user.sessionId);
  if (!verdict.ok) return Response.json({ error: verdict.reason }, { status: 403 });

  await revokeSessionsByIds([id]);
  await recordAuditEvent({
    organizationId: await primaryOrganizationId(user.id),
    actor: user.name,
    action: "Session revoked",
    resource: `session ${id}`,
    metadata: { sessionId: id },
  });

  return Response.json({ ok: true, revoked: 1 });
}
