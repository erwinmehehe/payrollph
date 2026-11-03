/**
 * Independent cross-employer POST /api/bir/annual-employer/candidate HTTP
 * on the EXISTING fictional PG16 browser workflow (flag-on localhost HTTPS).
 * Extends, does not replace, the already-merged own-owner BIR acceptance.
 * No BIR filing, accepted evidence, real wages or production data.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
  // Use only real, disposable SQL source IDs for the strict victim > 6 rule.
  // These six fictional employer/worker fixtures have no annual tax/payroll data
  // and are never addressed by any authenticated request in this proof.
  for (let pad = 0; pad < 6; pad++) {
    await seedEmployer("PAD" + pad, nonce, standaloneMakeSession);
  }
  // Seed adversaries before the victim: all victim record IDs genuinely higher.
  for (const name of ["ATTA", "ATTB", "VICTIM"])
    employers.push(await seedEmployer(name, nonce, standaloneMakeSession));
  const [a, b, victim] = employers;
  check(victim.org.id > 6 && victim.worker.id > 6 && victim.entity.id > 6 &&
    victim.org.id > a.org.id && victim.org.id > b.org.id &&
    victim.worker.id > a.worker.id && victim.worker.id > b.worker.id &&
    victim.entity.id > a.entity.id && victim.entity.id > b.entity.id,
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
  const reviewed = new Map();
  let owned = 0, ownedChecks = 0, ownedDownloads = 0, denied = 0;
  // Mirror the established, entirely fictional 2025 browser acceptance input.
  // No test default below is suitable for a human filing or live Form 2316.
  function fictionalReviewedRecord(template) {
    const row = plain(template.records[0]);
    const overrides = {
      REGION_NUM: "NCR", EMPLOYMENT_FROM: "01/01/2025",
      EMPLOYMENT_TO: "12/31/2025", EMPLOYMENT_STATUS: "R",
      REASON_SEPARATION: "NA", SUBS_FILING: "Y",
      PRES_NONTAX_GROSS_COMP_INCOME: "100000.00",
      PRES_NONTAX_13TH_MONTH: "50000.00",
      PRES_TOTAL_NONTAX_COMP_INCOME: "100000.00",
      TAX_BASIC_SAL: "500000.00", PRES_TOTAL_COMP: "600000.00",
      GROSS_COMP_INCOME: "600000.00", PRES_TAX_WTHLD: "42500.00",
    };
    for (const [field, value] of Object.entries(row.fields)) {
      if (value === null) row.fields[field] = overrides[field] ?? "0.00";
    }
    row.reviewedBy = "Synthetic PG16 QA reviewer, never BIR-filed";
    row.sourceReference = "fictional-reviewed-ledger-" + nonce;
    row.priorEmployerReview = "none-confirmed";
    delete row.missingManualFields;
    return row;
  }
  const bodyFor = (e, mode, chosen = e) => ({
    ...scope(chosen), mode, sourceDigest: digests.get(chosen.org.id),
    records: mode === "template" ? [] : [reviewed.get(chosen.org.id)],
  });
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
    reviewed.set(e.org.id, fictionalReviewedRecord(result));
    owned++;

    // Unlike the historical template-only proof, exercise BOTH sensitive
    // successful candidate modes using the stored own-employer review source.
    const beforeCheck = await snapshot(e);
    const checked = expect(await e.context.post(
      "/api/bir/annual-employer/candidate", {
        data: bodyFor(e, "check"),
      }), 200, "Real own reviewed-source candidate check");
    const checkResult = await checked.json();
    check(checkResult.status === "DRAFT-UNVALIDATED" &&
      checkResult.validatedAgainstModuleV70 === "not run" &&
      checkResult.sourceDigest === digest &&
      /^[a-f0-9]{64}$/.test(checkResult.fileSha256) &&
      checkResult.recordCount === 1, "Own check is source-derived, not official BIR validation");
    check((checked.headers()["cache-control"] ?? "").includes("no-store"),
      "Private check result must not be cached");
    assert.deepEqual(await snapshot(e), beforeCheck,
      "A candidate check is purely read-only on the genuine own employer");
    ownedChecks++;

    const downloaded = expect(await e.context.post(
      "/api/bir/annual-employer/candidate", {
        data: bodyFor(e, "download"),
      }), 200, "Real own reviewed-source draft DAT download");
    const candidateBytes = await downloaded.body();
    const actualSha = createHash("sha256").update(candidateBytes).digest("hex");
    check(candidateBytes.toString("ascii").startsWith("H1604C,") &&
      candidateBytes.toString("ascii").includes("D1,") &&
      candidateBytes.toString("ascii").includes("C1,") &&
      candidateBytes.toString("ascii").endsWith("\r\n"),
      "Own draft DAT must contain real, nonempty fictional source-bound bytes");
    check(actualSha === checkResult.fileSha256 &&
      actualSha === downloaded.headers()["x-bir-file-sha256"] &&
      downloaded.headers()["x-bir-source-digest"] === digest &&
      downloaded.headers()["x-bir-module-v7-0"] === "not-run" &&
      (downloaded.headers()["cache-control"] ?? "").includes("no-store"),
      "Own download bytes, hash, source and unvalidated status must agree");
    const afterDownload = await snapshot(e);
    check(afterDownload.audit.length === beforeCheck.audit.length + 1 &&
      afterDownload.audit.at(-1)?.action === "bir1604c.candidate.downloaded" &&
      afterDownload.audit.at(-1)?.organizationId === e.org.id,
      "Draft DAT can add only its own source-provenance audit receipt");
    assert.deepEqual({ ...afterDownload, audit: beforeCheck.audit }, beforeCheck,
      "Draft DAT must not mutate own payroll, annual tax, employees or remittance");
    ownedDownloads++;
  }
  const before = new Map();
  for (const e of employers) before.set(e.org.id, await snapshot(e));

  // Every accepted action gets its own real attacker/victim and forged-entity
  // denial. Check/download additionally reject the genuine foreign employee
  // even when the attacker supplies its own organization and legal employer.
  for (const attacker of [a, b]) {
    for (const mode of ["template", "check", "download"]) {
      const foreignOrg = expect(await attacker.context.post(
        "/api/bir/annual-employer/candidate", {
          data: bodyFor(attacker, mode, victim),
        }), 403, "Authenticated foreign employer cannot " + mode + " victim source");
      const forgedEntity = expect(await attacker.context.post(
        "/api/bir/annual-employer/candidate", {
          data: { ...bodyFor(attacker, mode), legalEntityId: victim.entity.id },
        }), 404, "Real victim legal-employer selector rejected for " + mode);
      for (const response of [foreignOrg, forgedEntity]) {
        const responseText = await response.text();
        check(!responseText.includes(victim.marker) &&
          !responseText.includes(victim.worker.employeeNo),
          "Victim worker and employer marker must not leak on denied " + mode);
        check(!responseText.includes("333222111"),
          "Foreign BIR TIN must never appear in a denied " + mode);
      }
      denied += 2;
      if (mode !== "template") {
        const foreignReviewedRow = {
          ...plain(reviewed.get(attacker.org.id)),
          employeeNo: victim.worker.employeeNo,
        };
        const forgedEmployee = expect(await attacker.context.post(
          "/api/bir/annual-employer/candidate", {
            data: { ...bodyFor(attacker, mode), records: [foreignReviewedRow] },
          }), 422, "Foreign worker ID cannot pass an own " + mode + " review");
        check((await forgedEmployee.json()).code === "BIR_REVIEW_BLOCKED",
          "Foreign employee reference must fail protected identity source binding");
        denied++;
      }
      // Assert no read/denial/mis-scoped request can mutate victim PG records.
      assert.deepEqual(await snapshot(victim), before.get(victim.org.id),
        "Real victim source, annual rows and audit immutable after denied " + mode);
      assert.deepEqual(await snapshot(attacker), before.get(attacker.org.id),
        "Rejected selector cannot mutate attacker source or its own audit");
      assertions += 2;
    }
  }
  for (const e of employers) {
    assert.deepEqual(await snapshot(e), before.get(e.org.id),
      "Denied foreign requests must not change victim/attacker source, audit or filings");
    assertions++;
  }
  check(owned === 3 && ownedChecks === 3 && ownedDownloads === 3 &&
    denied === 16, "Two independently authenticated attackers and victim must pass all three own modes, with sixteen denials");
  console.log(JSON.stringify({
    kind: "bir1604c-candidate-POST-actual-HTTPS-PG16-cross-employer",
    realOwnTemplates: owned, realOwnChecks: ownedChecks,
    realOwnDraftDownloads: ownedDownloads, realForeignDenials: denied,
    twoIndependentAttackers: true, higherIdVictim: true,
    persistedVictimIdAboveSix: victim.org.id > 6 && victim.entity.id > 6 &&
      victim.worker.id > 6, allThreeModesExercised: true,
    unchangedAnnualAndAuditSourcesAfterDenials: true,
    actualProductionFiling: false, acceptedByBIR: false,
    externalMoneyOrAgencyCalls: 0, credits: 0,
    independentSecurityAndTaxReview: "PENDING", assertions,
  }));
} finally {
  for (const context of contexts) await context.dispose().catch(() => {});
  await pool.end();
}
