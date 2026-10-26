import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import { employees, organizations, subscriptions, userOrganizations, users } from "../src/db/schema";
import { saasSignupVerifications } from "../src/lib/saas-billing-schema";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  const address = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(address.hostname));
  assert.equal(address.pathname, "/app_db");
  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  assert.deepEqual(orgs.sort((a, b) => a.id - b.id), [
    { id: 1, name: "Synthetic Alpha Employer" },
    { id: 2, name: "Synthetic Beta Employer" },
    { id: 3, name: "Synthetic Victim Only Employer" },
  ], "Only the disposable HRIS fixture is permitted");
  const [owner] = await db.insert(users).values({
    email: "first-payroll-owner@example.test", name: "Synthetic Onboarding Owner", role: "owner",
    passwordHash: hashPassword("Synthetic-HCM-QA-Password-Only-2026!"),
  }).returning();
  await db.insert(userOrganizations).values([1, 2].map(organizationId => ({
    userId: owner.id, organizationId, role: "owner", active: true,
  })));
  // Fictional paid access exercises the real self-serve gate without a provider.
  // Beta deliberately stays a legacy pilot to catch stale guided-mode props.
  await db.insert(saasSignupVerifications).values({
    organizationId: 1, userId: owner.id, tokenHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 86400000), verifiedAt: new Date(),
  });
  await db.insert(subscriptions).values({ organizationId: 1, status: "active", plan: "Core" });
  // A fourth distinct self-serve tenant is added ONLY after earlier HRIS
  // browser tests. Employer #3 remains a populated, unauthorized victim.
  // PostgreSQL sequences are not gapless: prior rolled-back test inserts can
  // consume IDs, so never assume the newly generated ID must equal 4.
  const baselineOrgIds = new Set(orgs.map(org => org.id));
  const [gamma] = await db.insert(organizations).values({
    name: "Synthetic Gamma First Payroll", legalName: "Synthetic Gamma First Payroll",
    plan: "Core", payrollCalendarMode: "flexible",
  }).returning({ id: organizations.id });
  assert.ok(Number.isSafeInteger(gamma?.id) && gamma.id > 3 &&
    !baselineOrgIds.has(gamma.id),
  "Self-serve tenant must have a new generated ID, never victim employer #3");
  const afterOrgs = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations);
  assert.equal(afterOrgs.length, orgs.length + 1,
    "Exactly one additional synthetic employer must exist");
  assert.deepEqual(afterOrgs.filter(org => !baselineOrgIds.has(org.id)), [
    { id: gamma.id, name: "Synthetic Gamma First Payroll" },
  ], "The only new employer must be the independently named self-serve tenant");
  const gammaEmployees = await db.select({ id: employees.id }).from(employees)
    .where(eq(employees.organizationId, gamma.id)).limit(1);
  assert.equal(gammaEmployees.length, 0,
    "The newly created self-serve tenant must have zero employees");
  const colleagues = await db.select({ id: users.id, email: users.email, role: users.role })
    .from(users).where(inArray(users.email, [
      "hcm-hr@example.test", "hcm-payroll@example.test", "hcm-checker@example.test",
    ]));
  assert.equal(colleagues.length, 3, "Role recipients must be real synthetic users");
  // Signup verification uniquely binds one owner to one self-serve employer.
  // Model Gamma as a separate customer, not a second signup for Alpha's owner.
  const [gammaOwner] = await db.insert(users).values({
    email: "first-payroll-gamma-owner@example.test",
    name: "Synthetic Gamma Onboarding Owner", role: "owner",
    passwordHash: hashPassword("Synthetic-HCM-QA-Password-Only-2026!"),
  }).returning({ id: users.id });
  assert.ok(gammaOwner?.id && gammaOwner.id !== owner.id,
    "Each synthetic self-serve employer needs a distinct verified signup owner");
  await db.insert(userOrganizations).values([
    { userId: gammaOwner.id, organizationId: gamma.id, role: "owner", active: true },
    ...colleagues.map(user => ({ userId: user.id, organizationId: gamma.id, role: user.role, active: true })),
  ]);
  await db.insert(saasSignupVerifications).values({
    organizationId: gamma.id, userId: gammaOwner.id, tokenHash: "b".repeat(64),
    expiresAt: new Date(Date.now() + 86400000), verifiedAt: new Date(),
  });
  await db.insert(subscriptions).values({ organizationId: gamma.id, status: "active", plan: "Core" });
  await mkdir("qa-artifacts", { recursive: true });
  await writeFile("qa-artifacts/first-payroll-zero-tenant.json",
    JSON.stringify({ organizationId: gamma.id, label: "disposable-synthetic-only" }));
  console.log("Fictional self-serve owner and zero-employee tenant seeded; no billing provider contacted.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
