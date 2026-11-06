import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireExportProof, proveEmployeeExport } from "./tenant-company-export-contract.mjs";
requireExportProof();
const [{ db, pool }, s, { eq, and }, fixture] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const multi = process.env.MULTI_ENTITY_ENABLED === "true";
async function request(f, query, headers = {}) {
  requireExportProof();
  const r = await fetch("http://127.0.0.1:3000/api/exports?" + query, {
    headers: { Cookie: f.cookie, ...headers }, redirect: "manual", signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, text: await r.text(), type: r.headers.get("content-type") ?? "",
    cache: r.headers.get("cache-control") ?? "", nosniff: r.headers.get("x-content-type-options") };
}
async function snapshot(orgId) {
  const tables = [s.organizations, s.employees, s.payrollRuns, s.auditEvents, s.userOrganizations, s.userLegalEntityGrants];
  const result = [];
  for (const t of tables) {
    const column = t === s.organizations ? t.id : t.organizationId;
    const rows = await db.select().from(t).where(eq(column, orgId));
    result.push(rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  return result;
}
async function prepare(label, nonce) {
  const f = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
  const [otherEntity] = await db.insert(s.legalEntities).values({ organizationId: f.org.id, code: f.marker + "-E2",
    legalName: f.marker + " second employer", displayName: f.marker + " second", primaryEntity: false }).returning();
  const [otherUnit] = await db.insert(s.orgUnits).values({ organizationId: f.org.id, legalEntityId: otherEntity.id,
    type: "department", code: f.marker + "-U2", name: f.marker + " second unit" }).returning();
  const [otherWorker] = await db.insert(s.employees).values({ ...f.worker, id: undefined,
    employeeNo: f.marker + "-OTHER", lastName: f.marker + "-OTHER", legalEntityId: otherEntity.id, orgUnitId: otherUnit.id }).returning();
  await db.insert(s.userLegalEntityGrants).values({ organizationId: f.org.id, userId: f.owner.id, legalEntityId: f.entity.id });
  for (const [entity, suffix] of [[f.entity, "PRIMARY"], [otherEntity, "SECONDARY"]]) {
    await db.insert(s.payrollRuns).values({ organizationId: f.org.id, legalEntityId: entity.id,
      periodLabel: f.marker + "-" + suffix, periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-20",
      employeeCount: 1, grossPay: "1000", netPay: "900" });
  }
  return { ...f, otherEntity, otherWorker };
}
async function verify() {
  assert.equal((await db.select().from(s.organizations).limit(1)).length, 0, "fresh disposable employers required");
  assert.equal((await request({ cookie: "" }, "organizationId=1&kind=employees")).status, 401);
  assert.equal((await db.select().from(s.organizations).limit(1)).length, 0, "anonymous GET must not seed tenant 1");
  const nonce = randomUUID().slice(0, 8);
  const a = await prepare("ATTA", nonce), b = await prepare("ATTB", nonce);
  for (let i = 0; i < 5; i++) await db.insert(s.organizations).values({ name: "Fictional padding " + i });
  const v = await prepare("VICTIM", nonce);
  assert.ok(v.org.id > b.org.id && v.org.id > 6);
  const query = f => "organizationId=" + f.org.id;
  proveEmployeeExport(await request(v, query(v) + "&kind=employees"), v.worker.employeeNo, a.worker.employeeNo);
  const victimBefore = await snapshot(v.org.id);
  for (const f of [a, b]) {
    const membership = and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id));
    const base = query(f);
    const own = await request(f, base + "&kind=employees");
    proveEmployeeExport(own, f.worker.employeeNo, v.worker.employeeNo);
    assert.throws(() => proveEmployeeExport(own, f.worker.employeeNo, f.worker.employeeNo), /accepts another employer's data/);
    assert.equal(own.text.includes(f.otherWorker.employeeNo), !multi, "legal employer ON/OFF selection");
    const payroll = await request(f, base + "&kind=payroll");
    assert.equal(payroll.status, 200); assert.ok(payroll.text.includes(f.marker + "-PRIMARY"));
    assert.equal(payroll.text.includes(f.marker + "-SECONDARY"), !multi);
    for (const kind of ["audit", "all"]) {
      const r = await request(f, base + "&kind=" + kind);
      assert.equal(r.status, multi ? 403 : 200, r.text);
      assert.ok(!r.text.includes(v.marker));
    }
    const ownBeforeDenials = await snapshot(f.org.id);
    for (const selector of ["", "organizationId=0", "organizationId=01", "organizationId=1e2",
      base + "&" + base, base + "&organizationId=" + v.org.id,
      "organizationId=" + v.org.id + "&" + base]) {
      const r = await request(f, selector + "&kind=employees");
      assert.equal(r.status, 400); assert.ok(!r.text.includes(v.marker)); assert.match(r.cache, /no-store/);
    }
    assert.equal((await request(f, base + "&kind=invalid")).status, 400);
    for (const kind of ["employees", "payroll", "audit", "all"]) {
      const foreign = await request(f, query(v) + "&kind=" + kind);
      const missing = await request(f, "organizationId=2147483647&kind=" + kind);
      assert.equal(foreign.status, 403); assert.equal(missing.status, 403);
      assert.equal(foreign.text, missing.text); assert.ok(!foreign.text.includes(v.marker));
      assert.match(foreign.cache, /no-store/);
    }
    assert.deepEqual(await snapshot(f.org.id), ownBeforeDenials, "denials must not record export audit or seed writes");
    await db.update(s.userOrganizations).set({ active: false }).where(membership);
    const revokedBefore = await snapshot(f.org.id);
    for (const kind of ["employees", "payroll", "audit", "all"])
      assert.equal((await request(f, base + "&kind=" + kind)).status, 403);
    assert.deepEqual(await snapshot(f.org.id), revokedBefore);
    await db.update(s.userOrganizations).set({ active: true, role: "admin", orgUnitId: f.unit.id }).where(membership);
    const scoped = await request(f, base + "&kind=employees");
    proveEmployeeExport(scoped, f.worker.employeeNo, f.otherWorker.employeeNo);
    const scopedBefore = await snapshot(f.org.id);
    for (const kind of ["payroll", "audit", "all"])
      assert.equal((await request(f, base + "&kind=" + kind)).status, 403);
    assert.deepEqual(await snapshot(f.org.id), scopedBefore);
    await db.update(s.userOrganizations).set({ role: "owner", orgUnitId: null }).where(membership);
    if (!multi) {
      await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.userId, f.owner.id));
      const before = await snapshot(f.org.id);
      for (const kind of ["audit", "all"]) {
        const denied = await request(f, base + "&kind=" + kind);
        assert.equal(denied.status, 403); assert.ok(denied.text.includes("MFA_REQUIRED"));
      }
      assert.deepEqual(await snapshot(f.org.id), before);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.userId, f.owner.id));
    }
    if (multi) {
      const before = await snapshot(f.org.id);
      for (const id of [f.otherEntity.id, v.entity.id, 2147483647])
        assert.equal((await request(f, base + "&kind=employees&legalEntityId=" + id)).status, 403);
      assert.equal((await request(f, base + "&kind=employees&legalEntityId=" + f.entity.id,
        { "x-legal-entity-id": String(f.otherEntity.id) })).status, 403);
      assert.deepEqual(await snapshot(f.org.id), before);
    } else {
      const ignored = await request(f, base + "&kind=employees&legalEntityId=" + v.entity.id,
        { "x-legal-entity-id": String(v.entity.id) });
      proveEmployeeExport(ignored, f.worker.employeeNo, v.worker.employeeNo);
      assert.ok(ignored.text.includes(f.otherWorker.employeeNo), "feature OFF keeps tenant roster; selectors cannot switch employer");
    }
    assert.deepEqual(await snapshot(v.org.id), victimBefore, "victim employee/payroll/membership/audit SQL changed");
  }
  console.log(JSON.stringify({ kind: "COMPANY_EXPORT_HTTP", result: "PASS", multiEntity: multi,
    attackers: 2, highVictimOrganizationId: v.org.id, newCoverageCredits: 0, productionCertified: false }));
}
try { await verify(); } finally { await pool.end(); }
