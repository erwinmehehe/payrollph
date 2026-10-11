
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  assets, employees, expenseClaims, expenseReportItems, expenseReports,
  itAccessGrants, itApplications, itDeviceEvents, itManagedDevices, organizations,
  spendCards, spendCardTransactions, users,
} from "../src/db/schema";
import { requestOffboardingIT } from "../src/lib/it-offboarding";

function employeeValues(organizationId: number, suffix: string) {
  return {
    organizationId,
    employeeNo: "EXP-" + suffix,
    firstName: "Test",
    lastName: "Worker",
    avatarInitials: "TW",
    title: "Associate",
    basicRate: "22000.00",
    startDate: "2026-01-01",
    status: "Active",
  };
}

test("employer-paid charges reject duplicate reference, invalid card digits and zero amounts", async () => {
  const key = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({ name: "Spend " + key, legalName: "Spend " + key }).returning();
  try {
    const [card] = await db.insert(spendCards).values({
      organizationId: org.id, issuer: "Synthetic Bank", lastFour: "1234",
    }).returning();
    await db.insert(spendCardTransactions).values({
      organizationId: org.id, cardId: card.id, externalReference: "row-001",
      merchant: "Test Merchant", spentOn: "2026-10-01", amount: "150.25",
    });
    await assert.rejects(async () => {
      await db.insert(spendCardTransactions).values({
        organizationId: org.id, cardId: card.id, externalReference: "row-001",
        merchant: "Duplicated", spentOn: "2026-10-01", amount: "150.25",
      });
    });
    await assert.rejects(async () => {
      await db.insert(spendCardTransactions).values({
        organizationId: org.id, cardId: card.id, externalReference: "invalid-0",
        merchant: "Zero Charge", spentOn: "2026-10-01", amount: "0.00",
      });
    });
    await assert.rejects(async () => {
      await db.insert(spendCards).values({
        organizationId: org.id, issuer: "Synthetic Bank", lastFour: "12XX",
      });
    });
    const stored = await db.select().from(spendCardTransactions).where(eq(spendCardTransactions.organizationId, org.id));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].amount, "150.25");
  } finally {
    await db.delete(spendCardTransactions).where(eq(spendCardTransactions.organizationId, org.id));
    await db.delete(spendCards).where(eq(spendCards.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("expense report member claim may belong to only one report and reviewer cannot equal submitter", async () => {
  const key = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({ name: "Reports " + key, legalName: "Reports " + key }).returning();
  const [actor] = await db.insert(users).values({
    email: "spend-" + key + "@example.invalid", name: "Spend Test Actor", passwordHash: "synthetic",
  }).returning();
  try {
    const [staff] = await db.insert(employees).values(employeeValues(org.id, key)).returning();
    const [claim] = await db.insert(expenseClaims).values({
      organizationId: org.id, employeeId: staff.id, category: "Travel",
      description: "Synthetic employee expense", amount: "300.50", incurredOn: "2026-10-01",
      submittedByUserId: actor.id,
    }).returning();
    const [reportA, reportB] = await db.insert(expenseReports).values([
      { organizationId: org.id, employeeId: staff.id, title: "First Report", totalAmount: "300.50", submittedByUserId: actor.id },
      { organizationId: org.id, employeeId: staff.id, title: "Second Report", totalAmount: "300.50", submittedByUserId: actor.id },
    ]).returning();
    await db.insert(expenseReportItems).values({ organizationId: org.id, reportId: reportA.id, claimId: claim.id });
    await assert.rejects(async () => {
      await db.insert(expenseReportItems).values({ organizationId: org.id, reportId: reportB.id, claimId: claim.id });
    });
    await assert.rejects(async () => {
      await db.update(expenseReports).set({
        decidedByUserId: actor.id, decidedAt: new Date(), status: "approved",
      }).where(eq(expenseReports.id, reportA.id));
    });
    const unchanged = await db.select().from(expenseReports).where(eq(expenseReports.id, reportA.id));
    assert.equal(unchanged[0].status, "submitted");
  } finally {
    await db.delete(expenseReportItems).where(eq(expenseReportItems.organizationId, org.id));
    await db.delete(expenseReports).where(eq(expenseReports.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, actor.id));
  }
});

test("offboarding changes only the separating worker's live IT access and device", async () => {
  const key = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "IT Alpha " + key, legalName: "IT Alpha " + key },
    { name: "IT Beta " + key, legalName: "IT Beta " + key },
  ]).returning();
  try {
    const [alphaEmployee] = await db.insert(employees).values({ ...employeeValues(alpha.id, "alpha-" + key), status: "Separating" }).returning();
    const [betaEmployee] = await db.insert(employees).values(employeeValues(beta.id, "beta-" + key)).returning();
    const [alphaApp, betaApp] = await Promise.all([
      db.insert(itApplications).values({ organizationId: alpha.id, name: "Microsoft 365" }).returning().then(rows => rows[0]),
      db.insert(itApplications).values({ organizationId: beta.id, name: "Microsoft 365" }).returning().then(rows => rows[0]),
    ]);
    await db.insert(itAccessGrants).values([
      { organizationId: alpha.id, employeeId: alphaEmployee.id, applicationId: alphaApp.id, state: "active" },
      { organizationId: beta.id, employeeId: betaEmployee.id, applicationId: betaApp.id, state: "active" },
    ]);
    const [aAsset, bAsset] = await db.insert(assets).values([
      { organizationId: alpha.id, employeeId: alphaEmployee.id, type: "Laptop", name: "Alpha Laptop", status: "assigned" },
      { organizationId: beta.id, employeeId: betaEmployee.id, type: "Laptop", name: "Beta Laptop", status: "assigned" },
    ]).returning();
    await db.insert(itManagedDevices).values([
      { organizationId: alpha.id, assetId: aAsset.id, employeeId: alphaEmployee.id, state: "assigned" },
      { organizationId: beta.id, assetId: bAsset.id, employeeId: betaEmployee.id, state: "assigned" },
    ]);
    assert.deepEqual(await requestOffboardingIT(alpha.id, alphaEmployee.id), { accessRequests: 1, deviceRequests: 1 });
    assert.deepEqual(await requestOffboardingIT(alpha.id, alphaEmployee.id), { accessRequests: 0, deviceRequests: 0 });

    const alphaAccess = await db.select().from(itAccessGrants).where(eq(itAccessGrants.organizationId, alpha.id));
    const betaAccess = await db.select().from(itAccessGrants).where(eq(itAccessGrants.organizationId, beta.id));
    assert.equal(alphaAccess[0].state, "revoke_requested");
    assert.equal(betaAccess[0].state, "active");
    const aDevices = await db.select().from(itManagedDevices).where(eq(itManagedDevices.organizationId, alpha.id));
    const bDevices = await db.select().from(itManagedDevices).where(eq(itManagedDevices.organizationId, beta.id));
    assert.equal(aDevices[0].state, "return_requested");
    assert.equal(bDevices[0].state, "assigned");
    const events = await db.select().from(itDeviceEvents).where(and(eq(itDeviceEvents.organizationId, alpha.id), eq(itDeviceEvents.deviceId, aDevices[0].id)));
    assert.equal(events.length, 1);
  } finally {
    for (const organizationId of [alpha.id, beta.id]) {
      await db.delete(itDeviceEvents).where(eq(itDeviceEvents.organizationId, organizationId));
      await db.delete(itManagedDevices).where(eq(itManagedDevices.organizationId, organizationId));
      await db.delete(itAccessGrants).where(eq(itAccessGrants.organizationId, organizationId));
      await db.delete(assets).where(eq(assets.organizationId, organizationId));
      await db.delete(itApplications).where(eq(itApplications.organizationId, organizationId));
    }
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
