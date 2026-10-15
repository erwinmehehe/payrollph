/**
 * Extend the existing core-modules synthetic fixture, never a live database.
 * This file does NOT make payroll runs or alter feature flags.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { users, userOrganizations } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { encryptTotpSecret } from "../src/lib/security-secret";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.DEMO_MODE, "false");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.port, "5432");
  const fixture = JSON.parse(readFileSync("/tmp/build-block-fixture.json", "utf8")) as { organizationId: number };
  assert.ok(Number.isSafeInteger(fixture.organizationId) && fixture.organizationId > 0);
  const manifest = JSON.parse(readFileSync("qa-artifacts/nav-sweep/manifest.json", "utf8")) as {
    roles: Array<{ role: string }>;
  };
  for (const { role } of manifest.roles) {
    const email = role + "@build-block.example.test";
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) continue; // owner/hr/manager/employee originate in existing fixture
    const [user] = await db.insert(users).values({
      name: "Synthetic " + role,
      email,
      passwordHash: hashPassword("Synthetic-Build-Block-Only-2026!"),
      role,
      totpEnabled: true,
      totpSecret: encryptTotpSecret("JBSWY3DPEHPK3PXP"),
    }).returning({ id: users.id });
    await db.insert(userOrganizations).values({
      userId: user.id, organizationId: fixture.organizationId, role, active: true,
    });
  }
  const roles = (await db.select({ role: userOrganizations.role }).from(userOrganizations))
    .map((entry) => entry.role);
  for (const { role } of manifest.roles) assert.ok(roles.includes(role), "Missing synthetic membership: " + role);
  console.log("Seeded " + manifest.roles.length + " fictional role accounts in disposable PostgreSQL.");
}
main().catch((error) => {
  console.error("Nav sweep fixture failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}).finally(() => pool.end());
