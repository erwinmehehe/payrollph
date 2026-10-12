import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import { organizations, subscriptions, userOrganizations, users } from "../src/db/schema";
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
  await db.update(organizations).set({ moduleVisibility: "core_only" }).where(eq(organizations.id, 1));
  await db.update(organizations).set({ moduleVisibility: "all" }).where(eq(organizations.id, 2));
  await db.insert(saasSignupVerifications).values({
    organizationId: 1, userId: owner.id, tokenHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 86400000), verifiedAt: new Date(),
  });
  await db.insert(subscriptions).values({ organizationId: 1, status: "active", plan: "Core" });
  // A truly empty self-serve third tenant is added ONLY after earlier HRIS
  // legacy-tenant browser tests, so those regression snapshots stay unchanged.
  const [gamma] = await db.insert(organizations).values({
    name: "Synthetic Gamma First Payroll", legalName: "Synthetic Gamma First Payroll",
    plan: "Core", payrollCalendarMode: "flexible", moduleVisibility: "core_only",
  }).returning({ id: organizations.id });
  const colleagues = await db.select({ id: users.id, email: users.email, role: users.role })
    .from(users).where(inArray(users.email, [
      "hcm-hr@example.test", "hcm-payroll@example.test", "hcm-checker@example.test",
    ]));
  assert.equal(colleagues.length, 3, "Role recipients must be real synthetic users");
  await db.insert(userOrganizations).values([
    { userId: owner.id, organizationId: gamma.id, role: "owner", active: true },
    ...colleagues.map(user => ({ userId: user.id, organizationId: gamma.id, role: user.role, active: true })),
  ]);
  await db.insert(saasSignupVerifications).values({
    organizationId: gamma.id, userId: owner.id, tokenHash: "b".repeat(64),
    expiresAt: new Date(Date.now() + 86400000), verifiedAt: new Date(),
  });
  await db.insert(subscriptions).values({ organizationId: gamma.id, status: "active", plan: "Core" });
  await mkdir("qa-artifacts", { recursive: true });
  await writeFile("qa-artifacts/first-payroll-zero-tenant.json",
    JSON.stringify({ organizationId: gamma.id, label: "disposable-synthetic-only" }));
  console.log("Fictional self-serve owner and zero-employee tenant seeded; no billing provider contacted.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
