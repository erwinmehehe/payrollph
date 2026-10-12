import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { db, pool } from "../src/db";
import { organizations, userOrganizations, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.INLINE_FIRST_PAYROLL_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/app_db");
  const [tenant, foreign] = await db.insert(organizations).values([
    { name: "Synthetic Inline Employer", legalName: "Synthetic Inline Employer" },
    { name: "Foreign Inline Employer", legalName: "Foreign Inline Employer" },
  ]).returning();
  for (const role of ["owner", "hr", "payroll", "checker"] as const) {
    const [user] = await db.insert(users).values({ email: `inline-${role}@example.test`, name: `Synthetic ${role}`, role, passwordHash: hashPassword("Synthetic-Inline-QA-Only-2026!") }).returning();
    await db.insert(userOrganizations).values({ organizationId: tenant.id, userId: user.id, role });
  }
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/inline-first-payroll-fixture.json", JSON.stringify({ organizationId: tenant.id, foreignOrganizationId: foreign.id }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
