import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { saasSignupVerifications } from "@/lib/saas-billing-schema";
import { users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const limited = await rateLimitDistributed("signup-verify:" + clientIp(request), { limit: 10, windowMs: 60 * 60_000 });
  if (!limited.allowed) return Response.json({ error: "Too many verification attempts." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[a-f0-9]{48}$/.test(token)) return Response.json({ error: "Verification link is invalid or expired." }, { status: 422 });

  const verified = await db.transaction(async (tx) => {
    const [pending] = await tx.update(saasSignupVerifications)
      .set({ verifiedAt: new Date() })
      .where(and(
        eq(saasSignupVerifications.tokenHash, sha256(token)),
        isNull(saasSignupVerifications.verifiedAt),
        gt(saasSignupVerifications.expiresAt, new Date()),
      ))
      .returning({ userId: saasSignupVerifications.userId, organizationId: saasSignupVerifications.organizationId });
    if (!pending) return null;
    const [owner] = await tx.update(users).set({ active: true })
      .where(and(eq(users.id, pending.userId), eq(users.role, "owner")))
      .returning({ id: users.id, name: users.name, email: users.email });
    if (!owner) throw new Error("Owner verification record is invalid.");
    return { ...pending, owner };
  });
  if (!verified) return Response.json({ error: "Verification link is invalid, expired or already used." }, { status: 422 });
  const session = await createSession(verified.userId, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  await recordAuditEvent({
    organizationId: verified.organizationId,
    actor: verified.owner.name,
    action: "Self-service company email verified",
    resource: "Owner access enabled; subscription awaiting payment",
    metadata: { userId: verified.userId },
  });
  return Response.json({ ok: true, redirectTo: "/billing/setup" });
}
