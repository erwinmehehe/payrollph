/** Supplemental two-attacker root POST proof. Never executes against an existing/deployed database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireCreationRenewalEnvironment, assertCreatedPayroll, assertCreationRefusal,
  assertProcessedPayroll, assertCreationDiscriminates, verifyCreationRenewalResult, CREATION_METHOD, CREATION_RESULT } from "./payroll-run-creation-renewal-contract.mjs";

requireCreationRenewalEnvironment();
const [{ db, pool }, schema, { and, eq }, fixture, { encryptBankAccount }] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"),
  import("./tenant-table-http.mjs"),
  import("../../src/lib/bank-account-crypto.ts"),
]);

try {
  const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version >= 160000 && version < 170000, "fresh disposable PG16 only");
  assert.equal((await db.select().from(schema.users).limit(1)).length, 0, "refuse an existing database");
  const employers = [], nonce = randomUUID().slice(0, 8);
  for (const label of ["ATTA", "ATTB", ...Array.from({ length: 7 }, (_, i) => "FILL" + i), "VICTIM"]) {
    const employer = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
    await db.update(schema.employees).set({ bankCode: "BPI",
      bankAccount: encryptBankAccount("000000" + String(employer.org.id).padStart(6, "0")), mobile: "09999999999",
    }).where(eq(schema.employees.id, employer.worker.id));
    if (!label.startsWith("FILL")) employers.push(employer);
  }
  const [a, b, victim] = employers;
  assert.ok(victim.org.id > 6 && victim.worker.id > 6);
  for (const actor of [a, b]) for (const key of ["org", "entity", "unit", "worker"])
    assert.ok(victim[key].id > actor[key].id, "Genuine target must have a higher " + key + " id");
  const periods = [
    { periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: false },
    { periodStart: "2026-10-16", periodEnd: "2026-10-31", payDate: "2026-10-31", processNow: true },
  ];
  const body = (employer, mode) => ({ organizationId: employer.org.id, legalEntityId: employer.entity.id,
    confirmLegalEntityName: employer.entity.legalName, ...periods[mode] });
  async function request(actor, payload, key = randomUUID(), suffix = "") {
    const response = await fetch("http://127.0.0.1:3000/api/payroll-runs" + suffix, {
      method: "POST", redirect: "manual", cache: "no-store",
      headers: { cookie: actor.cookie, origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
        "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(payload),
    });
    const text = await response.text(); let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, json, text };
  }

  // A genuine populated higher-ID victim has its own successful HTTP draft before snapshotting.
  const victimPositive = await request(victim, body(victim, 0));
  assertCreationDiscriminates(assertCreatedPayroll, victimPositive, body(victim, 0),
    { organizationId: a.org.id, legalEntityId: a.entity.id });
  const victimRun = assertCreatedPayroll(victimPositive, body(victim, 0));
  const columns = (await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('organization_id','payroll_run_id') ORDER BY table_name,column_name")).rows;
  async function snapshotVictim() {
    const out = {};
    for (const { table_name: table, column_name: column } of columns) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/); assert.match(column, /^[a-z_]+$/);
      out[table + ":" + column] = (await pool.query('SELECT to_jsonb(t) AS row FROM "' + table + '" t WHERE "' + column + '"=$1 ORDER BY to_jsonb(t)::text',
        [column === "organization_id" ? victim.org.id : victimRun.id])).rows;
    }
    out.owner = (await pool.query("SELECT to_jsonb(t) AS row FROM users t WHERE id=$1", [victim.owner.id])).rows;
    out.sessions = (await pool.query("SELECT to_jsonb(t) AS row FROM sessions t WHERE user_id=$1 ORDER BY id", [victim.owner.id])).rows;
    return JSON.parse(JSON.stringify(out));
  }
  const before = await snapshotVictim();
  const own201 = [0, 0], foreign403 = [0, 0], forgedEntity422 = [0, 0], forgedUnit400 = [0, 0];
  let processOwn200 = 0, processForeign404 = 0;
  for (const actor of [a, b]) for (const mode of [0, 1]) {
    const payload = body(actor, mode), attempt = randomUUID();
    const own = await request(actor, payload, attempt);
    const run = assertCreatedPayroll(own, payload);
    assert.notEqual(run.id, victimRun.id);
    const [stored] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, run.id));
    assert.equal(stored.organizationId, actor.org.id); assert.equal(stored.legalEntityId, actor.entity.id);
    assert.equal(stored.status, run.status); assert.equal(stored.periodStart, payload.periodStart);
    const entries = await db.select().from(schema.payrollEntries).where(eq(schema.payrollEntries.payrollRunId, run.id));
    if (payload.processNow) {
      assert.equal(entries.length, 1); assert.equal(entries[0].employeeId, actor.worker.id);
      assert.ok(Number(entries[0].grossPay) > 0 && Number(entries[0].netPay) > 0);
    } else assert.equal(entries.length, 0);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.organizationId, actor.org.id));
    assert.equal(audit.filter(event => event.action === "Payroll draft created" && Number(event.metadata?.runId) === run.id).length, 1);
    const replay = await request(actor, payload, attempt);
    assert.equal(replay.status, 200); assert.equal(replay.json.idempotentReplay, true);
    assert.equal(replay.json.run.id, run.id);
    // This must fail if the ownership validator is mutated into a no-op.
    assertCreationDiscriminates(assertCreatedPayroll, own, payload,
      { organizationId: victim.org.id, legalEntityId: victim.entity.id });
    own201[mode]++;

    const forbidden = [victim.marker, victim.worker.employeeNo];
    assertCreationRefusal(await request(actor, body(victim, mode)), 403, forbidden);
    foreign403[mode]++;
    assert.deepEqual(await snapshotVictim(), before, "Foreign creation changed victim SQL/audit");
    assertCreationRefusal(await request(actor, { ...payload, legalEntityId: victim.entity.id }), 422, forbidden);
    forgedEntity422[mode]++;
    assert.deepEqual(await snapshotVictim(), before, "Forged employer reference changed victim SQL/audit");
    assertCreationRefusal(await request(actor, { ...payload, scopeOrgUnitId: victim.unit.id }), 400, forbidden);
    forgedUnit400[mode]++;
    assert.deepEqual(await snapshotVictim(), before, "Forged unit reference changed victim SQL/audit");
    await db.update(schema.userOrganizations).set({ role: "employee" }).where(and(
      eq(schema.userOrganizations.userId, actor.owner.id), eq(schema.userOrganizations.organizationId, actor.org.id)));
    assertCreationRefusal(await request(actor, payload), 403, forbidden);
    await db.update(schema.userOrganizations).set({ role: "owner", active: false }).where(and(
      eq(schema.userOrganizations.userId, actor.owner.id), eq(schema.userOrganizations.organizationId, actor.org.id)));
    assertCreationRefusal(await request(actor, payload), 403, forbidden);
    await db.update(schema.userOrganizations).set({ active: true }).where(and(
      eq(schema.userOrganizations.userId, actor.owner.id), eq(schema.userOrganizations.organizationId, actor.org.id)));
    if (!payload.processNow) {
      // The historical readiness-ON suite deliberately expects 422 here. That
      // refusal is not a positive: renew process POST with a completed real calculation.
      const processed = await request(actor, {}, randomUUID(), "/" + run.id + "/process");
      assertProcessedPayroll(processed, run);
      const [persisted] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, run.id));
      assert.equal(persisted.status, "Needs review");
      const calculated = await db.select().from(schema.payrollEntries).where(eq(schema.payrollEntries.payrollRunId, run.id));
      assert.equal(calculated.length, 1); assert.equal(calculated[0].employeeId, actor.worker.id);
      assert.ok(Number(calculated[0].netPay) > 0); processOwn200++;
      const refused = await request(actor, { organizationId: actor.org.id, payrollRunId: run.id,
        legalEntityId: actor.entity.id }, randomUUID(), "/" + victimRun.id + "/process");
      assertCreationRefusal(refused, 404, forbidden); processForeign404++;
      assert.deepEqual(await snapshotVictim(), before, "Foreign process POST with forged scope changed victim SQL/audit");
    }
  }
  assert.deepEqual(await snapshotVictim(), before);
  const result = { kind: CREATION_RESULT, method: CREATION_METHOD, sourceHead: process.env.PR_HEAD_SHA,
    modes: ["draft", "calculate"], own201, foreign403, forgedEntity422, forgedUnit400,
    processOwn200, processForeign404, processSelectorConfined: true,
    distinctAttackerEmployers: 2, higherIdVictim: true, victimOwnPositive: true,
    victimOrderingScope: "organization/legal-employer/unit/worker; creation has no addressed run id",
    persistedOwnRowsAndAudit: true, victimSqlUnchanged: true, discriminationPassed: true,
    providerCalls: 0, coverageCredits: 0, productionCertified: false, label: "SOLO_VERIFIED_DEV_RECOVERY" };
  verifyCreationRenewalResult(result);
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("qa-artifacts", { recursive: true });
  await writeFile("qa-artifacts/payroll-run-creation-renewal.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await pool.end(); }
