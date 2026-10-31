/**
 * Independent cross-employer POST /api/bir/annual-employer/candidate HTTP
 * on the EXISTING fictional PG16 browser workflow (flag-on localhost HTTPS).
 * Extends, does not replace, the already-merged own-owner BIR acceptance.
 * No BIR filing, accepted evidence, real wages or production data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "playwright";

for (const [key, expected] of [
  ["CI", "true"], ["GITHUB_ACTIONS", "true"],
  ["BIR_SYNTHETIC_BROWSER_QA", "true"],
  ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"],
  ["APP_BASE_URL", "https://127.0.0.1:3443"],
]) assert.equal(process.env[key], expected, "Fictional PG16 only: " + key);
for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY"])
  assert.ok(!process.env[key], "No payment provider keys in BIR QA: " + key);
assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
assert.notEqual(process.env.WORKER_ENABLED, "true");
assert.notEqual(process.env.CENTRAL_SCHEDULER_ENABLED, "true");

// Require that the original reviewed candidate browser already seeded its
// own synthetic employer, preventing this test from inventing a fake own 200.
const original = JSON.parse(readFileSync("/tmp/bir-1604c-qa-fixture.json", "utf8"));
assert.ok(Number.isSafeInteger(original.organizationId) &&
  Number.isSafeInteger(original.legalEntityId));
const [{ db, pool }, schema, orm, http] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const { eq, asc, inArray } = orm;
const { seedEmployer, standaloneMakeSession } = http;
const { encryptGovernmentId } = await import("../../src/lib/government-id-crypto.ts");
const base = "https://127.0.0.1:3443";
const year = 2025;
const plain = value => JSON.parse(JSON.stringify(value));
let assertions = 0;
function check(ok, label) { assert.ok(ok, label); assertions++; }
function expect(response, expected, label) {
  assert.equal(response.status(), expected, label + " HTTP " + response.status());
  assertions++;
  return response;
}
async function snapshot(e) {
  const scoped = table => db.select().from(table)
    .where(eq(table.organizationId, e.org.id)).orderBy(asc(table.id));
  const [workers, runs, yearEnd, remittances, audit] = await Promise.all([
    scoped(schema.employees), scoped(schema.payrollRuns),
    scoped(schema.yearEndAdjustments),
    scoped(schema.birWithholdingRemittanceBatches), scoped(schema.auditEvents),
  ]);
  const entries = runs.length ? await db.select().from(schema.payrollEntries)
    .where(inArray(schema.payrollEntries.payrollRunId, runs.map(r => r.id)))
    .orderBy(asc(schema.payrollEntries.id)) : [];
  return plain({ workers, runs, entries, yearEnd, remittances, audit });
}
const contexts = [];
try {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const employers = [];
  // Seed adversaries before the victim: all victim record IDs genuinely higher.
  for (const name of ["ATTA", "ATTB", "VICTIM"])
    employers.push(await seedEmployer(name, nonce, standaloneMakeSession));
  const [a, b, victim] = employers;
  check(victim.org.id > b.org.id && victim.worker.id > b.worker.id &&
    victim.entity.id > b.entity.id,
    "Real populated victim has higher org, legal-employer and employee IDs");
  for (const e of employers) {
    await db.update(schema.legalEntities).set({
      birTin: "123456789", birBranchCode: "0000",
    }).where(eq(schema.legalEntities.id, e.entity.id));
    await db.update(schema.employees).set({
      nationality: "Filipino",
      tin: encryptGovernmentId("333222111", { required: true }),
      tinBranchCode: encryptGovernmentId("0000", { required: true }),
    }).where(eq(schema.employees.id, e.worker.id));
    const [run] = await db.insert(schema.payrollRuns).values({
      organizationId: e.org.id, legalEntityId: e.entity.id,
      periodLabel: e.marker + " Synthetic Dec 2025",
      periodStart: "2025-12-01", periodEnd: "2025-12-31",
      payDate: "2025-12-31", status: "Released", employeeCount: 1,
      grossPay: "600000.00", netPay: "557500.00",
    }).returning();
    await db.insert(schema.payrollEntries).values({
      payrollRunId: run.id, employeeId: e.worker.id,
      grossPay: "600000.00", deductions: "42500.00", netPay: "557500.00",
      lineItems: [{ code: "WHT", amount: "-42500.00" }],
      status: "Ready",
    });
    await db.insert(schema.yearEndAdjustments).values({
      organizationId: e.org.id, employeeId: e.worker.id, taxYear: year,
      grossCompensation: "600000.00", thirteenthMonth: "50000.00",
      nonTaxable: "100000.00", taxableIncome: "500000.00",
      taxDue: "42500.00", taxWithheld: "42500.00", adjustment: "0.00",
      mwe: false, status: "settled",
    });
    await db.insert(schema.birWithholdingRemittanceBatches).values({
      organizationId: e.org.id, legalEntityId: e.entity.id,
      applicableMonth: "2025-12", filingChannel: "ebirforms",
      filingDueDate: "2026-01-10", paymentDueDate: "2026-01-10",
      status: "reconciled", employeeCount: 1, payrollRunCount: 1,
      expectedTaxWithheld: "42500.00", amountPaid: "42500.00",
      snapshotHash: "a".repeat(64), createdBy: "Fictional tenant only",
    });
    const context = await request.newContext({
      baseURL: base, ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        cookie: e.cookie, origin: base, "sec-fetch-site": "same-origin",
      },
    });
    contexts.push(context);
    e.context = context;
  }
  const scope = e => ({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    taxYear: year, mode: "template", records: [],
  });
  const digests = new Map();
  let owned = 0, denied = 0;
  for (const e of employers) {
    const get = expect(await e.context.get(
      "/api/bir/annual-employer?organizationId=" + e.org.id +
      "&legalEntityId=" + e.entity.id + "&taxYear=" + year), 200,
      "Owned employer reconciliation GET for real source digest");
    const report = await get.json();
    const digest = report.reconciliation?.sourceDigest;
    check(typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest),
      "Real DB-derived annual employer digest required");
    check(report.reconciliation?.totals?.employees === 1 &&
      report.reconciliation?.totals?.blockers === 0,
      "Owned record must have complete fictional Released and annualized data");
    digests.set(e.org.id, digest);
    const candidate = expect(await e.context.post(
      "/api/bir/annual-employer/candidate", {
        data: { ...scope(e), sourceDigest: digest },
      }), 200, "Owned reviewer gets a real reviewed-source template");
    const result = await candidate.json();
    check(result.records?.length === 1 &&
      result.records[0]?.employeeNo === e.worker.employeeNo,
      "Own template must contain ONLY source-bound owned employee");
    check(result.sourceDigest === digest, "Response must preserve real digest");
    owned++;
  }
  const before = new Map();
  for (const e of employers) before.set(e.org.id, await snapshot(e));

  for (const attacker of [a, b]) {
    const ownDigest = digests.get(attacker.org.id);
    const victimDigest = digests.get(victim.org.id);
    const foreignOrg = expect(await attacker.context.post(
      "/api/bir/annual-employer/candidate", {
        data: { ...scope(victim), sourceDigest: victimDigest },
      }), 403, "Authenticated foreign employer denied before candidate source");
    const forgedEntity = expect(await attacker.context.post(
      "/api/bir/annual-employer/candidate", {
        data: { ...scope(attacker), legalEntityId: victim.entity.id, sourceDigest: ownDigest },
      }), 404, "Own org with real foreign legal-entity ID cannot read candidate");
    for (const response of [foreignOrg, forgedEntity]) {
      const body = await response.text();
      check(!body.includes(victim.marker) && !body.includes(victim.worker.employeeNo),
        "Victim worker and employer marker must not leak in denial");
      check(!body.includes("333222111"), "Foreign BIR TIN must never be returned");
    }
    denied += 2;
  }
  for (const e of employers) {
    assert.deepEqual(await snapshot(e), before.get(e.org.id),
      "Denied foreign requests must not change victim/attacker source, audit or filings");
    assertions++;
  }
  check(owned === 3 && denied === 4, "Three own templates and four foreign denials mandatory");
  console.log(JSON.stringify({
    kind: "bir1604c-candidate-POST-actual-HTTPS-PG16-cross-employer",
    realOwnTemplates: owned, realForeignDenials: denied,
    twoIndependentAttackers: true, higherIdVictim: true,
    unchangedAnnualAndAuditSourcesAfterDenials: true,
    actualProductionFiling: false, acceptedByBIR: false,
    externalMoneyOrAgencyCalls: 0, credits: 0,
    independentSecurityAndTaxReview: "PENDING", assertions,
  }));
} finally {
  for (const context of contexts) await context.dispose().catch(() => {});
  await pool.end();
}
