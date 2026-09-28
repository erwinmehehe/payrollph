import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { approvalDelegations, organizations } from "../src/db/schema";
import { canDecide, resolveEffectiveApprovers } from "../src/lib/delegation";

test("active approval delegation permits the delegate and preserves the chain", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Delegation Verification",
    legalName: "Delegation Verification Inc.",
    plan: "Core",
  }).returning();

  try {
    await db.insert(approvalDelegations).values({
      organizationId: org.id,
      fromApprover: "Payroll Lead",
      toApprover: "Finance Manager",
      reason: "Leave coverage",
      startsOn: "2020-01-01",
      endsOn: "2035-12-31",
      active: true,
    });

    const resolved = await resolveEffectiveApprovers(org.id, "Payroll Lead", "2026-09-28");
    assert.equal(resolved.delegated, true);
    assert.equal(resolved.effectiveApprover, "Finance Manager");
    assert.deepEqual(resolved.allowed.sort(), ["finance manager", "payroll lead"].sort());

    const decision = await canDecide(org.id, "Payroll Lead", "Finance Manager");
    assert.equal(decision.permitted, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("delegation resolution stops safely when a cycle would repeat an approver", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Delegation Cycle Verification",
    legalName: "Delegation Cycle Verification Inc.",
    plan: "Core",
  }).returning();

  try {
    await db.insert(approvalDelegations).values([
      {
        organizationId: org.id,
        fromApprover: "A",
        toApprover: "B",
        reason: "Coverage",
        startsOn: "2020-01-01",
        endsOn: "2035-12-31",
        active: true,
      },
      {
        organizationId: org.id,
        fromApprover: "B",
        toApprover: "A",
        reason: "Bad cycle",
        startsOn: "2020-01-01",
        endsOn: "2035-12-31",
        active: true,
      },
    ]);

    const resolved = await resolveEffectiveApprovers(org.id, "A", "2026-09-28");
    assert.equal(resolved.effectiveApprover, "B");
    assert.equal(resolved.chain.length, 1);
    assert.deepEqual(resolved.allowed.sort(), ["a", "b"]);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
