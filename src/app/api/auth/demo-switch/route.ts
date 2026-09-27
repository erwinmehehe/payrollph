import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, userOrganizations, users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requestMeta } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/crypto";
import { ensureSeedData } from "@/db/seed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await ensureSeedData();
  const body = await request.json().catch(() => ({}));
  const role = String(body.role ?? "bookkeeper"); // "bookkeeper" | "employee" | "freelancer" | "hr"

  let targetEmail = "celine@linaw.ph";
  let targetName = "Celine Yao";
  let targetRole = "bookkeeper";
  let targetEmployeeId: number | null = null;

  if (role === "employee") {
    targetEmail = "jonas.reyes@linaw.ph";
    targetName = "Jonas Reyes";
    targetRole = "employee";
    const [emp] = await db.select().from(employees).where(eq(employees.email, "jonas.reyes@linaw.ph")).limit(1);
    targetEmployeeId = emp?.id ?? 2;
  } else if (role === "freelancer") {
    targetEmail = "mika@linaw.ph";
    targetName = "Mika Ramos";
    targetRole = "owner";
  }

  let [user] = await db.select().from(users).where(eq(users.email, targetEmail)).limit(1);

  if (!user) {
    const [created] = await db.insert(users).values({
      email: targetEmail,
      name: targetName,
      passwordHash: hashPassword("LinawDemo2026!"),
      role: targetRole,
      totpEnabled: false,
      backupCodes: [],
      employeeId: targetEmployeeId,
    }).returning();
    user = created;

    const orgs = await db.select().from(organizations);
    if (orgs.length > 0) {
      await db.insert(userOrganizations).values(orgs.map((org) => ({
        userId: user.id,
        organizationId: org.id,
        role: targetRole === "employee" ? "employee" : "admin",
      }))).onConflictDoNothing();
    }
  } else if (targetEmployeeId && user.employeeId !== targetEmployeeId) {
    await db.update(users).set({ employeeId: targetEmployeeId, role: targetRole }).where(eq(users.id, user.id));
    user.employeeId = targetEmployeeId;
    user.role = targetRole;
  }

  const { token, expiresAt } = await createSession(user.id, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  return Response.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      employeeId: user.employeeId,
    },
    redirectTo: "/",
  });
}
