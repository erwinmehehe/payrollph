import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, employeePayProfiles, organizations, userOrganizations, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { encryptTotpSecret } from "../src/lib/security-secret";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.ESS_PROFILE_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(process.env.PII_LEGACY_READ_ENABLED, "false");

  // Base accounts and organization A come from the repository's existing
  // employee-import-synthetic-fixture.ts; do not create demo/public accounts.
  const base = JSON.parse(readFileSync("/tmp/build-block-fixture.json", "utf8"));
  const [tenantB] = await db.select({ id: organizations.id })
    .from(organizations).where(eq(organizations.id, base.existingId)).limit(1);
  assert.ok(tenantB, "The second fictional employer must exist");
  const [workerB] = await db.insert(employees).values({
    organizationId: tenantB.id,
    employeeNo: "ESS-ACCEPTANCE-B",
    firstName: "Fictional",
    lastName: "WorkerB",
    title: "Staff",
    avatarInitials: "FW",
    basicRate: "30000",
    startDate: "2026-10-01",
  }).returning({ id: employees.id });
  await db.insert(employeePayProfiles).values({
    organizationId: tenantB.id, employeeId: workerB.id, payBasis: "monthly",
    rateAmount: "30000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  });

  const mfa = encryptTotpSecret("JBSWY3DPEHPK3PXP");
  for (const role of ["employee", "hr"] as const) {
    const [user] = await db.insert(users).values({
      name: "Fictional " + role + " B",
      email: role + "-b@build-block.example.test",
      passwordHash: hashPassword("Synthetic-Build-Block-Only-2026!"),
      role,
      totpEnabled: true,
      totpSecret: mfa,
      employeeId: role === "employee" ? workerB.id : null,
    }).returning({ id: users.id });
    await db.insert(userOrganizations).values({
      organizationId: tenantB.id,
      userId: user.id,
      role,
    });
  }

  writeFileSync("/tmp/ess-profile-synthetic-fixture.json", JSON.stringify({
    organizationA: base.organizationId,
    organizationB: tenantB.id,
    employeeB: workerB.id,
  }), { mode: 0o600 });
  console.log("ESS fixture ready: 2 fictional employers, 2 employees, HR+employee per employer.");
}
main().catch((error) => {
  console.error("ESS fixture failed:", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
