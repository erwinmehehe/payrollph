import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { sessionsSummary, toSessionViews } from "@/lib/account";
import { safeSessionSelect } from "@/lib/session-select";

export const dynamic = "force-dynamic";

/**
 * Everything the account screen needs in one read: identity, security posture
 * and the list of sessions this account can revoke.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!account) return Response.json({ error: "Account not found." }, { status: 404 });

  const rows = await db.select(safeSessionSelect).from(sessions).where(eq(sessions.userId, user.id));
  const views = toSessionViews(rows, user.sessionId);

  return Response.json({
    profile: {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      createdAt: account.createdAt,
    },
    security: {
      passwordAuth: true,
      totpEnabled: account.totpEnabled,
      backupCodes: Array.isArray(account.backupCodes) ? (account.backupCodes as string[]).length : 0,
      accountLockedUntil: account.lockedUntil,
      sessionDays: 14,
    },
    sessions: views,
    summary: sessionsSummary(views),
  });
}
