import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { employees, hcmLifecycleNotificationTasks, organizations, users } from "../src/db/schema";
import { readScopedLifecycleNotificationTasks } from "../src/lib/hcm-lifecycle-notification-tenant";

test("fictional HCM notification reader does not join foreign-employer worker identities", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const createdOrgs: number[] = [];
  let createdUser: number | null = null;
  try {
    const orgs = await db.insert(organizations).values([
      { name: "QA Lifecycle Alpha " + suffix, legalName: "QA Lifecycle Alpha " + suffix, plan: "Core" },
      { name: "QA Lifecycle Beta " + suffix, legalName: "QA Lifecycle Beta " + suffix, plan: "Core" },
    ]).returning({ id: organizations.id });
    const [alpha, beta] = orgs;
    createdOrgs.push(alpha.id, beta.id);
    const [actor] = await db.insert(users).values({
      name: "QA Lifecycle Fictional Owner",
      email: "lifecycle-" + suffix + "@example.invalid",
      passwordHash: "non-authentic-fixture",
      role: "owner",
    }).returning({ id: users.id });
    createdUser = actor.id;

    const [alphaWorker] = await db.insert(employees).values({
      organizationId: alpha.id, employeeNo: "ALPHA-" + suffix,
      firstName: "Alpha", lastName: "Worker", title: "Fictional staff",
      status: "Active", avatarInitials: "AW", basicRate: "22000.00", region: "NCR",
      startDate: "2026-01-01",
    }).returning({ id: employees.id });
    const [betaWorker] = await db.insert(employees).values({
      organizationId: beta.id, employeeNo: "BETA-" + suffix,
      firstName: "BetaSensitive", lastName: "Worker", title: "Fictional staff",
      status: "Active", avatarInitials: "BW", basicRate: "23000.00", region: "NCR",
      startDate: "2026-01-01",
    }).returning({ id: employees.id });

    const [owned, corrupted, foreign] = await db.insert(hcmLifecycleNotificationTasks).values([
      {
        organizationId: alpha.id, employeeId: alphaWorker.id,
        ownerUserId: actor.id, sourceType: "employment_terms",
        sourceKey: "own-" + suffix, action: "record_decision", stage: "t7",
        severity: "warning", title: "Alpha private", detail: "Synthetic own notification",
      },
      {
        // Independent valid FKs but deliberately mismatched employer/worker:
        // an ID-only join would expose BetaSensitive to an Alpha viewer.
        organizationId: alpha.id, employeeId: betaWorker.id,
        ownerUserId: actor.id, sourceType: "employment_terms",
        sourceKey: "corrupted-" + suffix, action: "record_decision", stage: "t7",
        severity: "warning", title: "Mismatched private", detail: "Synthetic inconsistent link",
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        ownerUserId: actor.id, sourceType: "employment_terms",
        sourceKey: "foreign-" + suffix, action: "record_decision", stage: "t7",
        severity: "warning", title: "Beta private", detail: "Synthetic foreign notification",
      },
    ]).returning({ id: hcmLifecycleNotificationTasks.id });

    const alphaAdmin = await readScopedLifecycleNotificationTasks({
      organizationId: alpha.id, userId: actor.id, companyPeopleAdmin: true,
    });
    assert.deepEqual(alphaAdmin.map((row) => row.task.id), [owned.id]);
    assert.equal(alphaAdmin[0]?.employeeNo, "ALPHA-" + suffix);
    assert.equal(JSON.stringify(alphaAdmin).includes("BetaSensitive"), false);
    assert.equal(alphaAdmin.some((row) => row.task.id === corrupted.id), false);

    const alphaAssignedManager = await readScopedLifecycleNotificationTasks({
      organizationId: alpha.id, userId: actor.id, companyPeopleAdmin: false,
    });
    assert.deepEqual(alphaAssignedManager.map((row) => row.task.id), [owned.id]);
    const alphaOtherManager = await readScopedLifecycleNotificationTasks({
      organizationId: alpha.id, userId: actor.id + 99999, companyPeopleAdmin: false,
    });
    assert.deepEqual(alphaOtherManager, []);

    const betaAdmin = await readScopedLifecycleNotificationTasks({
      organizationId: beta.id, userId: actor.id, companyPeopleAdmin: true,
    });
    assert.deepEqual(betaAdmin.map((row) => row.task.id), [foreign.id]);
    assert.equal(betaAdmin[0]?.employeeFirstName, "BetaSensitive");
  } finally {
    if (createdOrgs.length) await db.delete(organizations).where(inArray(organizations.id, createdOrgs));
    if (createdUser !== null) await db.delete(users).where(eq(users.id, createdUser));
  }
});
