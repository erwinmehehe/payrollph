/**
 * DL-02-only pre-server fixture. Exactly THREE fictional employers:
 * two attackers seeded before a real higher-ID victim. No production/Neon.
 * The server reads explicit numeric allowlists generated here, never wildcards.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../src/db";
import { organizations } from "../../src/db/schema";
import {
  requireTenantTableDisposable, seedEmployer, standaloneMakeSession,
} from "./tenant-table-http.mjs";

export async function bootstrapDl02Closure(env = process.env) {
  requireTenantTableDisposable(env);
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.TENANT_DL02_CLOSURE_PROOF, "isolated-ci-only");
  assert.equal(env.TENANT_TABLE_PROFILE, "allowlisted-reads");
  assert.ok(env.GITHUB_ENV);
  assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length, 0,
    "DL-02 bootstrap refuses to seed anything but the empty disposable app_db");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  const employer = (e) => ({
    label: e.label, marker: e.marker, org: { id: e.org.id },
    entity: { id: e.entity.id }, unit: { id: e.unit.id },
    worker: { id: e.worker.id }, owner: { id: e.owner.id, name: e.owner.name },
    cookie: e.cookie,
  });
  const ids = [a.org.id, b.org.id, victim.org.id];
  assert.ok(ids.every((id) => Number.isSafeInteger(id) && id > 0));
  assert.ok(ids[2] > ids[0] && ids[2] > ids[1]);
  const directory = mkdtempSync(join(tmpdir(), "payrollph-dl02-"));
  const path = join(directory, "three-employers.json");
  writeFileSync(path, JSON.stringify({
    schema: "tenant-dl02-closure-three-employers-v1",
    attackers: [employer(a), employer(b)], victim: employer(victim), allowlistedIds: ids,
  }), { mode: 0o600, flag: "wx" });
  for (const key of ["WFM_PUNCH_EVIDENCE_ORG_IDS", "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS"]) {
    appendFileSync(env.GITHUB_ENV, key + "=" + ids.join(",") + "\n");
  }
  appendFileSync(env.GITHUB_ENV, "TENANT_DL02_CLOSURE_FIXTURE=" + path + "\n");
  console.log(JSON.stringify({
    kind: "tenant-dl02-bootstrap", fictionalEmployers: 3, attackers: 2,
    victimIdHigher: true, cookiesLogged: false, providerCalls: 0, credits: 0,
  }));
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-dl02-closure-bootstrap.mjs")) {
  bootstrapDl02Closure().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}
