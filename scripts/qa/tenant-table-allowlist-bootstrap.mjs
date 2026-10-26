/**
 * One disposable PostgreSQL bootstrap per allowlisted-reads CI job, BEFORE Next.js starts.
 * The exact two attackers + real higher-ID victim are all enabled in each tenant
 * allowlist. A fourth real employer is deliberately NOT allowlisted.
 *
 * Only synthetic numeric IDs enter GITHUB_ENV. Raw fictional session cookies are
 * written 0600 to /tmp for the read runner and never logged or uploaded.
 */
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../../src/db";
import { organizations } from "../../src/db/schema";
import { seedEmployer, standaloneMakeSession, requireTenantTableDisposable } from "./tenant-table-http.mjs";

export const ALLOWLIST_ENV_KEYS = Object.freeze([
  "HCM_TEAM_LEAVE_CALENDAR_ORG_IDS",
  "HCM_PROCESS_MONITOR_ORG_IDS",
  "HCM_ORG_EXPLORER_ORG_IDS",
  "HCM_MANAGER_DECISION_INBOX_ORG_IDS",
  "WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS",
  "WFM_HISTORICAL_OUTLOOK_ALLOWED_ORGANIZATION_IDS",
  "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS",
]);

const snapshot = (employer) => ({
  org: { id: employer.org.id },
  entity: { id: employer.entity.id },
  unit: { id: employer.unit.id },
  worker: { id: employer.worker.id },
  owner: { id: employer.owner.id, name: employer.owner.name },
  marker: employer.marker,
  cookie: employer.cookie,
  rank: employer.rank,
  seeded: {},
});

export async function bootstrapAllowlistedReads({
  env = process.env,
  makeSession = standaloneMakeSession,
  seed = seedEmployer,
  file = "/tmp/payrollph-tenant-allowlist-reads.json",
} = {}) {
  requireTenantTableDisposable(env);
  assert.equal(env.TENANT_TABLE_PROFILE, "allowlisted-reads");
  assert.ok(env.GITHUB_ENV, "GITHUB_ENV required so server and runner share actual employer IDs");
  assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length, 0,
    "Bootstrap refuses a nonempty organization table (disposable database only)");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const attackerA = await seed("ATTA", nonce, makeSession);
  const attackerB = await seed("ATTB", nonce, makeSession);
  const victim = await seed("VICTIM", nonce, makeSession);
  const excluded = await seed("UNLISTED", nonce, makeSession);
  const ids = [attackerA.org.id, attackerB.org.id, victim.org.id];
  assert.ok(ids.every(id => Number.isSafeInteger(id) && id > 0 && id < 2147483648));
  assert.ok(ids[2] > ids[0] && ids[2] > ids[1], "victim ID must exceed both attackers");
  assert.ok(!ids.includes(excluded.org.id), "excluded employer must NOT be allowlisted");
  assert.ok(ids.length <= 20 && ids.join(",").length <= 240, "strict WFM allowlist length limits");
  const data = { schema: "payrollph-tenant-allowlist-preseed-v1",
    employers: [snapshot(victim), snapshot(attackerA), snapshot(attackerB)],
    excluded: { ...snapshot(excluded), rank: 8 }, allowlistedIds: ids };
  writeFileSync(file, JSON.stringify(data), { encoding: "utf8", mode: 0o600, flag: "wx" });
  for (const key of ALLOWLIST_ENV_KEYS) appendFileSync(env.GITHUB_ENV, key + "=" + ids.join(",") + "\n");
  appendFileSync(env.GITHUB_ENV, "TENANT_TABLE_ALLOWLIST_FIXTURE=" + file + "\n");
  console.log(JSON.stringify({ kind: "tenant-allowlist-bootstrap", profile: env.TENANT_TABLE_PROFILE,
    allowedEmployers: ids.length, excludedEmployers: 1, sessionCookiesLogged: false,
    database: "disposable localhost PG16", productionTested: false, credited: 0 }));
  return data;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-table-allowlist-bootstrap.mjs")) {
  bootstrapAllowlistedReads().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
}
