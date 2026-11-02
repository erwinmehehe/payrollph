/**
 * STA-01 labor inspection POST: real signed-in localhost HTTP + disposable PG16.
 * Proof candidate only, ZERO credits, no production/payroll/provider operations.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableLaborInspection, assertPrivateDenial, assertImmutable,
  LABOR_INSPECTION_POST,
} from "./tenant-labor-inspection-post-contract.mjs";

const ENDPOINT = "/api/compliance/labor-inspection";

export async function proveLaborInspectionPost() {
  requireDisposableLaborInspection(); // MUST precede every application/DB import.
  const [database, s, drizzle, helpers] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { db, pool } = database;
  const { and, eq, asc, inArray } = drizzle;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const counts = { ownAssign: 0, ownAcknowledge: 0, ownClose: 0,
    foreignRefusals: 0, forgedFindingRefusals: 0,
    auditVetoRollbacks: 0, revokedDenials: 0 };
  let vetoActive = false;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16);
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "Must refuse any nonempty employer database");
    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    const all = [a, b, victim];
    for (const key of ["org", "entity", "unit", "worker"]) {
      assert.ok(victim[key].id > a[key].id && victim[key].id > b[key].id,
        "Real victim must have a higher SQL ID for " + key);
    }

    async function state(e) {
      const id = e.org.id;
      const own = async table => db.select().from(table)
        .where(eq(table.organizationId, id)).orderBy(asc(table.id));
      const runs = await own(s.payrollRuns);
      const entries = runs.length ? await db.select().from(s.payrollEntries)
        .where(inArray(s.payrollEntries.payrollRunId, runs.map(row => row.id)))
        .orderBy(asc(s.payrollEntries.id)) : [];
      return JSON.parse(JSON.stringify({
        remediation: await own(s.laborInspectionRemediations),
        audit: await own(s.auditEvents),
        payrollRuns: runs, payrollEntries: entries,
        employees: await own(s.employees),
        profiles: await db.select().from(s.employeePayProfiles)
          .where(eq(s.employeePayProfiles.organizationId, id))
          .orderBy(asc(s.employeePayProfiles.employeeId)),
      }));
    }
    const freeze = async () => Object.fromEntries(await Promise.all(all.map(
      async e => [e.label, await state(e)])));
    async function unchanged(before, label, exceptions = []) {
      const after = await freeze();
      for (const e of all) {
        if (!exceptions.includes(e.label)) {
          assertImmutable(before[e.label], after[e.label], label + " " + e.label);
        }
      }
      return after;
    }
    const request = (path, method, cookie, body) =>
      helpers.standaloneRequest(path, { method, cookie, body });
    const post = (e, changes = {}) => request(ENDPOINT, "POST", e.cookie, {
      organizationId: e.org.id, findingKey: e.findingKey,
      action: "assign", owner: "Fictional People Ops " + e.label, ...changes,
    });

    // Trigger a reproducible active finding by removing only the fictional
    // employee's pay-profile row, never a payroll run or worker.
    for (const e of all) {
      const [original] = await db.select().from(s.employeePayProfiles)
        .where(and(eq(s.employeePayProfiles.organizationId, e.org.id),
          eq(s.employeePayProfiles.employeeId, e.worker.id))).limit(1);
      assert.ok(original);
      e.profile = original;
      await db.delete(s.employeePayProfiles).where(and(
        eq(s.employeePayProfiles.organizationId, e.org.id),
        eq(s.employeePayProfiles.employeeId, e.worker.id)));
    }
    for (const e of all) {
      const response = await request(ENDPOINT + "?organizationId=" + e.org.id,
        "GET", e.cookie);
      assert.equal(response.status, 200, response.text);
      const findings = response.json?.findings?.filter(row =>
        row.ruleCode === "PAY_PROFILE_MISSING" && row.employeeId === e.worker.id);
      assert.equal(findings?.length, 1, "Real missing-pay-profile finding required");
      e.findingKey = findings[0].key;
      assert.equal(e.findingKey, "PAY_PROFILE_MISSING:employee:" + e.worker.id);
    }

    let before = await freeze();
    for (const actor of [a, b]) {
      const foreign = await post(actor, {
        organizationId: victim.org.id, findingKey: victim.findingKey,
      });
      assertPrivateDenial(foreign, 403, [victim.marker]);
      await unchanged(before, "foreign actual employer");
      counts.foreignRefusals++;

      const stolen = await post(actor, { findingKey: victim.findingKey });
      const unknown = await post(actor, {
        findingKey: "PAY_PROFILE_MISSING:employee:99999999",
      });
      assertPrivateDenial(stolen, 409, [victim.marker]);
      assertPrivateDenial(unknown, 409, [victim.marker]);
      assert.equal(stolen.text, unknown.text,
        "Foreign and nonexistent finding keys must receive identical responses");
      await unchanged(before, "cross-bound and missing findings");
      counts.forgedFindingRefusals++;
    }

    // Own assign: one persisted remediation and exactly one actor-bound audit
    // per company; all other employers' data remain byte-identical.
    for (const e of all) {
      before = await freeze();
      const response = await post(e);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json?.remediation?.organizationId, e.org.id);
      assert.equal(response.json?.remediation?.findingKey, e.findingKey);
      assert.equal(response.json?.remediation?.status, "open");
      const after = await unchanged(before, "assign", [e.label]);
      assert.equal(after[e.label].remediation.length, before[e.label].remediation.length + 1);
      assert.equal(after[e.label].audit.length, before[e.label].audit.length + 1);
      assert.equal(after[e.label].audit.at(-1).action,
        "Labor inspection remediation owner assigned");
      assert.equal(after[e.label].audit.at(-1).metadata.findingKey, e.findingKey);
      assert.deepEqual(after[e.label].payrollRuns, before[e.label].payrollRuns);
      counts.ownAssign++;
    }

    // Force a real audit INSERT failure in disposable PG16. The remediation
    // ACK update must roll back in the exact same transaction.
    assert.ok(Number.isSafeInteger(a.org.id) && a.org.id > 0);
    const vetoSql = "CREATE OR REPLACE FUNCTION public.ci_labor_inspection_audit_veto() " +
      "RETURNS trigger LANGUAGE plpgsql AS $ci$ BEGIN " +
      "IF NEW.organization_id = " + a.org.id +
      " AND NEW.action = 'Labor inspection finding acknowledged' " +
      "THEN RAISE EXCEPTION 'ci_labor_audit_veto_disposable'; END IF; " +
      "RETURN NEW; END; $ci$";
    await pool.query(vetoSql);
    await pool.query("CREATE TRIGGER ci_labor_inspection_audit_veto " +
      "BEFORE INSERT ON public.audit_events FOR EACH ROW " +
      "EXECUTE FUNCTION public.ci_labor_inspection_audit_veto()");
    vetoActive = true;
    try {
      before = await freeze();
      const blocked = await post(a, { action: "acknowledge" });
      assertPrivateDenial(blocked, 409);
      await unchanged(before, "audit insert veto must roll back remediation and audit");
      counts.auditVetoRollbacks++;
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS ci_labor_inspection_audit_veto ON public.audit_events");
      await pool.query("DROP FUNCTION IF EXISTS public.ci_labor_inspection_audit_veto()");
      vetoActive = false;
    }

    for (const e of all) {
      before = await freeze();
      const response = await post(e, { action: "acknowledge" });
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json?.remediation?.status, "acknowledged");
      const after = await unchanged(before, "acknowledge", [e.label]);
      assert.equal(after[e.label].remediation.length, before[e.label].remediation.length);
      assert.equal(after[e.label].audit.length, before[e.label].audit.length + 1);
      assert.equal(after[e.label].audit.at(-1).action,
        "Labor inspection finding acknowledged");
      counts.ownAcknowledge++;
    }

    // Deny closing a still active finding even with valid MFA and documents.
    for (const e of all) {
      before = await freeze();
      const response = await post(e, { action: "close",
        resolutionNote: "Synthetic pay profile has been checked in QA.",
        evidenceReference: "ci-labor-" + nonce });
      assertPrivateDenial(response, 409);
      await unchanged(before, "cannot close live finding");
    }

    // Only after the actual fictional pay profile is restored can a close
    // succeed. No real payroll calculations, funds, employees or providers.
    for (const e of all) {
      await db.insert(s.employeePayProfiles).values(e.profile);
      const response = await request(ENDPOINT + "?organizationId=" + e.org.id,
        "GET", e.cookie);
      assert.equal(response.status, 200, response.text);
      assert.ok(!response.json.findings.some(row => row.key === e.findingKey),
        "Actual underlying source finding must be cleared");
    }
    for (const e of all) {
      before = await freeze();
      const response = await post(e, { action: "close",
        resolutionNote: "Synthetic pay profile restored and inspected.",
        evidenceReference: "ci-labor-" + nonce });
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json?.remediation?.status, "resolved");
      const after = await unchanged(before, "close", [e.label]);
      assert.equal(after[e.label].remediation.length, before[e.label].remediation.length);
      assert.equal(after[e.label].audit.length, before[e.label].audit.length + 1);
      assert.equal(after[e.label].audit.at(-1).action,
        "Labor inspection finding closed");
      assert.deepEqual(after[e.label].payrollRuns, before[e.label].payrollRuns);
      assert.deepEqual(after[e.label].employees, before[e.label].employees);
      counts.ownClose++;

      const replayBefore = await freeze();
      const replay = await post(e, { action: "close",
        resolutionNote: "Synthetic pay profile restored and inspected.",
        evidenceReference: "ci-labor-" + nonce });
      assert.equal(replay.status, 200, "already-resolved close is idempotent");
      assert.equal(replay.json?.remediation?.id, response.json.remediation.id);
      await unchanged(replayBefore, "idempotent close replay");
    }

    // Membership revoked in the same session must never recover own employer
    // write access, even to an already resolved finding.
    await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, b.owner.id),
        eq(s.userOrganizations.organizationId, b.org.id)));
    before = await freeze();
    const revoked = await post(b);
    assertPrivateDenial(revoked, 403, [victim.marker]);
    await unchanged(before, "revoked active employer grant");
    counts.revokedDenials++;

    console.log(JSON.stringify({
      proof: LABOR_INSPECTION_POST, ...counts, higherIdVictim: true,
      independentAttackers: 2, postgresMajor: 16, realLocalhostHttp: true,
      methodCoverageCredit: false, independentSecurityReview: "PENDING",
      productionTested: false, moneyMoved: false,
    }));
  } finally {
    if (vetoActive) {
      try { await pool.query("DROP TRIGGER IF EXISTS ci_labor_inspection_audit_veto ON public.audit_events"); }
      finally { await pool.query("DROP FUNCTION IF EXISTS public.ci_labor_inspection_audit_veto()"); }
    }
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-labor-inspection-post-http.mjs")) {
  proveLaborInspectionPost().catch(error => {
    console.error("TENANT_LABOR_INSPECTION_POST_PROOF_FAILED: " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
