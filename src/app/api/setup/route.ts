import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizations, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { normalizeEmail, passwordIssues, validEmail } from "@/lib/tokens";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** True only when the instance has no user accounts yet. */
export async function needsSetup() {
  const [{ value }] = await db.select({ value: count() }).from(users);
  return value === 0;
}

export async function GET() {
  return Response.json({
    needsSetup: await needsSetup(),
    setupProtected: process.env.NODE_ENV === "production",
  });
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`setup:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many setup attempts." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));

  if (process.env.NODE_ENV === "production") {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) {
      return Response.json(
        { error: "First-run setup is disabled until SETUP_TOKEN is configured." },
        { status: 503 },
      );
    }
    const supplied = request.headers.get("x-setup-token")
      ?? (typeof body.setupToken === "string" ? body.setupToken : null);
    if (!constantTimeSecretEqual(supplied, expected)) {
      return Response.json({ error: "A valid setup token is required." }, { status: 401 });
    }
  }

  const companyName = String(body.companyName ?? "").trim();
  const legalName = String(body.legalName ?? "").trim() || companyName;
  const name = String(body.name ?? "").trim();
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const problems: string[] = [];
  if (companyName.length < 2) problems.push("Company name is required.");
  if (name.length < 2) problems.push("Your name is required.");
  if (!validEmail(email)) problems.push("A valid email is required.");
  problems.push(...passwordIssues(password));
  if (problems.length) return Response.json({ error: "Validation failed.", problems }, { status: 422 });

  const created = await db.transaction(async (tx) => {
    // Only one request can pass the zero-user bootstrap gate at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('linaw-first-run-setup-v1'))`);

    const [{ value }] = await tx.select({ value: count() }).from(users);
    if (value !== 0) return null;

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
      backupCodes: [],
    }).returning();

    await tx.insert(userOrganizations).values({
      userId: user.id,
      organizationId: organization.id,
      role: "owner",
    });

    return { organization, user };
  });

  if (!created) {
    return Response.json({ error: "Setup is already complete. Sign in instead." }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId: created.organization.id,
    actor: name,
    action: "Workspace created via first-run setup",
    resource: companyName,
    metadata: { ownerEmail: email },
  });

  const { token, expiresAt } = await createSession(created.user.id, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  return Response.json({
    ok: true,
    organizationId: created.organization.id,
    user: {
      id: created.user.id,
      email: created.user.email,
      name: created.user.name,
      role: created.user.role,
    },
    nextStep: "Enable TOTP from Settings → Security before inviting staff.",
  }, { status: 201 });
}
