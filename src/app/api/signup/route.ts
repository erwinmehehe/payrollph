import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, subscriptions, userOrganizations, users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { generateBackupCodes, hashPassword } from "@/lib/crypto";
import { isDemoUserEmail } from "@/lib/demo";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { normalizeEmail, passwordIssues, validEmail } from "@/lib/tokens";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await rateLimitDistributed(`signup:${clientIp(request)}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) {
    return Response.json({ error: "Too many account creation attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const companyName = String(body.companyName ?? "").trim();
  const legalName = String(body.legalName ?? "").trim() || companyName;
  const name = String(body.name ?? "").trim();
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const website = String(body.website ?? "").trim(); // honeypot

  if (website) {
    return Response.json({ ok: true }, { status: 201 });
  }

  const problems: string[] = [];
  if (companyName.length < 2) problems.push("Company name is required.");
  if (name.length < 2) problems.push("Your name is required.");
  if (!validEmail(email)) problems.push("A valid work email is required.");
  if (isDemoUserEmail(email)) problems.push("That address is reserved for the public demo.");
  problems.push(...passwordIssues(password));
  if (problems.length) return Response.json({ error: "Validation failed.", problems }, { status: 422 });

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return Response.json({ error: "An account already exists for that email. Sign in instead." }, { status: 409 });

  let organizationId: number | null = null;
  let userId: number | null = null;

  try {
    await db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({
        name: companyName,
        legalName,
        accountType: "business",
        plan: "Core",
        employeeCount: 0,
        color: "#176B5D",
      }).returning();

      const [user] = await tx.insert(users).values({
        email,
        name,
        passwordHash: hashPassword(password),
        role: "owner",
        totpEnabled: false,
        backupCodes: generateBackupCodes(),
      }).returning();

      await tx.insert(userOrganizations).values({
        userId: user.id,
        organizationId: organization.id,
        role: "owner",
      });

      await tx.insert(subscriptions).values({
        organizationId: organization.id,
        plan: "Core",
        status: "trialing",
        seatLimit: 10,
        trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
        periodStart: new Date(),
      });

      organizationId = organization.id;
      userId = user.id;
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    if (code === "23505") {
      return Response.json({ error: "An account already exists for that email." }, { status: 409 });
    }
    throw error;
  }

  if (!organizationId || !userId) {
    return Response.json({ error: "Could not create the workspace." }, { status: 500 });
  }

  await recordAuditEvent({
    organizationId,
    actor: name,
    action: "Workspace created via public signup",
    resource: companyName,
    metadata: { ownerEmail: email, plan: "Core", trialDays: 14 },
  });

  const { token, expiresAt } = await createSession(userId, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  return Response.json({
    ok: true,
    organizationId,
    redirectTo: "/",
    rateLimitMode: limited.mode,
  }, { status: 201 });
}
