import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, orgUnits, userOrganizations, users } from "@/db/schema";
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
  target: "loom" | "businesses" | "freelancer";
  employeeEmail?: string;
  orgUnitCode?: string;
};

const DEMO_ACCOUNTS: Record<DemoRoleId, DemoAccount> = {
  owner: {
    email: "owner.demo@linaw.ph",
    name: "Andrea Lim",
    userRole: "owner",
    membershipRole: "owner",
    target: "loom",
  },
  bookkeeper: {
    email: "celine@linaw.ph",
    name: "Celine Yao",
    userRole: "bookkeeper",
    membershipRole: "bookkeeper",
    target: "businesses",
  },
  payroll: {
    email: "payroll.demo@linaw.ph",
    name: "Paolo Cruz",
    userRole: "payroll",
    membershipRole: "payroll",
    target: "loom",
  },
  hr: {
    email: "hr.demo@linaw.ph",
    name: "Aira Villanueva",
    userRole: "hr",
    membershipRole: "hr",
    target: "loom",
  },
  manager: {
    email: "manager.demo@linaw.ph",
    name: "Mariel Santos",
    userRole: "manager",
    membershipRole: "manager",
    target: "loom",
    orgUnitCode: "OPS",
  },
  employee: {
    email: "jonas.reyes@linaw.ph",
    name: "Jonas Reyes",
    userRole: "employee",
    membershipRole: "employee",
    target: "loom",
    employeeEmail: "jonas.reyes@linaw.ph",
  },
  freelancer: {
    email: "mika@linaw.ph",
    name: "Mika Ramos",
    userRole: "freelancer",
    membershipRole: "owner",
    target: "freelancer",
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
  const loom =
    orgs.find((org) => org.name === "Loom & Local") ??
    orgs.find((org) => org.accountType !== "freelancer");
  const freelancer = orgs.find((org) => org.accountType === "freelancer");

  if (!loom) {
    return Response.json({ error: "Demo company data is unavailable." }, { status: 503 });
  }

  // Create/repair every persona together. The role picker therefore always
  // has a real checker/manager identity available instead of several buttons
  // secretly sharing the bookkeeper account.
  const accounts = new Map<DemoRoleId, typeof users.$inferSelect>();
  for (const role of Object.keys(DEMO_ACCOUNTS) as DemoRoleId[]) {
    const account = DEMO_ACCOUNTS[role];

    let employeeId: number | null = null;
    if (account.employeeEmail) {
      const [employee] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.organizationId, loom.id), eq(employees.email, account.employeeEmail)))
        .limit(1);
      employeeId = employee?.id ?? null;
      if (!employeeId) {
        return Response.json({ error: `Demo employee for ${role} is unavailable.` }, { status: 503 });
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

    await db.delete(userOrganizations).where(eq(userOrganizations.userId, user.id));

    let targetOrganizations = [];
    if (account.target === "businesses") {
      targetOrganizations = orgs.filter((org) => org.accountType !== "freelancer");
    } else if (account.target === "freelancer") {
      if (!freelancer) {
        return Response.json({ error: "Demo freelancer data is unavailable." }, { status: 503 });
      }
      targetOrganizations = [freelancer];
    } else {
      targetOrganizations = [loom];
    }

    let orgUnitId: number | null = null;
    if (account.orgUnitCode) {
      const [unit] = await db
        .select()
        .from(orgUnits)
        .where(and(eq(orgUnits.organizationId, loom.id), eq(orgUnits.code, account.orgUnitCode)))
        .limit(1);
      orgUnitId = unit?.id ?? null;
    }

    if (targetOrganizations.length > 0) {
      await db.insert(userOrganizations).values(
        targetOrganizations.map((organization) => ({
          userId: user.id,
          organizationId: organization.id,
          role: account.membershipRole,
          orgUnitId: organization.id === loom.id ? orgUnitId : null,
        })),
      );
    }

    accounts.set(role, user);
  }

  const user = accounts.get(requestedRole);
  if (!user) {
    return Response.json({ error: "Demo account is unavailable." }, { status: 503 });
  }

  // Defensive check: no non-employee demo identity may carry an employee
  // self-service link left over from an older seed.
  if (requestedRole !== "employee" && user.employeeId != null) {
    const [cleaned] = await db
      .update(users)
      .set({ employeeId: null })
      .where(eq(users.id, user.id))
      .returning();
    accounts.set(requestedRole, cleaned);
  }

  const activeUser = accounts.get(requestedRole)!;
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
    redirectTo: requestedRole === "employee" ? "/" : `/?demoRole=${requestedRole}`,
  });
}
