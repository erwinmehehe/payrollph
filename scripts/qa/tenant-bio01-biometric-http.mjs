/**
 * BIO-01 independent biometric-device credential and tenant boundary proof.
 * Disposable PostgreSQL 16 and real localhost Next HTTP, fictional rows only.
 * This probe is zero-credit and never contacts real devices or providers.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  requireDisposableBio01, assertBio01Denied,
  assertBio01Owned, assertBio01Unchanged,
} from "./tenant-bio01-biometric-contract.mjs";

const BASE = "http://127.0.0.1:3000";
const PATH = "/api/biometrics/sync";
const sha256 = input => createHash("sha256").update(input).digest("hex");
const copy = rows => JSON.parse(JSON.stringify(rows));

async function request(body, { cookie, credential, crossSite = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (credential) headers.Authorization = "Bearer " + credential;
  if (!credential) {
    headers.origin = crossSite ? "https:" + "//hostile.example.invalid" : BASE;
    headers["sec-fetch-site"] = crossSite ? "cross-site" : "same-origin";
  }
  const reply = await fetch(BASE + PATH, {
    method: "POST", headers, body: JSON.stringify(body),
    redirect: "manual", cache: "no-store",
  });
  const text = await reply.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: reply.status, text, json, headers: reply.headers };
}

async function proveBio01() {
  // MUST execute before importing any application code or opening any DB.
  requireDisposableBio01();
  const [{ pool }, credentialLib] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/lib/biometric-auth.ts"),
  ]);
  const { biometricDeviceCredential } = credentialLib;
  const query = (sql, args = []) => pool.query(sql, args);
  const nonce = randomBytes(5).toString("hex");
  const tag = "BIO01-" + nonce;

  try {
    const v = await query("SHOW server_version_num");
    assert.equal(Math.floor(Number(v.rows[0].server_version_num) / 10000), 16,
      "BIO01_REFUSED: actual disposable PostgreSQL 16 only");
    for (const table of ["users", "organizations", "employees", "biometric_devices",
      "time_punches", "audit_events", "payroll_runs"]) {
      const rows = await query("SELECT count(*)::int AS n FROM " + table);
      assert.equal(Number(rows.rows[0].n), 0,
        "BIO01_REFUSED: proof requires an empty " + table);
    }

    async function employer(label) {
      const marker = tag + "-" + label;
      const org = (await query(
        "INSERT INTO organizations (name,legal_name) VALUES ($1,$2) RETURNING id",
        [marker + " organization", marker + " Inc."]
      )).rows[0];
      const owner = (await query(
        "INSERT INTO users (email,name,password_hash,role,totp_enabled,active) " +
        "VALUES ($1,$2,'fictional-no-password','owner',true,true) RETURNING id",
        [marker.toLowerCase() + "@example.test", marker + " owner"]
      )).rows[0];
      await query(
        "INSERT INTO user_organizations (user_id,organization_id,role,active) " +
        "VALUES ($1,$2,'owner',true)", [owner.id, org.id]
      );
      const token = randomBytes(32).toString("hex");
      const session = (await query(
        "INSERT INTO sessions (user_id,token_hash,expires_at,last_seen_at,mfa_verified_at) " +
        "VALUES ($1,$2,NOW() + INTERVAL '1 day',NOW(),NOW()) RETURNING id",
        [owner.id, sha256(token)]
      )).rows[0];
      const worker = (await query(
        "INSERT INTO employees (organization_id,employee_no,first_name,last_name," +
        "title,avatar_initials,basic_rate,start_date) " +
        "VALUES ($1,$2,'Synthetic',$3,'Device CI','BC','20000.00','2026-01-05') RETURNING id",
        [org.id, marker, label]
      )).rows[0];
      await query(
        "INSERT INTO employee_pay_profiles (organization_id,employee_id,pay_basis," +
        "rate_amount,standard_work_days_per_month,standard_hours_per_day) " +
        "VALUES ($1,$2,'monthly','20000.00','22','8')",
        [org.id, worker.id]
      );
      const serial = marker + "-DEVICE";
      const device = (await query(
        "INSERT INTO biometric_devices (organization_id,device_model,serial_number,branch_name,status) " +
        "VALUES ($1,'Fictional offline reader',$2,$3,'offline') RETURNING id",
        [org.id, serial, marker + " branch"]
      )).rows[0];
      return {
        label, marker, org, owner, worker, device, serial, sessionId: session.id,
        cookie: "__Host-linaw_session=" + token,
      };
    }

    // The real third employer and its worker/device IDs are higher than both attackers.
    const a = await employer("ATTA");
    const b = await employer("ATTB");
    const victim = await employer("VICTIM");
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
    assert.ok(victim.device.id > a.device.id && victim.device.id > b.device.id);
    const employers = [a, b, victim];
    const foreignMarkers = [victim.marker, victim.serial, victim.owner.id.toString() + "@not-used"];

    async function state(orgId) {
      const tables = [
        "employees", "employee_pay_profiles", "biometric_devices", "time_punches",
        "audit_events", "payroll_runs", "user_organizations",
      ];
      const rows = {};
      for (const table of tables) {
        rows[table] = copy((await query(
          "SELECT * FROM " + table + " WHERE organization_id = $1 ORDER BY id", [orgId]
        )).rows);
      }
      return rows;
    }
    const allStates = () => Promise.all(employers.map(e => state(e.org.id)));
    const rawLog = (workerNo, type = "IN") => ({
      employeeNo: workerNo, timestamp: "2026-11-05T09:00:00+08:00",
      punchType: type,
    });
    const own = (e, employeeNo = e.marker, serial = e.serial) => ({
      organizationId: e.org.id, deviceSerial: serial, logs: [rawLog(employeeNo)],
    });
    const secret = process.env.BIOMETRIC_INGEST_SECRET;
    const token = (organizationId, serial) =>
      biometricDeviceCredential(secret, organizationId, serial);

    let denials = 0;
    async function deny(label, body, auth, status) {
      const before = await allStates();
      const response = await request(body, auth);
      assertBio01Denied(response, status, foreignMarkers);
      assertBio01Unchanged(before, await allStates(), label);
      denials++;
      return response;
    }

    // Two independently authenticated owners and one genuine foreign employer.
    await deny("anonymous", own(a), {}, 401);
    await deny("cross-site", own(a), { cookie: a.cookie, crossSite: true }, 403);
    await deny("foreign-organization", own(victim), { cookie: a.cookie }, 403);
    await deny("bad-secret", own(victim), {
      credential: token(a.org.id, a.serial),
    }, 401);
    await deny("foreign-device", own(a, a.marker, victim.serial), {
      cookie: a.cookie,
    }, 404);
    const missing = await deny("nonexistent-device", own(a, a.marker, "BIO01-NO-SUCH-DEVICE"), {
      cookie: a.cookie,
    }, 404);
    const foreign = await request(own(a, a.marker, victim.serial), { cookie: a.cookie });
    assertBio01Denied(foreign, 404, foreignMarkers);
    assert.deepEqual(foreign.json, missing.json,
      "foreign device and missing device in own employer have identical non-leaking errors");
    const forgedSerialBody = own(victim, victim.marker, victim.serial);
    await deny("forged-device-token-tenant", forgedSerialBody, {
      credential: token(a.org.id, a.serial),
    }, 401);
    await deny("forged-device-token-serial", own(a, a.marker, b.serial), {
      credential: token(a.org.id, a.serial),
    }, 401);

    // Genuine device HMAC makes exactly one persisted, employer-scoped IN punch.
    const beforeA = await allStates();
    const goodA = await request(own(a), {
      credential: token(a.org.id, a.serial),
    });
    assertBio01Owned(goodA, {
      deviceSerial: a.serial, ingested: 1, duplicates: 0,
      unmatched: 0, invalid: 0, locked: 0,
    }, foreignMarkers);
    const afterA = await allStates();
    assertBio01Unchanged(beforeA[1], afterA[1], "A device cannot mutate B");
    assertBio01Unchanged(beforeA[2], afterA[2], "A device cannot mutate VICTIM");
    assert.equal(afterA[0].time_punches.length, beforeA[0].time_punches.length + 1);
    const punchA = afterA[0].time_punches.at(-1);
    assert.equal(punchA.organization_id, a.org.id);
    assert.equal(punchA.employee_id, a.worker.id);
    assert.equal(punchA.device_serial, a.serial);
    assert.equal(punchA.source, "biometric_adms");
    const storedDay = (await query(
      "SELECT work_date::text AS day FROM time_punches WHERE id = $1", [punchA.id]
    )).rows[0]?.day;
    assert.equal(storedDay, "2026-11-05",
      "PostgreSQL work_date must preserve the supplied local work date");
    assert.equal(afterA[0].audit_events.length, beforeA[0].audit_events.length + 1);
    assert.equal(afterA[0].audit_events.at(-1).metadata.authentication, "device-secret");
    assert.equal(afterA[0].biometric_devices[0].status, "online");
    assert.ok(Date.parse(afterA[0].biometric_devices[0].last_sync_at) > 0);
    assertBio01Unchanged(beforeA[0].payroll_runs, afterA[0].payroll_runs,
      "owned success must never create payroll");
    assertBio01Unchanged(beforeA[0].employee_pay_profiles, afterA[0].employee_pay_profiles,
      "owned success must never change pay profiles");

    // An A-only credential may not write a real foreign worker's badge.
    const beforeVictimWorker = await allStates();
    const wrongWorker = await request(own(a, victim.marker), {
      credential: token(a.org.id, a.serial),
    });
    assertBio01Owned(wrongWorker, {
      deviceSerial: a.serial, ingested: 0, duplicates: 0,
      unmatched: 1, invalid: 0, locked: 0,
    }, foreignMarkers);
    const afterVictimWorker = await allStates();
    assertBio01Unchanged(beforeVictimWorker[2], afterVictimWorker[2],
      "victim-worker must not be matched or updated across organizations");
    assertBio01Unchanged(beforeVictimWorker[0].time_punches,
      afterVictimWorker[0].time_punches, "unmatched badge cannot persist an A punch");
    assertBio01Unchanged(beforeVictimWorker[1], afterVictimWorker[1],
      "unmatched badge cannot mutate independent B");

    const beforeReplay = await allStates();
    const replay = await request(own(a), { credential: token(a.org.id, a.serial) });
    assertBio01Owned(replay, {
      deviceSerial: a.serial, ingested: 0, duplicates: 1,
      unmatched: 0, invalid: 0, locked: 0,
    }, foreignMarkers);
    const afterReplay = await allStates();
    assertBio01Unchanged(beforeReplay[0].time_punches,
      afterReplay[0].time_punches, "replay-unchanged same date/time");
    assertBio01Unchanged(beforeReplay[2], afterReplay[2], "replay cannot mutate foreign");

    // A second authenticated employer creates only its own punch through a session.
    const beforeB = await allStates();
    const goodB = await request(own(b), { cookie: b.cookie });
    assertBio01Owned(goodB, {
      deviceSerial: b.serial, ingested: 1, duplicates: 0,
      unmatched: 0, invalid: 0, locked: 0,
    }, foreignMarkers);
    const afterB = await allStates();
    assert.equal(afterB[1].time_punches.length, beforeB[1].time_punches.length + 1);
    assert.equal(afterB[1].time_punches.at(-1).employee_id, b.worker.id);
    assert.equal(afterB[1].audit_events.length, beforeB[1].audit_events.length + 1);
    assert.equal(afterB[1].audit_events.at(-1).metadata.authentication, "session");
    assertBio01Unchanged(beforeB[0], afterB[0], "B session cannot mutate A");
    assertBio01Unchanged(beforeB[2], afterB[2], "B session cannot mutate VICTIM");

    // A cookie is not authority once its backing session is revoked.
    await query("UPDATE sessions SET revoked_at = NOW() WHERE id = $1", [b.sessionId]);
    await deny("revoked-session", own(b), { cookie: b.cookie }, 401);
    assert.equal(denials, 9, "all denial guards must execute without mutations");
    console.log(JSON.stringify({
      family: "BIO-01", postgresMajor: 16, http: "production-mode loopback",
      ownDeviceIngested: 1, ownSessionIngested: 1,
      replayCreatesNoSecondPunch: true,
      trueHigherIdVictimImmutable: true,
      deniedChecks: denials, crossTenantBadgeUnmatched: true,
      payrollUnchanged: true, newCoverageCredits: 0,
      independentSecurityReview: "PENDING", productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

proveBio01().catch(err => {
  // Never print credentials, cookies, DB parameters or device identifiers.
  console.error("BIO01_PROOF_FAILED: " + (err?.code ?? err?.name ?? "unexpected"));
  process.exitCode = 1;
});
