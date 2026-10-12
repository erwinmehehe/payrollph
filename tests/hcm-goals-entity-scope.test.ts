import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { legalEntities, organizations } from "../src/db/schema";
import { singleLegalEntityForTenant } from "../src/lib/hcm-single-entity-scope";

test("goals/reviews legal-entity gate denies group, legacy-empty and invalid tenants", async () => {
  const suffix = randomUUID().slice(0, 9);
  const ids: number[] = [];
  try {
    const [single, group, empty] = await db.insert(organizations).values([
      { name: "Goals one "+suffix, legalName: "Goals one "+suffix },
      { name: "Goals group "+suffix, legalName: "Goals group "+suffix },
      { name: "Goals empty "+suffix, legalName: "Goals empty "+suffix },
    ]).returning({ id: organizations.id });
    ids.push(single.id, group.id, empty.id);
    const [entity] = await db.insert(legalEntities).values([
      { organizationId: single.id, code: "A", legalName: "Goals single", displayName: "One", primaryEntity: true },
      { organizationId: group.id, code: "A", legalName: "Goals first", displayName: "One", primaryEntity: true },
      { organizationId: group.id, code: "B", legalName: "Goals second", displayName: "Two", primaryEntity: false },
    ]).returning({ id: legalEntities.id });
    assert.equal(await singleLegalEntityForTenant(single.id), entity.id);
    assert.equal(await singleLegalEntityForTenant(group.id), null, "No cross-entity cycle data before grants");
    assert.equal(await singleLegalEntityForTenant(empty.id), null, "Missing employer verification fails closed");
    assert.equal(await singleLegalEntityForTenant(group.id + 10_000_000), null);
    assert.equal(await singleLegalEntityForTenant(0), null);
  } finally {
    for (const id of ids) await db.delete(organizations).where(eq(organizations.id, id));
  }
});
