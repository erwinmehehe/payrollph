import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
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

/**
 * Read ONLY the CI-created, permission-restricted disposable test identities.
 * The runner's original proof statements and their line numbers remain intact.
 * No on-disk fallback or invented IDs: every dynamically allowlisted employer
 * must be preseeded before server startup, including the higher-ID victim.
 */
/**
 * Read the CI-only cookie fixture through one O_NOFOLLOW descriptor: checking a
 * pathname with statSync then opening it again would permit replacement.
 * The bootstrap writes this in a randomized private 0700 directory.
 */
export function readPrivateAllowlistFixture(file) {
  assert.match(file ?? "", /^\/tmp\/payrollph-tenant-allowlist-[A-Za-z0-9]{6}\/fixture\.json$/);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    assert.ok(info.isFile() && info.nlink === 1, "fixture must be a regular single-link file");
    assert.equal(info.mode & 0o777, 0o600, "fictional session cookies must remain mode 0600");
    if (typeof process.getuid === "function") {
      assert.equal(info.uid, process.getuid(), "fixture must belong to the current CI account");
    }
    assert.ok(info.size > 0 && info.size <= 65536, "fixture must be nonempty and bounded");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}
export function readAllowlistPreseed(file, env = process.env) {
  assert.equal(env.TENANT_TABLE_PROFILE, "allowlisted-reads");
  const data = readPrivateAllowlistFixture(file);
  assert.equal(data.schema, "payrollph-tenant-allowlist-preseed-v1");
  assert.ok(Array.isArray(data.employers) && data.employers.length === 3);
  const [victim, attackerA, attackerB] = data.employers;
  for (const [employer, label] of [[victim, "VICTIM"], [attackerA, "ATTA"], [attackerB, "ATTB"], [data.excluded, "UNLISTED"]]) {
    assert.ok(employer && typeof employer.marker === "string" && employer.marker.includes("-" + label + "-"));
    assert.match(employer.cookie ?? "", /^__Host-linaw_session=[a-f0-9]{64}$/);
    for (const field of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(Number.isSafeInteger(employer[field]?.id) && employer[field].id > 0, label + " " + field);
    }
    assert.ok(typeof employer.owner.name === "string" && employer.owner.name.includes(employer.marker));
    employer.seeded = {};
  }
  for (const field of ["org", "entity", "unit", "worker"]) {
    assert.ok(victim[field].id > attackerA[field].id && victim[field].id > attackerB[field].id,
      "actual victim " + field + " ID must be higher");
  }
  const ids = [attackerA.org.id, attackerB.org.id, victim.org.id];
  assert.deepEqual(data.allowlistedIds, ids);
  assert.ok(!ids.includes(data.excluded.org.id));
  const names = [
    "HCM_TEAM_LEAVE_CALENDAR_ORG_IDS",
    "HCM_PROCESS_MONITOR_ORG_IDS",
    "HCM_ORG_EXPLORER_ORG_IDS",
    "HCM_MANAGER_DECISION_INBOX_ORG_IDS",
    "WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS",
    "WFM_HISTORICAL_OUTLOOK_ALLOWED_ORGANIZATION_IDS",
    "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS",
    "WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS",
    "WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS",
  ];
  for (const key of names) assert.equal(env[key], ids.join(","), key + " must include victim to prove authorization");
  return data.employers;
}
