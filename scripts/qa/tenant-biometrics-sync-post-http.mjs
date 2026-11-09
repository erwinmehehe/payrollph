/**
 * Provisional POST /api/biometrics/sync proof, ZERO coverage credits.
 * Real localhost production-mode HTTP and disposable PostgreSQL 16 only.
 * Both session-admin and device-bound bearer paths; never uses real devices.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:3000";
function requireDisposable() {
  const app = new URL(process.env.SECURITY_SMOKE_URL ?? "");
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.TENANT_BIOMETRIC_SYNC_MODE, "fictional-pg16");
  assert.equal(app.origin, BASE);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "5432");
  assert.equal(database.pathname, "/app_db");
  assert.notEqual(process.env.WORKER_ENABLED, "true");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.ok(!process.env[key], key + " must be absent");
  }
  assert.ok(process.env.BIOMETRIC_INGEST_SECRET?.startsWith("fictional-ci-only-"));
  assert.ok(process.env.BIOMETRIC_INGEST_SECRET.length >= 32);
}
async function run() {
  // This must precede all database/fixture imports.
  requireDisposable();
  const [{ db, pool }, schema, { eq, and, inArray }, fixtures, auth] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/biometric-auth.ts"),
  ]);
  const { organizations, users, biometricDevices, employees, timePunches, auditEvents, payrollRuns, payrollEntries } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixtures;
  const orgRows = (table, id) => db.select().from(table).where(eq(table.organizationId, id)).orderBy(table.id);
  const snapshot = async (e) => ({
    devices: await orgRows(biometricDevices, e.org.id),
    employees: await orgRows(employees, e.org.id),
    punches: await orgRows(timePunches, e.org.id),
    audits: await orgRows(auditEvents, e.org.id),
    runs: await orgRows(payrollRuns, e.org.id),
    // Payroll entries carry payrollRunId, not organizationId. Scope through real owned runs.
    entries: await db.select().from(payrollEntries).where(inArray(
      payrollEntries.payrollRunId,
      db.select({ id: payrollRuns.id }).from(payrollRuns)
        .where(eq(payrollRuns.organizationId, e.org.id)),
    )).orderBy(payrollEntries.id),
  });
  const snapshotAll = async (es) => Promise.all(es.map(snapshot));
  async function post(body, { cookie, bearer } = {}) {
    if (!bearer) return standaloneRequest("/api/biometrics/sync", { method: "POST", cookie, body });
    const response = await fetch(BASE + "/api/biometrics/sync", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + bearer },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, text, json };
  }
  function denial(response, expected, marker) {
    assert.equal(response.status, expected, "unexpected denial response: " + response.text.slice(0, 200));
    assert.ok(!response.text.includes(marker), "denial leaked victim marker");
    assert.ok(!response.text.includes("timePunches"), "denial leaked private table name");
  }
  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0, "database must start empty");
    assert.equal((await db.select().from(organizations).limit(1)).length, 0, "database must start empty");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id));
    const employers = [a, b, victim];
    for (const e of employers) {
      const [device] = await db.insert(biometricDevices).values({
        organizationId: e.org.id, deviceModel: "Fictional K40",
        serialNumber: e.marker, branchName: e.marker,
      }).returning();
      e.device = device;
    }
    const victimBaseline = await snapshot(victim);
    const workDate = "2028-06-17"; // Fictional future day, outside existing period locks.
    const bodyFor = (e) => ({
      organizationId: e.org.id, deviceSerial: e.device.serialNumber,
      logs: [{ employeeNo: e.worker.employeeNo, timestamp: workDate + "T09:15:00+08:00", punchType: "in" }],
    });
    const ownProof = async (e, options, mode) => {
      const other = employers.filter(x => x !== e);
      const beforeOthers = await snapshotAll(other);
      const before = await snapshot(e);
      const response = await post(bodyFor(e), options);
      assert.equal(response.status, 200, mode + ": own write must succeed " + response.text.slice(0, 200));
      assert.equal(response.json?.ingested, 1);
      assert.equal(response.json?.deviceSerial, e.device.serialNumber);
      const after = await snapshot(e);
      const added = after.punches.filter(row => !before.punches.some(old => old.id === row.id));
      assert.equal(added.length, 1, mode + ": persisted own punch required");
      assert.equal(added[0].organizationId, e.org.id);
      assert.equal(added[0].employeeId, e.worker.id);
      assert.equal(added[0].workDate, workDate);
      assert.equal(added[0].source, "biometric_adms");
      const audit = after.audits.slice(before.audits.length).filter(row => row.action === "Biometric attendance logs synced");
      assert.equal(audit.length, 1);
      assert.equal(audit[0].organizationId, e.org.id);
      assert.equal(audit[0].metadata.authentication, mode);
      assert.deepEqual(after.runs, before.runs, "must not modify payroll runs");
      assert.deepEqual(after.entries, before.entries, "must not modify payroll entries");
      assert.deepEqual(await snapshotAll(other), beforeOthers, "own write must not mutate other employers");
    };
    // Two independently authenticated employers must both persist own data.
    await ownProof(a, { cookie: a.cookie }, "session");
    await ownProof(b, { cookie: b.cookie }, "session");
    const allBefore = await snapshotAll(employers);
    for (const attacker of [a, b]) {
      // A real higher-ID victim identifier, not a fabricated foreign ID.
      denial(await post(bodyFor(victim), { cookie: attacker.cookie }), 403, victim.marker);
      denial(await post({
        ...bodyFor(attacker), organizationId: victim.org.id,
      }, { cookie: attacker.cookie }), 403, victim.marker);
      const forgedWorker = await post({
        ...bodyFor(attacker), logs: [{
          employeeNo: victim.worker.employeeNo, timestamp: workDate + "T10:15:00+08:00", punchType: "out",
        }],
      }, { cookie: attacker.cookie });
      assert.equal(forgedWorker.status, 200);
      assert.equal(forgedWorker.json?.ingested, 0, "foreign worker number must not be ingested");
      assert.equal(forgedWorker.json?.unmatched, 1);
      // Device bearer is HMAC-bound to both the allowed employer and serial.
      const token = auth.biometricDeviceCredential(process.env.BIOMETRIC_INGEST_SECRET,
        attacker.org.id, attacker.device.serialNumber);
      denial(await post(bodyFor(victim), { bearer: token }), 401, victim.marker);
      denial(await post({
        ...bodyFor(attacker), deviceSerial: victim.device.serialNumber,
      }, { bearer: token }), 401, victim.marker);
      denial(await post(bodyFor(attacker), { bearer: "wrong-fictional-device-token" }), 401, victim.marker);
    }
    // Negative probes may write their *own* audit row for unmatched workers.
    // Check victim full SQL state after every adversarial sequence.
    assert.deepEqual(await snapshot(victim), victimBaseline,
      "higher-ID victim devices, worker, attendance, audit and payroll must remain untouched");
    const victimToken = auth.biometricDeviceCredential(process.env.BIOMETRIC_INGEST_SECRET,
      victim.org.id, victim.device.serialNumber);
    // Demonstrate legitimate device-gateway success on a real third employer.
    await ownProof(victim, { bearer: victimToken }, "device-secret");
    const victimAfterOwn = await snapshot(victim);
    const tokenA = auth.biometricDeviceCredential(process.env.BIOMETRIC_INGEST_SECRET,
      a.org.id, a.device.serialNumber);
    const replay = await post(bodyFor(a), { bearer: tokenA });
    assert.equal(replay.status, 200);
    assert.equal(replay.json?.ingested, 0, "identical biometric replay must not insert");
    assert.equal(replay.json?.duplicates, 1);
    assert.deepEqual(await snapshot(victim), victimAfterOwn, "replay cannot mutate victim");
    // Explicitly no new claim in the shared tenant-isolation manifest.
    console.log(JSON.stringify({
      method: "POST /api/biometrics/sync", realHttpPg16: true,
      independentSessionOwners: 2, higherIdVictim: true,
      ownPersistedPunches: true, forbiddenOrganizationAndEmployee: true,
      deviceCredentialBoundToOrgAndSerial: true, ownDeviceGatewayPositive: true,
      victimSqlUnchanged: true, payrollUntouched: true, coverageCredits: 0,
      independentSecurityReview: "PENDING", productionTested: false,
    }));
  } finally { await pool.end(); }
}
run().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
