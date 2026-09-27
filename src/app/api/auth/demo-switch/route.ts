import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, userOrganizations, users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/crypto";
import { DEMO_MODE, ensureSeedData } from "@/db/seed";
import {
  DEMO_BOOKKEEPER_EMAIL,
  DEMO_EMPLOYEE_EMAIL,
  DEMO_FREELANCER_EMAIL,
  DEMO_ORGANIZATION_NAMES,
} from "@/lib/demo";

export const dynamic = "force-dynamic";

type DemoRole = "bookkeeper" | "employee" | "freelancer";

export async function POST(request: Request) {
  if (!DEMO_MODE) {
    return Response.json({ error: "Public demo is not enabled." }, { status: 404 });
  }

  const limited = await rateLimitDistributed(`public-demo:${clientIp(request)}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) {
    return Response.json({ error: "Too many demo launches. Please try again later." }, { status: 429 });
  }

  await ensureSeedData();

  const body = await request.json().catch(() => ({}));
  const requestedRole = String(body.role ?? "bookkeeper");
  if (!["bookkeeper", "employee", "freelancer"].includes(requestedRole)) {
    return Response.json({ error: "Unknown demo role." }, { status: 400 });
  }
  const role = requestedRole as DemoRole;

  const demoOrgs = await db.select().from(organizations).where(inArray(organizations.name, [...DEMO_ORGANIZATION_NAMES]));
  if (demoOrgs.length === 0) {
    return Response.json({
      error: "Demo data is not initialized. Enable DEMO_MODE before the first database boot, then restart the app.",
    }, { status: 503 });
  }

  const businessDemoOrgs = demoOrgs.filter((org) => org.accountType !== "freelancer");
  const freelancerOrg = demoOrgs.find((org) => org.accountType === "freelancer");
  const primaryBusinessOrg = businessDemoOrgs.find((org) => org.name === DEMO_ORGANIZATION_NAMES[0]) ?? businessDemoOrgs[0];

  let targetEmail = DEMO_BOOKKEEPER_EMAIL;
  let targetName = "Celine Yao";
  let targetRole = "bookkeeper";
  let targetEmployeeId: number | null = null;
  let allowedOrganizationIds = demoOrgs.map((org) => org.id);

  if (role === "employee") {
    targetEmail = DEMO_EMPLOYEE_EMAIL;
    targetName = "Jonas Reyes";
    targetRole = "employee";
    allowedOrganizationIds = primaryBusinessOrg ? [primaryBusinessOrg.id] : [];

    if (primaryBusinessOrg) {
      const [emp] = await db.select().from(employees).where(and(
        eq(employees.organizationId, primaryBusinessOrg.id),
        eq(employees.email, DEMO_EMPLOYEE_EMAIL),
      )).limit(1);
      targetEmployeeId = emp?.id ?? null;
    }
  } else if (role === "freelancer") {
    targetEmail = DEMO_FREELANCER_EMAIL;
    targetName = "Mika Ramos";
    targetRole = "owner";
    allowedOrganizationIds = freelancerOrg ? [freelancerOrg.id] : [];
  }

  if (allowedOrganizationIds.length === 0) {
    return Response.json({ error: "The selected demo workspace is not available." }, { status: 503 });
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
  } else if (user.employeeId !== targetEmployeeId || user.role !== targetRole || user.name !== targetName) {
    const [updated] = await db.update(users).set({
      employeeId: targetEmployeeId,
      role: targetRole,
      name: targetName,
    }).where(eq(users.id, user.id)).returning();
    user = updated ?? user;
  }

  // Critical isolation boundary: old builds could accidentally attach the demo
  // identity to every organization. Delete every membership and recreate only
  // the fixed sandbox memberships before issuing a session.
  await db.delete(userOrganizations).where(eq(userOrganizations.userId, user.id));
  await db.insert(userOrganizations).values(allowedOrganizationIds.map((organizationId) => ({
    userId: user.id,
    organizationId,
    role: targetRole === "employee" ? "employee" : targetRole === "owner" ? "owner" : "admin",
  }))).onConflictDoNothing();

  const { token, expiresAt } = await createSession(user.id, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  return Response.json({
    ok: true,
    demo: true,
    rateLimitMode: limited.mode,
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
