import assert from "node:assert/strict";

/** Only the sealer's three chain fields may change during the audit-chain GET.
 * Preserve every other column, including future business fields, so mutations
 * to actor, resource, metadata, employer or timestamp cannot pass unnoticed.
 */
export function auditBusinessSnapshot(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row)
    .filter(([key]) => !["chainSeq", "prevHash", "rowHash"].includes(key))));
}

/** Runners retain [victim, attacker A, attacker B] for request contexts, but
 * every route-specific seed must be inserted attacker-first, victim-last.
 * A returned row ID is the real INSERT ... RETURNING target, never a guess.
 */
export async function seedTableRow(item, employers) {
  assert.equal(employers.length, 3, "two attackers and one victim are required");
  const [victim, attackerA, attackerB] = employers;
  for (const employer of [attackerA, attackerB, victim]) {
    employer.seeded[item.key] = (await item.seed(employer)) ?? true;
  }
  const seeds = employers.map((employer) => employer.seeded[item.key]);
  if (seeds.some((seed) => seed && typeof seed === "object" && Object.hasOwn(seed, "id"))) {
    const ids = seeds.map((seed) => seed?.id);
    assert.ok(ids.every((id) => Number.isSafeInteger(id) && id > 0), item.key + ": all returned target IDs must exist");
    assert.ok(ids[0] > ids[1] && ids[0] > ids[2], item.key + ": victim target ID must exceed both attackers' IDs");
  }
}
