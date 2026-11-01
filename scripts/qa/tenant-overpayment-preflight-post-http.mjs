/** Fictional-only PG16 actual HTTP preflight proof. Zero money and method credit. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
for (const [key, val] of [
  ["CI", "true"], ["GITHUB_ACTIONS", "true"],
  ["TENANT_SECOND_PASS_MODE", "isolated-ci-only"],
  ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"],
  ["SECURITY_SMOKE_URL", "http://127.0.0.1:3000"],
  ["PAYROLL_OVERPAYMENT_REVIEW_ENABLED", "true"],
  ["PAYMONGO_DISBURSEMENTS_ENABLED", "false"], ["XENDIT_PAYOUTS_ENABLED", "false"],
  ["WORKER_ENABLED", "false"], ["CENTRAL_SCHEDULER_ENABLED", "false"],
]) assert.equal(process.env[key], val, "Disposable-only guard: " + key);
assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
const [{ db, pool }, schema, orm, shared] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const { eq, asc, inArray } = orm;
const { seedEmployer, standaloneMakeSession, standaloneRequest,
  requireTenantTableDisposable } = shared;
requireTenantTableDisposable();
const route = "/api/payroll/overpayment-preflight";
const plain = value => JSON.parse(JSON.stringify(value));
let assertions = 0;
function check(value, label) { assert.ok(value, label); assertions++; }
function expect(r, status, label) {
  assert.equal(r.status, status, label + " HTTP " + r.status + " " + r.text.slice(0, 200));
  assertions++;
  return r;
}
const body = e => ({
  organizationId: e.org.id, employeeId: e.worker.id, sourcePayrollRunId: e.run.id,
  claimedAmount: "120.00", evidenceReference: "FICT-PREFLIGHT-" + e.marker,
  explanation: "Synthetic disputed payroll review; no verified claim or permitted deduction.",
});
async function snapshot(e) {
  const scoped = t => db.select().from(t).where(eq(t.organizationId, e.org.id)).orderBy(asc(t.id));
  const [workers, runs, loans, separations, retro, audits] = await Promise.all([
    scoped(schema.employees), scoped(schema.payrollRuns), scoped(schema.employeeLoans),
    scoped(schema.separationRecords), scoped(schema.employeePayRetroAdjustments),
    scoped(schema.auditEvents),
  ]);
  const entries = runs.length ? await db.select().from(schema.payrollEntries)
    .where(inArray(schema.payrollEntries.payrollRunId, runs.map(r => r.id)))
    .orderBy(asc(schema.payrollEntries.id)) : [];
  return plain({ workers, runs, entries, loans, separations, retro, audits });
}
try {
  check((await db.select().from(schema.organizations).limit(1)).length === 0,
    "Refuse nonempty PG16 employer database");
  check((await db.select().from(schema.auditEvents).limit(1)).length === 0,
    "Refuse preexisting audit events");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const employers = [];
  for (const label of ["ATTA", "ATTB", "VICTIM"])
    employers.push(await seedEmployer(label, nonce, standaloneMakeSession));
  const [a, b, victim] = employers;
  check(victim.org.id > a.org.id && victim.org.id > b.org.id &&
    victim.worker.id > b.worker.id, "Victim must be real higher-ID employer/worker");
  for (const e of employers) {
    const [run] = await db.insert(schema.payrollRuns).values({
      organizationId: e.org.id, legalEntityId: e.entity.id, scopeOrgUnitId: e.unit.id,
      periodLabel: e.marker + " fictional Released register",
      periodStart: "2026-01-01", periodEnd: "2026-01-15",
      payDate: "2026-01-16", status: "Released",
      grossPay: "20000.00", netPay: "18000.00", employeeCount: 1,
    }).returning();
    const [entry] = await db.insert(schema.payrollEntries).values({
      payrollRunId: run.id, employeeId: e.worker.id,
      grossPay: "20000.00", deductions: "2000.00", netPay: "18000.00",
      status: "Ready", lineItems: [{ code: "FICT-BASIC", amount: "20000.00" }],
      trace: { fictionalSource: e.marker },
    }).returning();
    e.run = run;
    e.entry = entry;
  }
  check(victim.run.id > b.run.id, "Real victim Released run must be higher ID");
  const before = new Map();
  for (const e of employers) before.set(e.org.id, await snapshot(e));
  const post = (actor, requestBody) => standaloneRequest(route,
    { method: "POST", cookie: actor.cookie, body: requestBody });
  let positive = 0, denied = 0;
  for (const e of employers) {
    const result = expect(await post(e, body(e)), 200, "Own full preflight source");
    check(result.json?.previewOnly === true && result.json?.persisted === false,
      "Preflight must be read-only");
    check(result.json?.employee?.id === e.worker.id &&
      result.json?.source?.payrollRunId === e.run.id &&
      result.json?.source?.payrollEntryId === e.entry.id,
      "Own success must contain an actual owned worker/run/entry triple");
    check(result.json?.source?.netPay === "18000.00", "Non-empty fictional source");
    positive++;
  }
  for (const attacker of [a, b]) {
    const foreignOrg = expect(await post(attacker, body(victim)), 403,
      "Forged foreign employer denied");
    check(!foreignOrg.text.includes(victim.marker), "Foreign denial must not leak victim");
    const own = body(attacker);
    const worker = expect(await post(attacker, { ...own, employeeId: victim.worker.id }),
      404, "Genuine foreign worker denied");
    const run = expect(await post(attacker, { ...own, sourcePayrollRunId: victim.run.id }),
      404, "Genuine foreign run denied");
    expect(await post(attacker, {
      ...own, employeeId: victim.worker.id, sourcePayrollRunId: victim.run.id,
    }), 404, "Mixed cross-employer source denied");
    for (const result of [worker, run]) {
      check(result.json?.code === "OVERPAYMENT_SOURCE_NOT_FOUND",
        "Missing source must return a fixed code");
      check(!result.text.includes(victim.marker), "Foreign evidence cannot leak");
    }
    denied += 4;
  }
  for (const e of employers) {
    assert.deepEqual(await snapshot(e), before.get(e.org.id),
      "Preflight may not mutate any employer payroll, loans, worker, or audit rows");
    assertions++;
  }
  check(positive === 3 && denied === 8, "Prove every expected own/foreign request");
  console.log(JSON.stringify({
    kind: "payroll-overpayment-preflight-POST-tenant-PG16",
    positiveOwned: positive, deniedForeign: denied,
    twoIndependentAttackers: true, genuineHigherIdVictim: true,
    unchangedMoneyAndAuditSources: true, externalMoneyCalls: 0,
    methodCredits: 0, independentSecurityReview: "PENDING", assertions,
  }));
} finally { await pool.end(); }
