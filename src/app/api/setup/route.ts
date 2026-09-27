import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { generateBackupCodes, hashPassword } from "@/lib/crypto";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { normalizeEmail, passwordIssues, validEmail } from "@/lib/tokens";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** True only when the instance has no user accounts yet. */
export async function needsSetup() {
  const [{ value }] = await db.select({ value: count() }).from(users);
  return value === 0;
}

export async function GET() {
  return Response.json({ needsSetup: await needsSetup() });
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`setup:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many setup attempts." }, { status: 429 });
  }

  if (!(await needsSetup())) {
    return Response.json({ error: "Setup is already complete. Sign in instead." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
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

  const [organization] = await db.insert(organizations).values({
    name: companyName,
    legalName,
    accountType: "business",
    plan: "Core",
    employeeCount: 0,
    color: "#176B5D",
  }).returning();

  const [user] = await db.insert(users).values({
    email,
    name,
    passwordHash: hashPassword(password),
    role: "owner",
    totpEnabled: false,
    backupCodes: generateBackupCodes(),
  }).returning();

  await db.insert(userOrganizations).values({
    userId: user.id,
    organizationId: organization.id,
    role: "owner",
  });

  await recordAuditEvent({
    organizationId: organization.id,
    actor: name,
    action: "Workspace created via first-run setup",
    resource: companyName,
    metadata: { ownerEmail: email },
  });

  const { token, expiresAt } = await createSession(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  return Response.json({
    ok: true,
    organizationId: organization.id,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    nextStep: "Enable TOTP from Settings → Security before inviting staff.",
  }, { status: 201 });
}
