/**
 * MKT-01 SOLO_VERIFIED_DEV_RECOVERY platform-only marketing report proof.
 * Real HTTP -> production-mode Next -> fictional disposable PostgreSQL 16.
 * MKT-01 is not an employer-scoped API: email allowlist + recent MFA is its boundary.
 * No provider calls, worker jobs, customer data, payroll or proof-run method credit.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  MKT01_OPERATOR, MKT01_STALE, requireDisposableMkt01,
  assertMkt01Aggregate, assertMkt01Denied, assertMkt01Unchanged,
} from "./tenant-mkt01-marketing-report-contract.mjs";

const BASE = "http://127.0.0.1:3000";
const PATH = "/api/marketing/leads";
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
const jsonCopy = value => JSON.parse(JSON.stringify(value));

async function realGet(url, cookie, options = {}) {
  const response = await fetch((options.base ?? BASE) + url, {
    method: "GET", redirect: "manual", cache: "no-store",
    headers: { ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
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

    // Capture every durable table with an employer or actor ownership field,
    // as well as the entire lead, organization, audit, payroll and user tables.
    // Sessions are auth credentials and are deliberately mutated for MFA/revocation.
    const boundTables = (await query(
      "SELECT DISTINCT c.table_name FROM information_schema.columns c " +
      "JOIN information_schema.tables t ON t.table_schema = c.table_schema " +
      "AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' " +
      "WHERE c.table_schema = 'public' " +
      "AND c.column_name = ANY($1::text[]) ORDER BY c.table_name",
      [["organization_id", "legal_employer_id", "employer_id",
        "business_id", "company_id", "user_id"]]
    )).rows.map(row => row.table_name);
    const protectedTables = [...new Set([...boundTables, "marketing_leads",
      "audit_events", "payroll_runs", "organizations",
      "user_organizations", "users"])].filter(table => table !== "sessions").sort();
    assert.ok(protectedTables.length >= 6, "missing durable employer-owned table snapshots");
    async function state() {
      const result = {};
      for (const table of protectedTables) {
        const safeTable = table.replaceAll('"', '""');
        const rows = (await query(
          'SELECT row_to_json(t)::text AS snapshot FROM "' + safeTable + '" AS t'
        )).rows;
        result[table] = rows.map(row => row.snapshot).sort();
      }
      return result;
    }
    const before = await state();
    // Every HTTP request gets its OWN before/after database comparison.
    async function auditedGet(url, cookie, options = {}) {
      const justBefore = await state();
      const response = await realGet(url, cookie, options);
      lastHttp = { request: url, base: options.base ?? BASE,
        status: response.status, body: response.text };
      assertMkt01Unchanged(justBefore, await state(),
        "durable marketing and employer rows after " + url);
      return response;
    }
    const privateFields = prospects.flatMap(p => [p.name, p.email, p.company, p.notes]);

    const anonymous = await auditedGet(PATH + "?days=7");
    assertMkt01Denied(anonymous, 401, privateFields);
    const outsider = await auditedGet(PATH + "?days=7", victim.cookie);
    assertMkt01Denied(outsider, 403, privateFields);
    const stale = await auditedGet(PATH + "?days=7", attackerB.cookie);
    assertMkt01Denied(stale, 403, privateFields);
    assert.equal(stale.json?.code, "MFA_REQUIRED",
      "a configured TOTP factor is insufficient without session-level recent MFA");

    const authorized = await auditedGet(PATH + "?days=7", attackerA.cookie);
    const report = assertMkt01Aggregate(authorized,
      { days: 7, total: 3, attributed: 3 }, privateFields);
    assert.deepEqual(report.byRequestType,
      [{ key: "demo", count: 2 }, { key: "trial", count: 1 }],
      "operator must see only aggregate demo/trial counts from fictional records");
    assert.equal(report.byCampaign.length, 3,
      "fictional campaign attribution must be count-only, no prospect fields");

    // Second separately signed-in allowlisted user: a stale session must first fail,
    // then the same persisted fictional session can succeed only after its MFA
    // freshness is advanced. This is a CI-only session state change, not TOTP UAT.
    await query("UPDATE sessions SET mfa_verified_at = NOW() WHERE id = $1",
      [attackerB.sessionId]);
    const authorizedB = await auditedGet(PATH + "?days=7", attackerB.cookie);
    const secondReport = assertMkt01Aggregate(authorizedB,
      { days: 7, total: 3, attributed: 3 }, privateFields);
    const stableAggregate = ({ since, ...fields }) => fields;
    assert.deepEqual(stableAggregate(secondReport), stableAggregate(report),
      "two separately signed-in operator accounts must see identical safe aggregates");

    // This global report has no employer/object selector. Inject real higher-ID
    // victim IDs and an attempted raw format in a valid operator request:
    // they must never expose a row or alter the fixed aggregate contract.
    const selectors = new URLSearchParams({
      days: "7", organizationId: String(victim.orgId),
      employerId: String(victim.orgId), businessId: String(victim.orgId),
      legalEmployerId: String(victim.orgId), employeeId: String(victim.userId),
      runId: String(prospects[2].id), email: victim.email, format: "raw",
    });
    const forgedUrl = PATH + "?" + selectors.toString();
    const forgedHeaders = {
      employerId: String(victim.orgId), businessId: String(victim.orgId),
      legalEmployerId: String(victim.orgId), email: victim.email,
      "x-employer-id": String(victim.orgId), "x-business-id": String(victim.orgId),
      "x-legal-employer-id": String(victim.orgId), "x-email": victim.email,
    };
    const forgedCookie = attackerA.cookie + "; employerId=" + victim.orgId +
      "; businessId=" + victim.orgId + "; legalEmployerId=" + victim.orgId +
      "; email=" + victim.email;
    for (const probe of [
      { name: "query", url: forgedUrl, cookie: attackerA.cookie },
      { name: "headers", url: PATH + "?days=7", cookie: attackerA.cookie,
        options: { headers: forgedHeaders } },
      { name: "cookie", url: PATH + "?days=7", cookie: forgedCookie },
      { name: "all surfaces", url: forgedUrl, cookie: forgedCookie,
        options: { headers: forgedHeaders } },
    ]) {
      const forgedAuthorized = await auditedGet(probe.url, probe.cookie, probe.options);
      const forgedReport = assertMkt01Aggregate(forgedAuthorized,
        { days: 7, total: 3, attributed: 3 }, privateFields);
      assert.deepEqual(stableAggregate(forgedReport), stableAggregate(report),
        probe.name + ": forged selector must not change the operator aggregate");
    }
    assertMkt01Denied(await auditedGet(forgedUrl, victim.cookie), 403, privateFields);

    for (const [value, days, total] of [
      ["1", 1, 0], ["-999", 1, 0], ["0", 1, 0],
      ["9999", 365, 3], ["1000000000000", 365, 3],
      ["NaN", 90, 3], ["not-a-number", 90, 3], ["Infinity", 90, 3],
    ]) {
      assertMkt01Aggregate(
        await auditedGet(PATH + "?days=" + encodeURIComponent(value), attackerA.cookie),
        { days, total, attributed: total }, privateFields);
    }

    // Two actual production-mode loopback servers test the empty and ABSENT
    // allowlist, not a mocked guard or a removed variable in the test runner.
    async function disabledAllowlistServer(mode, port) {
      const env = { ...process.env };
      if (mode === "unset") delete env.MARKETING_REPORT_EMAILS;
      else env.MARKETING_REPORT_EMAILS = "";
      const server = spawn(process.execPath,
        ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1",
          "-p", String(port)], { env, stdio: "ignore" });
      const base = "http://127.0.0.1:" + port;
      try {
        let ready = false;
        for (let attempt = 0; attempt < 90; attempt++) {
          assert.equal(server.exitCode, null, "disabled allowlist server exited early");
          try {
            const response = await fetch(base + "/login", { cache: "no-store" });
            if (response.status === 200) { ready = true; break; }
          } catch { /* wait for loopback only */ }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(ready, "disabled allowlist server must be ready on localhost");
        const disabled = await auditedGet(PATH + "?days=7", attackerA.cookie,
          { base });
        assertMkt01Denied(disabled, 503, privateFields);
      } finally {
        server.kill("SIGTERM");
      }
    }
    await disabledAllowlistServer("empty", 3001);
    await disabledAllowlistServer("unset", 3002);
    assertMkt01Unchanged(before, await state(),
      "all HTTP probes preserve every employer-owned and lead row");

    // A syntactically valid cookie ceases to be a platform credential after revocation.
    await query("UPDATE sessions SET revoked_at = NOW() WHERE id = $1",
      [attackerA.sessionId]);
    const revoked = await auditedGet(PATH + "?days=7", attackerA.cookie);
    assertMkt01Denied(revoked, 401, privateFields);
    assertMkt01Unchanged(before, await state(),
      "revoking a synthetic operator session must never mutate lead or payroll data");

    console.log(JSON.stringify({
      family: "MKT-01", evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY",
      source: "production-built localhost",
      postgresMajor: 16, operatorOwnedReport: true,
      deniedAnonymous: true, deniedUnallowlistedHigherIdUser: true,
      deniedStaleMfaSession: true, deniedRevokedSession: true,
      twoIndependentOperatorSuccesses: true,
      forgedHigherIdSelectorsIgnored: true,
      forgedQueryHeaderCookieEmployerBusinessLegalEmployerEmailIgnored: true,
      emptyAndUnsetAllowlist503: true, perRequestDurableRowsUnchanged: true,
      privateProspectFieldsExcluded: true, boundedReportDays: true,
      snapshotRowsUnchanged: true, newCoverageCredits: 0,
      independentSecurityReview: "PENDING", productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

let lastHttp = null;
proveMarketingReport().catch(error => {
  // Never print SQL parameters or bearer session cookies. The response body
  // here is from fictional localhost fixtures only; identify actual leaks.
  console.error("MKT01_PROOF_FAILED: " + (error?.code ?? error?.name ?? "proof failure") +
    " " + String(error?.message ?? "").slice(0, 300));
  if (lastHttp) console.error("MKT01_LAST_HTTP_REQUEST_RESPONSE: " +
    JSON.stringify(lastHttp).slice(0, 7000));
  process.exitCode = 1;
});
