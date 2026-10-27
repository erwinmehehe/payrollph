/** Isolated, provisional GET year-end JSON proof: fictional PG16 and real localhost HTTP. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const env = process.env;
function guard() {
  let app, db;
  try { app = new URL(env.SECURITY_SMOKE_URL); db = new URL(env.DATABASE_URL); }
  catch { throw Error("YEAR_END_PROOF_REFUSED: localhost targets required"); }
  assert.ok(env.CI === "true" && env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.NODE_ENV === "production" && env.WORKER_ENABLED === "false" &&
    app.href === "http://127.0.0.1:3000/" &&
    db.protocol === "postgresql:" && db.hostname === "127.0.0.1" &&
    db.port === "5432" && db.pathname === "/app_db" &&
    db.username === "postgres" && db.password === "postgres" &&
    !db.search && !db.hash &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    !env.PAYMONGO_SECRET_KEY && !env.XENDIT_SECRET_KEY &&
    !env.RESEND_API_KEY && env.MULTI_ENTITY_ENABLED !== "true",
    "YEAR_END_PROOF_REFUSED: disposable localhost PG16, inactive payouts and single employer only");
}
guard(); // Must execute before dynamic DB/application imports.
const [{ db, pool }, s, table, { eq, asc }, { auditBusinessSnapshot }] = await Promise.all([
  import("../../../src/db/index.ts"), import("../../../src/db/schema.ts"),
  import("../tenant-table-http.mjs"), import("drizzle-orm"),
  import("../tenant-table-invariants.mjs"),
]);
async function snapshot(orgId) {
  const byOrg = t => db.select().from(t).where(eq(t.organizationId, orgId)).orderBy(asc(t.id));
  const [employees, adjustments, payroll, audit] = await Promise.all([
    byOrg(s.employees), byOrg(s.yearEndAdjustments), byOrg(s.payrollRuns), byOrg(s.auditEvents),
  ]);
  return { employees, adjustments, payroll, audit: auditBusinessSnapshot(audit) };
}
const path = e => "/api/year-end?organizationId=" + e.org.id + "&taxYear=2026&format=json";
const request = (actor, target) => table.standaloneRequest(path(target), { cookie: actor.cookie });
function proveOwn(reply, e) {
  assert.equal(reply.status, 200, "populated own read must succeed: " + reply.text.slice(0,180));
  assert.equal(reply.json?.taxYear, 2026);
  assert.equal(reply.json?.count, 1, "empty list is NOT an owned positive");
  assert.equal(reply.json?.rows?.length, 1);
  assert.equal(reply.json.rows[0].employeeId, e.worker.id);
  assert.equal(reply.json.rows[0].employeeNo, e.marker);
  assert.equal(reply.json.rows[0].name, "Table " + e.marker);
  assert.equal(reply.json.rows[0].adjustment, e.adjustment);
  assert.equal(reply.json.rows[0].outcome, "refund");
  assert.equal(reply.json.totalRefund, e.refund);
  assert.equal(reply.json.totalCollect, 0);
}
try {
  assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
    "YEAR_END_PROOF_REFUSED: fresh empty fictional DB required");
  const nonce = randomUUID().replaceAll("-", "").slice(0,10), employers = [];
  for(const label of ["ATTA","ATTB","VICTIM"]) {
    const e = await table.seedEmployer(label, nonce, table.standaloneMakeSession);
    const refund = label === "ATTA" ? 17 : label === "ATTB" ? 29 : 43;
    e.adjustment = "-" + refund.toFixed(2); e.refund = refund;
    const [row] = await db.insert(s.yearEndAdjustments).values({
      organizationId: e.org.id, employeeId: e.worker.id, taxYear: 2026,
      grossCompensation: "250000.00", taxableIncome: "210000.00",
      taxDue: "8000.00", taxWithheld: "8000.00",
      adjustment: e.adjustment, outcome: "refund", status: "computed",
    }).returning();
    e.adjustmentId = row.id;
    employers.push(e);
  }
  const [a,b,victim] = employers;
  for(const attacker of [a,b]) {
    assert.ok(victim.org.id > attacker.org.id &&
      victim.worker.id > attacker.worker.id &&
      victim.adjustmentId > attacker.adjustmentId,
      "victim must have actually persisted higher IDs");
  }
  const before = await Promise.all(employers.map(e=>snapshot(e.org.id)));
  proveOwn(await request(victim,victim),victim);
  let firstOwn;
  for(const attacker of [a,b]) {
    const own=await request(attacker,attacker);
    proveOwn(own,attacker);
    assert.ok(!own.text.includes(victim.marker),"own result cannot include victim marker");
    if(firstOwn) assert.throws(()=>proveOwn(firstOwn,attacker),"proof cannot accept different employer's real data");
    firstOwn=own;
    const foreign=await request(attacker,victim);
    assert.equal(foreign.status,403,"foreign employer annualization must be denied");
    assert.ok(!foreign.text.includes(victim.marker),"foreign denial must not leak victim marker");
    const after=await Promise.all(employers.map(e=>snapshot(e.org.id)));
    assert.deepEqual(after,before,"GET and denials cannot mutate any payroll, tax or audit rows");
  }
  const after=await Promise.all(employers.map(e=>snapshot(e.org.id)));
  assert.deepEqual(after,before);
  console.log(JSON.stringify({ method:"GET year-end",scope:"JSON only",twoAttackers:true,
    victimHigherIds:true,populatedOwnRows:3,realForeignDenials:2,
    allTenantRowsAndAuditUnchanged:true,realHttpPg16:true,
    methodFullyCovered:false,coverageCredits:0,productionCertified:false }));
} finally { await pool.end(); }
