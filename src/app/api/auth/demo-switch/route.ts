import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, userOrganizations, users } from "@/db/schema";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requestMeta } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/crypto";
import { DEMO_MODE, ensureSeedData } from "@/db/seed";
import { isDemoRole, type DemoRoleId } from "@/lib/demo-roles";

export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  if (!DEMO_MODE) {
    return Response.json({ error: "Demo accounts are disabled on this deployment." }, { status: 404 });
  }

  await ensureSeedData();

  const body = await request.json().catch(() => ({}));
  const requestedRole = String(body.role ?? "");
  if (!isDemoRole(requestedRole)) {
    return Response.json({ error: "Unknown demo role." }, { status: 400 });
  }

  const orgs = await db.select().from(organizations);
  const loom = orgs.find((org) => org.name === "Loom & Local");

  if (!loom) {
    return Response.json({ error: "Demo company data is unavailable." }, { status: 503 });
  }

  // Repair only the persona being opened. Demo identities are dedicated
  // accounts, so a role switch must never rewrite memberships for every other
  // persona. That avoids cross-session races when several people use the demo
  // at the same time.
  const account = DEMO_ACCOUNTS[requestedRole];

  let employeeId: number | null = null;
  if (account.employeeEmail) {
    const [employee] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.organizationId, loom.id), eq(employees.email, account.employeeEmail)))
      .limit(1);
    employeeId = employee?.id ?? null;
    if (!employeeId) {
      return Response.json({ error: `Demo employee for ${requestedRole} is unavailable.` }, { status: 503 });
    }
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
      organizationId: loom.id,
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

  // Each public persona is a dedicated demo identity and belongs only to the
  // sample company. Keeping one organization per persona removes confusing
  // client-switch states and makes every launch deterministic.
  const memberships = await db
    .select()
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, user.id));
  for (const membership of memberships) {
    if (membership.organizationId === loom.id) continue;
    await db.delete(userOrganizations).where(eq(userOrganizations.id, membership.id));
  }

  const activeUser = user;
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
