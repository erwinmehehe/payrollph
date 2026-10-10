import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps, organizations,
} from "../src/db/schema";
import { loadMonitor } from "../src/lib/hcm-bp-monitor-server";

/** Synthetic two-tenant PostgreSQL regression; no live HCM or payroll data. */
test("BP monitor is tenant-scoped before pagination and strips decision evidence", async () => {
  const unique = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "BP Monitor Alpha " + unique, legalName: "BP Monitor Alpha " + unique, plan: "Core" },
    { name: "BP Monitor Beta " + unique, legalName: "BP Monitor Beta " + unique, plan: "Core" },
  ]).returning();
  try {
    const alphaInstances = await db.insert(hcmBusinessProcessInstances).values(
      Array.from({ length: 31 }, (_, index) => ({
        organizationId: alpha.id,
        definitionCode: "monitor-test",
        definitionVersion: 1,
        processType: "change_job",
        sourceType: "synthetic-monitor",
        sourceKey: "alpha-" + unique + "-" + index,
        definitionSnapshot: { name: "Private source snapshot " + unique, steps: [] },
        initiatedByName: "Private Alpha Initiator",
        status: "in_progress",
      })),
    ).returning();
    const [betaInstance] = await db.insert(hcmBusinessProcessInstances).values({
      organizationId: beta.id,
      definitionCode: "monitor-test",
      definitionVersion: 1,
      processType: "transfer",
      sourceType: "synthetic-monitor",
      sourceKey: "beta-" + unique,
      definitionSnapshot: { name: "Private source snapshot " + unique, steps: [] },
      initiatedByName: "Private Beta Initiator",
      status: "in_progress",
    }).returning();

    const [alphaStep] = await db.insert(hcmBusinessProcessInstanceSteps).values({
      organizationId: alpha.id,
      instanceId: alphaInstances[30].id,
      stepIndex: 0,
      stepType: "approval",
      label: "Private Alpha Decision",
      assignee: "Private Alpha Approver",
      status: "pending",
      dueAt: new Date("2026-10-01T00:00:00Z"),
      decisionNote: "Private alpha reasoning",
    }).returning();
    const [betaStep] = await db.insert(hcmBusinessProcessInstanceSteps).values({
      organizationId: beta.id,
      instanceId: betaInstance.id,
      stepIndex: 0,
      stepType: "review",
      label: "Private Beta Decision",
      assignee: "Private Beta Approver",
      status: "pending",
      dueAt: null,
      decisionNote: "Private beta reasoning",
    }).returning();

    const first = await loadMonitor(alpha.id, null);
    assert.equal(first.tenantId, alpha.id);
    assert.equal(first.items.length, 30);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor !== null);
    assert.ok(first.items.every((item) => alphaInstances.some((source) => source.id === item.id)));
    assert.ok(first.items.some((item) => item.steps.some((step) => step.id === alphaStep.id)));
    assert.ok(!first.items.some((item) => item.steps.some((step) => step.id === betaStep.id)));

    const second = await loadMonitor(alpha.id, first.nextCursor);
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);

    const betaPage = await loadMonitor(beta.id, null);
    assert.deepEqual(betaPage.items.map((item) => item.id), [betaInstance.id]);
    assert.deepEqual(betaPage.items[0].steps.map((step) => step.id), [betaStep.id]);
    assert.equal(betaPage.items[0].steps[0].sla, "no_due_date");

    const output = JSON.stringify([first, second, betaPage]);
    for (const privateField of [
      "Private Alpha Approver", "Private Beta Approver",
      "Private Alpha Decision", "Private Beta Decision",
      "Private alpha reasoning", "Private beta reasoning",
      "Private Alpha Initiator", "Private Beta Initiator",
      "Private source snapshot",
    ]) assert.ok(!output.includes(privateField), "A private source field entered the monitor: " + privateField);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
