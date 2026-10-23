import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { db, pool } from "../src/db";
import { organizationModuleSettings } from "../src/lib/tenant-module-storage";
import { organizations, employees, employeePayProfiles, users, userOrganizations, orgUnits, subscriptions } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { encryptTotpSecret } from "../src/lib/security-secret";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const address = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(address.hostname));
  assert.equal(address.pathname, "/app_db");
  assert.equal((await db.select().from(organizations)).length, 0, "An empty disposable database is required");
  // This test-only installation exercises the actual proposed SQL against disposable PG16.
  // Production migrations must use the reviewed executor; never call db:push there.
  await pool.query(readFileSync("drizzle/0122_tenant_module_disclosure.sql", "utf8"));
  const [tenant, existing] = await db.insert(organizations).values([
    { name: "Synthetic new employer", legalName: "Synthetic employer" },
    { name: "Synthetic existing employer", legalName: "Synthetic employer" },
  ]).returning();
  await db.update(organizationModuleSettings).set({ moduleNavigationMode: "all" }).where(eq(organizationModuleSettings.id, existing.id));
  const [unit] = await db.insert(orgUnits).values({ organizationId: tenant.id, code: "OPS", name: "Operations", type: "Department" }).returning();
  const [employee] = await db.insert(employees).values({ organizationId: tenant.id, orgUnitId: unit.id, employeeNo: "SYNTHETIC-SELF", firstName: "Synthetic", lastName: "Worker", title: "Staff", avatarInitials: "SW", basicRate: "30000", startDate: "2026-10-01" }).returning();
  // Fixture-created employees must carry their explicit monthly pay profile.
  // Request-time schema/data repair is deliberately retired by this PR.
  await db.insert(employeePayProfiles).values({
    organizationId: tenant.id, employeeId: employee.id, payBasis: "monthly",
    rateAmount: "30000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  });
  const totpSecret = encryptTotpSecret("JBSWY3DPEHPK3PXP");
  for (const role of ["owner", "hr", "manager", "employee"]) {
    const [user] = await db.insert(users).values({ name: "Synthetic " + role, email: role + "@build-block.example.test", passwordHash: hashPassword("Synthetic-Build-Block-Only-2026!"), role, totpEnabled: true, totpSecret, employeeId: role === "employee" ? employee.id : null }).returning();
    await db.insert(userOrganizations).values({ userId: user.id, organizationId: tenant.id, role, orgUnitId: role === "manager" ? unit.id : null });
    if (role === "owner") await db.insert(userOrganizations).values({ userId: user.id, organizationId: existing.id, role });
  }
  await db.insert(subscriptions).values([tenant.id, existing.id].map(organizationId => ({ organizationId, plan: "Core", status: "active" })));
  writeFileSync("/tmp/build-block-fixture.json", JSON.stringify({ organizationId: tenant.id, existingId: existing.id }), { mode: 0o600 });
  console.log("Disposable role fixtures seeded; no live accounts or external providers used.");
}
main().catch(() => { console.error("Disposable browser fixture failed."); process.exitCode = 1; });
