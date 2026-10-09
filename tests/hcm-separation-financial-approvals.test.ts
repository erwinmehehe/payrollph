import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, organizations, separationRecords, users,
} from "../src/db/schema";

test("final-pay approval identity survives in SQL, and recalculation revokes a previous approval", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Separation three actor QA",
    legalName: "Separation three actor QA",
    plan: "Core",
  }).returning();
  const suffix = randomUUID();
  const actors = await db.insert(users).values([
    { email: `sep-maker-${suffix}@example.invalid`, name: "Maker", passwordHash: "test" },
    { email: `sep-checker-${suffix}@example.invalid`, name: "Checker", passwordHash: "test" },
    { email: `sep-releaser-${suffix}@example.invalid`, name: "Releaser", passwordHash: "test" },
  ]).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "SEP-THREE-ACTOR-1",
      firstName: "Case", lastName: "Worker", title: "Operations",
      avatarInitials: "CW", basicRate: "24000.00",
      startDate: "2026-01-01",
    }).returning();
    const [packageRow] = await db.insert(separationRecords).values({
      organizationId: org.id,
      employeeId: worker.id,
      separationType: "resignation",
      noticeDate: "2026-10-01",
      lastDay: "2026-10-31",
      preparedByUserId: actors[0].id,
      status: "draft",
    }).returning();
    assert.equal(packageRow.preparedByUserId, actors[0].id);
    assert.equal(packageRow.approvedByUserId, null);
    assert.equal(packageRow.releasedByUserId, null);

    const [approved] = await db.update(separationRecords).set({
      status: "approved", approvedByUserId: actors[1].id,
      approvedAt: new Date(),
    }).where(eq(separationRecords.id, packageRow.id)).returning();
    assert.equal(approved.approvedByUserId, actors[1].id);

    const [recomputed] = await db.update(separationRecords).set({
      status: "draft", preparedByUserId: actors[2].id,
      approvedByUserId: null, approvedAt: null,
      releasedByUserId: null, releasedAt: null,
    }).where(eq(separationRecords.id, packageRow.id)).returning();
    assert.equal(recomputed.preparedByUserId, actors[2].id);
    assert.equal(recomputed.approvedByUserId, null);
    assert.equal(recomputed.status, "draft");

    // An event audit failure must not leave a separately approved package.
    await assert.rejects(() => db.transaction(async tx => {
      await tx.update(separationRecords).set({
        status: "approved", approvedByUserId: actors[1].id,
      }).where(eq(separationRecords.id, packageRow.id));
      await tx.insert(auditEvents).values({
        organizationId: org.id, actor: actors[1].name,
        action: "Simulated final-pay review", resource: "Test",
      });
      throw new Error("SIMULATED_AUDIT_FAILURE");
    }), /SIMULATED_AUDIT_FAILURE/);
    const [rolledBack] = await db.select().from(separationRecords)
      .where(eq(separationRecords.id, packageRow.id)).limit(1);
    assert.equal(rolledBack.status, "draft");
    assert.equal(rolledBack.approvedByUserId, null);
    const audits = await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, org.id));
    assert.equal(audits.length, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    for (const actor of actors) await db.delete(users).where(eq(users.id, actor.id));
  }
});

test("separation API requires independent maker, checker and releaser before money state", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  const ui = readFileSync("src/components/separation-panel.tsx", "utf8");
  assert.ok(route.includes("preparedByUserId: user.id"));
  assert.ok(route.includes("approvedByUserId: null"));
  assert.ok(route.includes("releasedByUserId: null"));
  assert.ok(route.includes("fresh.preparedByUserId === user.id"));
  assert.ok(route.includes("FINAL_PAY_MAKER_CHECKER_REQUIRED"));
  assert.ok(route.includes("FINAL_PAY_MAKER_EVIDENCE_MISSING"));
  assert.ok(route.includes("fresh.approvedByUserId === user.id"));
  assert.ok(route.includes("fresh.preparedByUserId === fresh.approvedByUserId"));
  assert.ok(route.includes("FINAL_PAY_THREE_ACTOR_REQUIRED"));
  assert.ok(route.includes('process.env.FINAL_PAY_MANUAL_RELEASE_ENABLED !== "true"'));
  assert.ok(route.includes('"FINAL_PAY_MANUAL_RELEASE_NOT_CERTIFIED"'));
  assert.ok(route.includes("releasedByUserId: user.id"));
  assert.ok(route.includes('action: "Final pay independently approved"'));
  assert.ok(route.includes('action: "Final pay released with independently separated approvers"'));
  assert.ok(route.includes("await tx.insert(auditEvents)"));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes("FINAL_PAY_WORKER_STATE_CHANGED"));
  assert.ok(route.includes("FINAL_PAY_POSITION_STATE_CHANGED"));
  assert.ok(route.includes('eq(employees.status, "Separating")'));
  assert.ok(route.includes('eq(positions.status, "filled")'));
  assert.ok(route.includes("if (!closedAssignment)"));
  assert.ok(route.includes("if (!vacantPosition)"));
  assert.ok(ui.includes("selectedRecord.preparedByUserId === currentUserId"));
  assert.ok(ui.includes("selectedRecord.approvedByUserId === currentUserId"));
});

test("clearance changes are single-discipline, privileged, MFA-protected and audit atomic", () => {
  const source = readFileSync("src/app/api/separation/route.ts", "utf8");
  const ui = readFileSync("src/components/separation-panel.tsx", "utf8");
  assert.ok(source.includes("changed.length !== 1"));
  assert.ok(source.includes('typeof requested !== "boolean"'));
  assert.ok(source.includes('typeof previous !== "boolean"'));
  assert.ok(source.includes("SEPARATION_CLEARANCE_ONE_DISCIPLINE"));
  assert.ok(source.includes('financeCleared: ["owner", "admin", "bookkeeper"]'));
  assert.ok(source.includes('hrCleared: ["owner", "admin", "hr"]'));
  assert.ok(source.includes('action: "separation-clearance-update"'));
  assert.ok(source.includes("fresh.status !== \"draft\""));
  assert.ok(source.includes("SEPARATION_CLEARANCE_STALE"));
  assert.ok(source.includes('action: "Separation department clearance changed"'));
  assert.ok(ui.includes("clearanceEvidenceReference: clearanceEvidenceReference.trim()"));
  assert.ok(ui.includes("clearanceReason: clearanceReason.trim()"));
});

test("COE issuance requires HR authority, MFA and actual delivery evidence", () => {
  const source = readFileSync("src/app/api/separation/route.ts", "utf8");
  const ui = readFileSync("src/components/separation-panel.tsx", "utf8");
  assert.ok(source.includes("COE_HR_AUTHORITY_REQUIRED"));
  assert.ok(source.includes('action: "separation-certificate-issue"'));
  assert.ok(source.includes("coeEvidenceReference.length < 8"));
  assert.ok(source.includes('action: "Certificate of Employment independently attested as issued"'));
  assert.ok(ui.includes("coeEvidenceReference: coeEvidenceReference.trim()"));
  assert.ok(ui.includes("Attest COE actually issued"));
});

test("SQL 0102 and runtime schema agree on stable actor columns; historical baseline remains immutable", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0102_final_pay_maker_checker.sql", "utf8");
  const compatibility = readFileSync("src/lib/separation-schema.ts", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  const oldSeparationTable = baseline
    .split('CREATE TABLE "separation_records" (')[1]
    ?.split("--> statement-breakpoint")[0];
  assert.ok(oldSeparationTable, "Historical SQL baseline must contain separation_records");
  for (const column of ["prepared_by_user_id", "approved_by_user_id", "released_by_user_id"]) {
    assert.ok(schema.includes(column));
    assert.ok(migration.includes(column));
    assert.ok(compatibility.includes(column));
    assert.ok(!oldSeparationTable.includes(column));
  }
});
