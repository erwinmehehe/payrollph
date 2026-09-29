import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, userOrganizations, users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/crypto";
import { DEMO_MODE, ensureSeedData } from "@/db/seed";
import { ensurePublicDemoTenant } from "@/db/public-demo";
import { DEMO_ROLE_IDS, isDemoRole, type DemoRoleId } from "@/lib/demo-roles";
import { publicDemoHostAllowed } from "@/lib/demo-host";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";

export const dynamic = "force-dynamic";

async function preparePublicDemoTenant() {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await ensurePublicDemoTenant();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }

  throw lastError;
}

type DemoAccount = {
  email: string;
  name: string;
  userRole: string;
  membershipRole: string;
  employeeEmail?: string;
};

const DEMO_ACCOUNTS: Record<DemoRoleId, DemoAccount> = {
  owner: {
    email: "owner.demo@linaw.ph",
    name: "Andrea Lim",
    userRole: "owner",
    membershipRole: "owner",
  },
  hr: {
    email: "hr.demo@linaw.ph",
    name: "Aira Villanueva",
    userRole: "hr",
    membershipRole: "hr",
  },
  payroll: {
    email: "payroll.demo@linaw.ph",
    name: "Paolo Cruz",
    userRole: "payroll",
    membershipRole: "payroll",
  },
  checker: {
    email: "checker.demo@linaw.ph",
    name: "Mariel Santos",
    userRole: "checker",
    membershipRole: "checker",
  },
  employee: {
    email: "jonas.reyes@linaw.ph",
    name: "Jonas Reyes",
    userRole: "employee",
    membershipRole: "employee",
    employeeEmail: "jonas.reyes@linaw.ph",
  },
};

async function ensureDemoAccount(role: DemoRoleId, organizationId: number) {
  const account = DEMO_ACCOUNTS[role];

  let employeeId: number | null = null;
  if (account.employeeEmail) {
    const [employee] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.organizationId, organizationId), eq(employees.email, account.employeeEmail)))
      .limit(1);
    employeeId = employee?.id ?? null;
    if (!employeeId) throw new Error(`Demo employee for ${role} is unavailable.`);
  }

  let [user] = await db.select().from(users).where(eq(users.email, account.email)).limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        email: account.email,
        name: account.name,
        passwordHash: hashPassword("LinawDemo2026!"),
        role: account.userRole,
        totpEnabled: false,
        backupCodes: [],
        employeeId,
      })
      .returning();
  } else {
    [user] = await db
      .update(users)
      .set({
        name: account.name,
        role: account.userRole,
        employeeId,
      })
      .where(eq(users.id, user.id))
      .returning();
  }

  await db
    .insert(userOrganizations)
    .values({
      userId: user.id,
      organizationId,
      role: account.membershipRole,
      orgUnitId: null,
    })
    .onConflictDoUpdate({
      target: [userOrganizations.userId, userOrganizations.organizationId],
      set: {
        role: account.membershipRole,
        orgUnitId: null,
      },
    });

  const memberships = await db
    .select()
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, user.id));
  for (const membership of memberships) {
    if (membership.organizationId === organizationId) continue;
    await db.delete(userOrganizations).where(eq(userOrganizations.id, membership.id));
  }

  return user;
}

function publicDemoAllowed(request: Request) {
  if (DEMO_MODE && process.env.NODE_ENV !== "production") return true;

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (process.env.NODE_ENV !== "production" && (hostname === "127.0.0.1" || hostname === "localhost")) {
    return true;
  }

  return publicDemoHostAllowed(hostname, {
    configuredHosts: process.env.PUBLIC_DEMO_HOSTS,
  });
}

export async function POST(request: Request) {
  const limited = await rateLimitDistributed(`demo-switch:${clientIp(request)}`, { limit: 20, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many demo session requests. Try again shortly." }, { status: 429 });
  }

  if (!publicDemoAllowed(request)) {
    return Response.json({ error: "Demo accounts are disabled on this deployment." }, { status: 404 });
  }

  try {
    await ensureCoreCompatibilitySchema();
    if (DEMO_MODE && process.env.NODE_ENV !== "production") {
      await ensureSeedData();
    } else {
      await preparePublicDemoTenant();
    }
  } catch (error) {
    console.error("Public demo provisioning failed", error);
    return Response.json(
      { error: "The demo workspace could not be prepared. Please try again in a moment." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedRole = String(body.role ?? "");
  if (!isDemoRole(requestedRole)) {
    return Response.json({ error: "Unknown demo role." }, { status: 400 });
  }

  const [loom] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Loom & Local"))
    .limit(1);

  if (!loom) {
    return Response.json({ error: "Demo company data is unavailable." }, { status: 503 });
  }

  // Provision all five identities together so a Payroll Officer can immediately
  // submit to the Checker even if nobody has opened the Checker persona yet.
  const personaUsers = new Map<DemoRoleId, Awaited<ReturnType<typeof ensureDemoAccount>>>();
  try {
    for (const role of DEMO_ROLE_IDS) {
      personaUsers.set(role, await ensureDemoAccount(role, loom.id));
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Demo personas could not be prepared." },
      { status: 503 },
    );
  }

  const activeUser = personaUsers.get(requestedRole);
  if (!activeUser) {
    return Response.json({ error: "Demo persona is unavailable." }, { status: 503 });
  }

  const { token, expiresAt } = await createSession(activeUser.id, requestMeta(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  return Response.json({
    ok: true,
    user: {
      id: activeUser.id,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role,
      employeeId: activeUser.employeeId,
    },
    redirectTo: `/?demoRole=${requestedRole}`,
  });
}
