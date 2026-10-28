/**
 * Independent synthetic POST/PATCH offline-claim tenant proof.
 * The receipt-pinned shared GET/write acceptance runs FIRST in this same
 * flagged-reads GitHub Actions PG16 job. This module seeds its own three
 * fictional employers, preserving that shared code and its recorded receipt.
 * No customer, attendance ledger, provider, or payroll endpoint is changed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/db";
import { createRows as createOfflineClaimReadRows } from "./tenant-table-rows/read/offline-claims.mjs";
import { verifyOfflineClaimsTenantWrites } from "./tenant-offline-claims-http.mjs";
import {
  requireTenantTableDisposable, seedEmployer, standaloneMakeSession,
  standaloneRequest, standaloneExpectStatus,
} from "./tenant-table-http.mjs";

function assertStandaloneTarget(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "flagged-reads",
    FACE_OFFLINE_PUNCH_UI_ENABLED: "true",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_SECRET_KEY: "",
    XENDIT_SECRET_KEY: "",
  };
  for (const [name, expected] of Object.entries(exact)) {
    assert.equal(env[name] ?? "", expected, "OFFLINE_CLAIM_REFUSED: " + name);
  }
  requireTenantTableDisposable(env);
}

async function main() {
  // Refuse all unsafe targets before ANY fixture insert or authenticated HTTP.
  assertStandaloneTarget();
  const rows = createOfflineClaimReadRows({ assert, db });
  assert.equal(rows.length, 1, "exactly the existing GET seed source is reused");
  const [source] = rows;
  assert.equal(source.key, "GET attendance/offline-claims");
  assert.equal(source.profile, "flagged-reads");
  assert.deepEqual(source.flags, ["FACE_OFFLINE_PUNCH_UI_ENABLED"]);

  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const attackerA = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const attackerB = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  for (const employer of [attackerA, attackerB, victim]) {
    employer.seeded[source.key] = await source.seed(employer);
    assert.equal(employer.seeded[source.key].organizationId, employer.org.id);
  }
  assert.ok(victim.seeded[source.key].id > attackerA.seeded[source.key].id
    && victim.seeded[source.key].id > attackerB.seeded[source.key].id,
    "higher-ID victim has a genuine, already persisted read-row claim");

  await verifyOfflineClaimsTenantWrites([victim, attackerA, attackerB], {
    request: standaloneRequest,
    expectStatus: standaloneExpectStatus,
    makeSession: standaloneMakeSession,
  });
  console.log("OFFLINE CLAIM STANDALONE PASS: separate fictional PG16 employers; "
    + "shared receipt-pinned GET/write proof unchanged; zero coverage credits");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-offline-claims-standalone.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
