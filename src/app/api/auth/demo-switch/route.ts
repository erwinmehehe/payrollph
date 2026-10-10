import { enforceSameOriginMutation } from "@/lib/security-request";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, userOrganizations, users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { clientIp, rateLimitDistributed, requestMeta } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/crypto";
import { DEMO_MODE, ensureSeedData } from "@/db/seed";
import { ensurePublicDemoTenant } from "@/db/public-demo";
import { DEMO_ROLE_IDS, isDemoRole, type DemoRoleId } from "@/lib/demo-roles";
import { publicDemoRequestAllowed } from "@/lib/demo-host";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
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
  bookkeeper: {
    email: "bookkeeper.demo@linaw.ph",
    name: "Bea Navarro",
    userRole: "bookkeeper",
    membershipRole: "bookkeeper",
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

  return publicDemoRequestAllowed(request, {
    configuredHosts: process.env.PUBLIC_DEMO_HOSTS,
    appBaseUrl: process.env.APP_BASE_URL,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const limited = await rateLimitDistributed(`demo-switch:${clientIp(request)}`, { limit: 20, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({ error: "Too many demo session requests. Try again shortly." }, { status: 429 });
  }

  if (!publicDemoAllowed(request)) {
    return Response.json({ error: "Demo accounts are disabled on this deployment." }, { status: 404 });
  }

  // The public sandbox must never provision fixed demo identities on a
  // production database that already holds a real employer workspace.
  if (process.env.NODE_ENV === "production") {
    try {
      const [realEmployer] = await db.select({ id: organizations.id }).from(organizations)
        .where(ne(organizations.name, "Loom & Local")).limit(1);
      if (realEmployer) {
        return Response.json({ error: "Demo accounts are disabled on this deployment." }, { status: 404 });
      }
    } catch {
      return Response.json({ error: "Demo environment could not be verified." }, { status: 503 });
    }
  }

  try {
    await ensureCoreCompatibilitySchema();
    await ensureLeavePayrollSchema();
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

  // Launch the requested persona first. A stale secondary persona must never
  // block Owner/HR/Payroll/Checker/Bookkeeper from opening the sandbox.
  let activeUser: Awaited<ReturnType<typeof ensureDemoAccount>>;
  try {
    activeUser = await ensureDemoAccount(requestedRole, loom.id);
  } catch (error) {
    console.error("Requested demo persona provisioning failed", requestedRole, error);
    return Response.json(
      { error: "This demo role could not be prepared. Please try again in a moment." },
      { status: 503 },
    );
  }

  // Warm the other identities best-effort so cross-role handoffs work immediately.
  for (const role of DEMO_ROLE_IDS) {
    if (role === requestedRole) continue;
    try {
      await ensureDemoAccount(role, loom.id);
    } catch (error) {
      console.warn("Secondary demo persona provisioning skipped", role, error);
    }
  }

  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession(activeUser.id, requestMeta(request));
    const jar = await cookies();
    jar.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  } catch (error) {
    console.error("Public demo session creation failed", requestedRole, error);
    return Response.json(
      { error: "The demo session could not be created. Please try again in a moment." },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    demoDataMode: "synthetic-redacted",
    sensitiveFieldsPersisted: false,
    user: {
      id: activeUser.id,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role,
      employeeId: activeUser.employeeId,
    },
    organizationId: loom.id,
    redirectTo: `/app?demoRole=${requestedRole}`,
  });
}
