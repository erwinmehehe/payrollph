import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
  organizations,
} from "../src/db/schema";
import { loadHcmProcessMonitor } from "../src/lib/hcm-process-monitor-server";

test("monitor SQL keyset and source steps stay employer-scoped, bounded and private", async () => {
  const token = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Synthetic HCM Alpha " + token, legalName: "Synthetic HCM Alpha " + token, plan: "Core" },
    { name: "Synthetic HCM Beta " + token, legalName: "Synthetic HCM Beta " + token, plan: "Core" },
  ]).returning();
  const observedAt = new Date("2026-10-11T00:00:00Z");
  const read = (organizationId: number, cursor = 0, selectedProcessId: number | null = null,
    filter: "all" | "approved" = "all") =>
    loadHcmProcessMonitor({ organizationId, cursor, selectedProcessId, filter }, observedAt);

  try {
    const alphaRows = await db.insert(hcmBusinessProcessInstances).values(
      Array.from({ length: 23 }, (_, idx) => ({
        organizationId: alpha.id,
        definitionCode: "synthetic-hcm-monitor", definitionVersion: 1,
        processType: idx === 1 ? "hire" : "transfer",
        sourceType: "synthetic_qa", sourceKey: "a-" + token + "-" + idx,
        definitionSnapshot: { privateNote: "AlphaPrivate sensitive source payload" },
        initiatedByName: "AlphaPrivate Manager",
        status: idx === 1 ? "approved" : "in_progress",
        effectiveDate: "2026-10-15",
      })),
    ).returning();
    const [betaRow] = await db.insert(hcmBusinessProcessInstances).values({
      organizationId: beta.id,
      definitionCode: "synthetic-hcm-monitor", definitionVersion: 1,
      processType: "termination", sourceType: "synthetic_qa",
      sourceKey: "b-" + token,
      definitionSnapshot: { privateNote: "BetaPrivate sensitive source payload" },
      initiatedByName: "BetaPrivate Manager", status: "failed",
      effectiveDate: "2026-10-15",
    }).returning();
    const processId = alphaRows[22].id;

    await db.insert(hcmBusinessProcessInstanceSteps).values(
      Array.from({ length: 13 }, (_, idx) => ({
        organizationId: alpha.id,
        instanceId: processId,
        stepIndex: idx,
        stepType: idx % 2 === 0 ? "approval" : "review",
        label: "AlphaPrivate secret worker name",
        assignee: idx === 0 ? "role:hr" : "employee-sensitive@example.test",
        status: idx === 0 ? "pending" : idx === 1 ? "completed" : "waiting",
        dueAt: idx === 0
          ? new Date("2026-10-10T10:00:00Z")
          : idx === 1 ? new Date("2026-10-09T10:00:00Z") : null,
        decisionNote: "AlphaPrivate salary 999999",
      })),
    );
    await db.insert(hcmBusinessProcessInstanceSteps).values({
      organizationId: beta.id, instanceId: betaRow.id,
      stepIndex: 0, stepType: "approval",
      label: "BetaPrivate secret worker name", assignee: "role:hr",
      status: "pending", dueAt: new Date("2026-10-09T10:00:00Z"),
      decisionNote: "BetaPrivate salary 999999",
    });

    const first = await read(alpha.id, 0, processId);
    assert.equal(first.tenantId, alpha.id);
    assert.equal(first.items.length, 20);
    assert.equal(first.page.size, 20);
    assert.equal(first.page.hasMore, true);
    assert.ok(first.page.nextCursor);
    assert.ok(first.items.every((row) => row.tenantId === alpha.id));
    assert.deepEqual(first.items.map((row) => row.id),
      [...first.items.map((row) => row.id)].sort((a, b) => b - a));
    assert.equal(first.detail.state, "recorded");
    if (first.detail.state !== "recorded") throw new Error("Expected process detail");
    assert.equal(first.detail.steps.length, 12);
    assert.equal(first.detail.stepsPartial, true);
    assert.equal(first.detail.steps[0].dueEvidence, "recorded");
    assert.equal(first.detail.steps[0].overdue, true);
    assert.equal(first.detail.steps[1].overdue, false);
    assert.equal(first.detail.steps[2].dueEvidence, "missing");

    const json = JSON.stringify(first);
    for (const forbidden of [
      "AlphaPrivate", "BetaPrivate", "privateNote", "decisionNote",
      "999999", "employee-sensitive@example.test", "sourceKey", "initiatedByName",
    ]) assert.ok(!json.includes(forbidden), "Sensitive projection field: " + forbidden);

    const second = await read(alpha.id, first.page.nextCursor!);
    assert.equal(second.items.length, 3);
    assert.equal(second.page.hasMore, false);
    assert.equal(second.page.nextCursor, null);
    const visited = new Set([...first.items, ...second.items].map((row) => row.id));
    assert.equal(visited.size, 23, "No duplicate record or cross-tenant leak");
    assert.ok(!visited.has(betaRow.id));

    const onlyApproved = await read(alpha.id, 0, null, "approved");
    assert.deepEqual(onlyApproved.items.map((row) => row.id), [alphaRows[1].id]);

    const crossTenantSelection = await read(alpha.id, 0, betaRow.id);
    assert.equal(crossTenantSelection.detail.state, "not_found");
    assert.ok(!JSON.stringify(crossTenantSelection).includes("BetaPrivate"));
    const betaView = await read(beta.id, 0, betaRow.id);
    assert.deepEqual(betaView.items.map((row) => row.id), [betaRow.id]);
    assert.equal(betaView.detail.state, "recorded");
    if (betaView.detail.state !== "recorded") throw new Error("Expected Beta detail");
    assert.equal(betaView.detail.steps.length, 1);
    assert.equal(betaView.detail.steps[0].overdue, true);
    assert.ok(!JSON.stringify(betaView).includes("AlphaPrivate"));

    await assert.rejects(read(0), /Invalid HCM process monitor context/);
    await assert.rejects(read(alpha.id, -1), /Invalid HCM process monitor context/);
  } finally {
    // Synthetic two-tenant FK cascade; no live worker or pay records.
    await db.delete(organizations).where(
      // Deliberate separate tenant deletes avoid an accidental broad cleanup.
      eq(organizations.id, alpha.id),
    );
    await db.delete(organizations).where(
      eq(organizations.id, beta.id),
    );
  }
});
