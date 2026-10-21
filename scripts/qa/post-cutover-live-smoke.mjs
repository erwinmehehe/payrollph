#!/usr/bin/env node
/**
 * Owner-only, read-only live post-cutover smoke. No write option exists.
 * The only remote HTTP requests are fixed read-only readiness GETs; no Neon APIs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  DATABASE, ROLES, assertSameDatabase, inspectExtension, inspectGrants,
  inspectIdentity, inspectLedger, inspectRoles, readAuditChain, readCatalog,
  reportWriter, requireLiveOperator, validateDatabaseUrl,
} from "./post-cutover-smoke-contract.mjs";
import { attestRuntimeTarget, RUNTIME_PROBE_URL } from "./verify-production-runtime-db-target.mjs";

const out = "qa-artifacts/post-cutover-smoke/live-report.json";
const { report, check, finish } = reportWriter("post-cutover-live-readonly", out);
const env = process.env;
let app, planner, sealer;
let reference;
let stopped = false;

async function readonly(client, task) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  try {
    const result = await task();
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function referenceReport() {
  const args = process.argv.slice(2);
  assert.deepEqual(args.filter(a => a.startsWith("--")), ["--ci-report"],
    "LIVE_REQUIRES_ONE_CI_REPORT_ARGUMENT");
  const index = args.indexOf("--ci-report");
  assert.ok(index !== -1 && args[index + 1] && args.length === 2,
    "LIVE_CI_REPORT_PATH_REQUIRED");
  const candidate = JSON.parse(readFileSync(args[index + 1], "utf8"));
  assert.equal(candidate.kind, "post-cutover-ci-smoke", "REFERENCE_NOT_A_CI_SMOKE");
  assert.equal(candidate.failed, 0, "REFERENCE_CI_MUST_HAVE_PASSED");
  assert.equal(candidate.commitSha, env.EXPECTED_PRODUCTION_COMMIT_SHA,
    "REFERENCE_REVIEWED_SHA_MISMATCH");
  const catalog = candidate.checks?.find(c => c.name === "catalog snapshot");
  assert.equal(catalog?.status, "PASS", "REFERENCE_CATALOG_NOT_PASSED");
  assert.ok(Number.isSafeInteger(catalog?.detail?.tableCount) &&
    catalog.detail.tableCount > 200, "REFERENCE_TABLE_COUNT_MISSING");
  assert.match(catalog?.detail?.fingerprintSha256 ?? "", /^[0-9a-f]{64}$/,
    "REFERENCE_FINGERPRINT_MISSING");
  return catalog.detail;
}

async function getJson(path, token) {
  const url = new URL(path, new URL(RUNTIME_PROBE_URL).origin);
  assert.equal(url.protocol, "https:", "READINESS_HTTPS_REQUIRED");
  assert.equal(url.origin, new URL(RUNTIME_PROBE_URL).origin, "READINESS_FIXED_HOST_REQUIRED");
  const response = await fetch(url, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: token ? { "x-readiness-token": token, Accept: "application/json" }
      : { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(response.status, 200, "READINESS_HTTP_200_REQUIRED");
  assert.ok(response.headers.get("content-type")?.includes("application/json"),
    "READINESS_JSON_REQUIRED");
  const body = await response.text();
  assert.ok(body.length < 100000, "READINESS_RESPONSE_TOO_LARGE");
  return JSON.parse(body);
}

try {
  // No network access, including token-bearing GET, until ALL source-side pins match.
  await check("owner-only pinned target", async () => {
    requireLiveOperator(env, process.argv.slice(2));
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"] }).trim(),
    env.EXPECTED_PRODUCTION_COMMIT_SHA, "LOCAL_CHECKOUT_SHA_MISMATCH");
    assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"] }).trim(), "main",
    "OWNER_MUST_RUN_FROM_MAIN");
    const locations = [
      validateDatabaseUrl(env.POST_CUTOVER_APP_DATABASE_URL, ROLES.app, env),
      validateDatabaseUrl(env.POST_CUTOVER_PLANNER_DATABASE_URL, ROLES.planner, env),
      validateDatabaseUrl(env.POST_CUTOVER_SEALER_DATABASE_URL, ROLES.sealer, env),
    ];
    assertSameDatabase(locations);
    reference = referenceReport();
    assert.equal(typeof env.PRODUCTION_READINESS_TOKEN, "string",
      "LIVE_READINESS_TOKEN_REQUIRED");
    assert.ok(env.PRODUCTION_READINESS_TOKEN.length >= 32,
      "LIVE_READINESS_TOKEN_TOO_SHORT");
    return { database: DATABASE, writesAllowed: false };
  }, { fatal: true });

  await check("deployed commit and Neon runtime attestation", () => attestRuntimeTarget({
    token: env.PRODUCTION_READINESS_TOKEN,
    expectations: {
      commitSha: env.EXPECTED_PRODUCTION_COMMIT_SHA,
      databaseName: DATABASE,
      projectId: env.EXPECTED_PRODUCTION_NEON_PROJECT_ID,
      branchId: env.EXPECTED_PRODUCTION_NEON_BRANCH_ID,
      endpointId: env.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID,
      roleName: ROLES.app,
    },
  }), { fatal: true });

  app = new pg.Client({ connectionString: env.POST_CUTOVER_APP_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 12000,
    application_name: "payrollph-owner-postcutover-readonly-app" });
  planner = new pg.Client({ connectionString: env.POST_CUTOVER_PLANNER_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 12000,
    application_name: "payrollph-owner-postcutover-readonly-planner" });
  sealer = new pg.Client({ connectionString: env.POST_CUTOVER_SEALER_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 12000,
    application_name: "payrollph-owner-postcutover-readonly-sealer" });
  await check("real login sessions match independently pinned target", async () => {
    await app.connect();
    await planner.connect();
    await sealer.connect();
    await readonly(app, () => inspectIdentity(app, env, ROLES.app));
    await readonly(planner, () => inspectIdentity(planner, env, ROLES.planner));
    await readonly(sealer, () => inspectIdentity(sealer, env, ROLES.sealer));
    return { app: ROLES.app, planner: ROLES.planner, sealer: ROLES.sealer };
  }, { fatal: true });

  await check("restricted role attributes and grants", () =>
    readonly(planner, async () => {
      const a = await inspectRoles(planner);
      await inspectGrants(planner);
      return a;
    }), { fatal: true });
  await check("required btree_gist extension", () =>
    readonly(planner, () => inspectExtension(planner)));
  await check("migration receipts and cutover row", () =>
    readonly(planner, () => inspectLedger(planner)));
  await check("catalog table count and schema fingerprint parity", () =>
    readonly(planner, async () => {
      const actual = await readCatalog(planner);
      assert.equal(actual.tableCount, reference.tableCount, "CI_LIVE_TABLE_COUNT_MISMATCH");
      assert.equal(actual.fingerprintSha256, reference.fingerprintSha256,
        "CI_LIVE_SCHEMA_FINGERPRINT_MISMATCH");
      return { ...actual, matchesCi: true };
    }));
  await check("audit chain anchored and no missing tail", () =>
    readonly(app, async () => {
      const chain = await readAuditChain(app);
      assert.equal(chain.verified, true, "AUDIT_CHAIN_BREAK_" + chain.breaks.join("_"));
      assert.equal(chain.pendingEvents, 0, "AUDIT_UNSEALED_TAIL_REQUIRES_OWNER_REVIEW");
      return { verified: true, sealedEvents: chain.sealedEvents, chainsChecked: chain.chainsChecked };
    }));
  await check("deployed readiness and public liveness", async () => {
    const publicHealth = await getJson("/api/health");
    assert.equal(typeof publicHealth.ok, "boolean", "HEALTH_SHAPE_CHANGED");
    const publicStatus = await getJson("/api/status");
    assert.equal(typeof publicStatus.ok, "boolean", "STATUS_SHAPE_CHANGED");
    const readiness = await getJson("/api/readiness", env.PRODUCTION_READINESS_TOKEN);
    assert.ok(["launch-ready", "not-launch-ready"].includes(readiness.status),
      "READINESS_STATE_UNKNOWN");
    const auditGate = readiness.gates?.find(x => x.key === "audit-chain-protection");
    assert.equal(auditGate?.ready, true, "AUDIT_READINESS_MUST_BE_READY");
    return { readinessState: readiness.status, auditProtectionReady: true };
  });
} catch {
  stopped = true;
} finally {
  await Promise.all([app, planner, sealer].filter(Boolean).map(c => c.end().catch(() => {})));
  const result = finish({ stoppedEarly: stopped, noDatabaseMutations: true });
  if (result.failed || stopped) process.exitCode = 1;
}
