/**
 * MKT-01 independent, platform-only marketing report proof.
 * Real HTTP -> production-mode Next -> fictional disposable PostgreSQL 16.
 * MKT-01 is not an employer-scoped API: email allowlist + recent MFA is its boundary.
 * No provider calls, worker jobs, customer data, payroll or method credit.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  MKT01_OPERATOR, MKT01_STALE, requireDisposableMkt01,
  assertMkt01Aggregate, assertMkt01Denied, assertMkt01Unchanged,
} from "./tenant-mkt01-marketing-report-contract.mjs";

const BASE = "http://127.0.0.1:3000";
const PATH = "/api/marketing/leads";
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
const jsonCopy = value => JSON.parse(JSON.stringify(value));

async function realGet(url, cookie) {
  const response = await fetch(BASE + url, {
    method: "GET", redirect: "manual", cache: "no-store",
    headers: cookie ? { cookie } : {},
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: response.headers };
}

async function proveMarketingReport() {
  // No DB or application imports are permitted before this refusal guard.
  requireDisposableMkt01();
  const { pool } = await import("../../src/db/index.ts");
  const nonce = randomBytes(6).toString("hex");
  const marker = "MKT01-" + nonce;
  const query = (sql, values = []) => pool.query(sql, values);
  const total = async table => Number((await query("SELECT COUNT(*)::int AS n FROM " + table)).rows[0].n);

  try {
    const ver = await query("SHOW server_version_num");
    assert.equal(Math.floor(Number(ver.rows[0].server_version_num) / 10000), 16,
      "MKT01_REFUSED: actual disposable PostgreSQL 16 required");
    for (const table of ["users", "organizations", "marketing_leads", "payroll_runs", "audit_events"]) {
      assert.equal(await total(table), 0, "MKT01_REFUSED: nonempty " + table + " is forbidden");
    }

    async function account(label, email, recentMfa) {
      const organization = (await query(
        "INSERT INTO organizations (name,legal_name) VALUES ($1,$2) RETURNING id",
        [marker + "-" + label, marker + "-" + label + " LLC"]
      )).rows[0];
      const user = (await query(
        "INSERT INTO users (email,name,password_hash,role,totp_enabled,active) VALUES ($1,$2,$3,'owner',true,true) RETURNING id",
        [email, marker + " fictional " + label, "!no-real-password!"]
      )).rows[0];
      await query(
        "INSERT INTO user_organizations (user_id,organization_id,role,active) VALUES ($1,$2,'owner',true)",
        [user.id, organization.id]
      );
      const token = randomBytes(32).toString("hex");
      const session = (await query(
        "INSERT INTO sessions (user_id,token_hash,expires_at,last_seen_at,mfa_verified_at,auth_method) " +
        "VALUES ($1,$2,NOW() + INTERVAL '1 day',NOW(),NOW() - $3::int * INTERVAL '1 hour','local') RETURNING id",
        [user.id, sha256(token), recentMfa ? 0 : 48]
      )).rows[0];
      return {
        label, email, orgId: organization.id, userId: user.id,
        sessionId: session.id, cookie: "__Host-linaw_session=" + token,
      };
    }

    const attackerA = await account("ATTA", MKT01_OPERATOR, true);
    const attackerB = await account("ATTB", MKT01_STALE, false);
    const victim = await account("VICTIM", "mkt01.victim@example.test", true);
    assert.ok(victim.orgId > attackerA.orgId && victim.orgId > attackerB.orgId,
      "victim organization must be persisted after two independent employers");
    assert.ok(victim.userId > attackerA.userId && victim.userId > attackerB.userId,
      "victim user must be a real higher-ID persisted identity");

    const prospects = [];
    async function seedLead(kind, label, age, campaign) {
      const row = {
        kind,
        name: marker + " Private Name " + label,
        email: "mkt01-" + nonce + "-" + label.toLowerCase() + "@example.test",
        company: marker + " Private Company " + label,
        notes: marker + " PRIVATE MESSAGE " + label,
        headcount: label === "ATTB" ? "11-50" : "1-10",
        sourcePath: "/book-demo",
        campaign,
      };
      const inserted = (await query(
        "INSERT INTO marketing_leads (kind,name,email,company,notes,headcount,source_path,attribution,created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW() - $9::int * INTERVAL '1 day') RETURNING id",
        [row.kind, row.name, row.email, row.company, row.notes, row.headcount,
          row.sourcePath,
          JSON.stringify({ landingPath: "/mkt01", utmSource: "fictional-ci",
            utmMedium: "private-proof", utmCampaign: campaign }), age]
      )).rows[0];
      assert.ok(Number.isSafeInteger(inserted.id) && inserted.id > 0);
      prospects.push({ ...row, id: inserted.id });
    }
    await seedLead("demo", "ATTA", 2, "synthetic-ad-a");
    await seedLead("trial-access", "ATTB", 3, "synthetic-ad-b");
    await seedLead("demo", "VICTIM", 4, "synthetic-ad-c");
    await seedLead("demo", "OLD", 400, "synthetic-old-excluded");
    assert.ok(prospects[2].id > prospects[0].id && prospects[2].id > prospects[1].id,
      "private higher-ID prospect must be persisted, not merely simulated");

    async function state() {
      const tables = ["marketing_leads", "audit_events", "payroll_runs",
        "organizations", "user_organizations"];
      const result = {};
      for (const table of tables) {
        const rows = (await query("SELECT * FROM " + table + " ORDER BY id")).rows;
        result[table] = jsonCopy(rows);
      }
      return result;
    }
    const before = await state();
    const privateFields = prospects.flatMap(p => [p.name, p.email, p.company, p.notes]);

    const anonymous = await realGet(PATH + "?days=7");
    assertMkt01Denied(anonymous, 401, privateFields);
    const outsider = await realGet(PATH + "?days=7", victim.cookie);
    assertMkt01Denied(outsider, 403, privateFields);
    const stale = await realGet(PATH + "?days=7", attackerB.cookie);
    assertMkt01Denied(stale, 403, privateFields);
    assert.equal(stale.json?.code, "MFA_REQUIRED",
      "a configured TOTP factor is insufficient without session-level recent MFA");

    const authorized = await realGet(PATH + "?days=7", attackerA.cookie);
    const report = assertMkt01Aggregate(authorized,
      { days: 7, total: 3, attributed: 3 }, privateFields);
    assert.deepEqual(report.byRequestType,
      [{ key: "demo", count: 2 }, { key: "trial", count: 1 }],
      "operator must see only aggregate demo/trial counts from fictional records");
    assert.equal(report.byCampaign.length, 3,
      "fictional campaign attribution must be count-only, no prospect fields");

    assertMkt01Aggregate(await realGet(PATH + "?days=1", attackerA.cookie),
      { days: 1, total: 0, attributed: 0 }, privateFields);
    assertMkt01Aggregate(await realGet(PATH + "?days=9999", attackerA.cookie),
      { days: 365, total: 3, attributed: 3 }, privateFields);
    assertMkt01Aggregate(await realGet(PATH + "?days=not-a-number", attackerA.cookie),
      { days: 90, total: 3, attributed: 3 }, privateFields);
    assertMkt01Unchanged(before, await state(),
      "four authenticated/untrusted HTTP report reads");

    // A syntactically valid cookie ceases to be a platform credential after revocation.
    await query("UPDATE sessions SET revoked_at = NOW() WHERE id = $1",
      [attackerA.sessionId]);
    const revoked = await realGet(PATH + "?days=7", attackerA.cookie);
    assertMkt01Denied(revoked, 401, privateFields);
    assertMkt01Unchanged(before, await state(),
      "revoking a synthetic operator session must never mutate lead or payroll data");

    console.log(JSON.stringify({
      family: "MKT-01", source: "production-built localhost",
      postgresMajor: 16, operatorOwnedReport: true,
      deniedAnonymous: true, deniedUnallowlistedHigherIdUser: true,
      deniedStaleMfaSession: true, deniedRevokedSession: true,
      privateProspectFieldsExcluded: true, boundedReportDays: true,
      snapshotRowsUnchanged: true, newCoverageCredits: 0,
      independentSecurityReview: "PENDING", productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

proveMarketingReport().catch(error => {
  // Never print SQL parameters, cookies or fictional PII on failure.
  console.error("MKT01_PROOF_FAILED: " + (error?.code ?? error?.name ?? "proof failure"));
  process.exitCode = 1;
});
