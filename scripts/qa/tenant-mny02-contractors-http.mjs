/**
 * MNY-02 partial contractor/EWT tenant-isolation proof (six methods).
 * ONLY invoked from the existing disposable PG16, localhost, production-mode
 * second-pass runner. No external provider, remittance, or money movement.
 * Never claim whole MNY-02 (33 methods) or global isolation acceptance.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, contractorPayments, contractors, payrollRuns } from "../../src/db/schema";

export const MNY02_CONTRACTOR_METHODS = Object.freeze([
  "GET contractors", "POST contractors", "PATCH contractors", "DELETE contractors",
  "GET contractors/payments", "POST contractors/payments",
]);

const PERIOD = "2026-09";
const PAYMENT_DATE = "2026-09-15";

function assertIsolated() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).href, "http://127.0.0.1:3000/");
  const pg = new URL(process.env.DATABASE_URL);
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.ok(!process.env[key], "No live payment provider credentials allowed in tenant proof");
  }
}

async function victimSnapshot(id) {
  return {
    contractors: await db.select().from(contractors).where(eq(contractors.organizationId, id)).orderBy(contractors.id),
    payments: await db.select().from(contractorPayments).where(eq(contractorPayments.organizationId, id)).orderBy(contractorPayments.id),
    audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, id)).orderBy(auditEvents.id),
    payroll: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, id)).orderBy(payrollRuns.id),
  };
}

function noVictimResponse(response, name) {
  const headers = [...response.headers].map(([key, value]) => key + ": " + value).join("\n");
  assert.ok(!response.text.includes(name), "Foreign contractor identity appeared in response body");
  assert.ok(!headers.includes(name), "Foreign contractor identity appeared in headers");
  assert.ok(!response.text.includes("123456789"), "Unmasked synthetic TIN appeared in response");
}

async function createContractor({ request, expectStatus }, org, cookie, name, nonce) {
  const response = expectStatus(await request("/api/contractors", {
    method: "POST", cookie, body: {
      organizationId: org.id, name, email: "mny02-" + randomUUID() + "@example.invalid",
      country: "PH", currency: "PHP", rate: "1500.00", rateType: "monthly",
      tin: "123456789", withholdingAtc: "WC180", withholdingRate: "5",
    },
  }), 201, "Actual owned synthetic contractor POST succeeds");
  assert.equal(response.json?.organizationId, org.id);
  assert.equal(response.json?.name, name);
  assert.ok(Number.isSafeInteger(response.json?.id));
  assert.equal(response.json?.tin, "••••6789", "API must mask fictional TIN in its response");
  const [persisted] = await db.select().from(contractors).where(eq(contractors.id, response.json.id));
  assert.equal(persisted?.organizationId, org.id, "Owned contractor POST must persist the real employer FK");
  assert.equal(persisted?.name, name);
  assert.ok(persisted.tin?.startsWith("enc:govid:v1:"), "Synthetic TIN must be encrypted at rest");
  return persisted;
}

async function recordPayment({ request, expectStatus }, org, cookie, contractorId, label) {
  const response = expectStatus(await request("/api/contractors/payments", {
    method: "POST", cookie, body: {
      organizationId: org.id, contractorId,
      grossAmountPhp: 1000, paymentDate: PAYMENT_DATE,
      reference: "fictional-" + label,
    },
  }), 201, "Actual owned synthetic contractor EWT payment record POST succeeds");
  assert.equal(response.json?.contractor?.id, contractorId);
  assert.equal(response.json?.payment?.organizationId, org.id);
  assert.equal(response.json?.payment?.contractorId, contractorId);
  assert.equal(response.json?.payment?.withholdingAmount, "50.00");
  const [saved] = await db.select().from(contractorPayments).where(eq(contractorPayments.id, response.json.payment.id));
  assert.equal(saved?.organizationId, org.id);
  assert.equal(saved?.contractorId, contractorId);
  return saved;
}

export async function verifyMny02ContractorTenantIsolation(f, { request, expectStatus }) {
  assertIsolated();
  const helpers = { request, expectStatus };
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const victim = f.orgs[0];
  const attackers = [];

  // Seed authenticated attacker B and C's actual objects before any victim
  // contractor/payment IDs; four payment rows per employer give high victim IDs.
  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownedContractors = [];
    const ownedPayments = [];
    for (let k = 0; k < 5; k++) {
      ownedContractors.push(await createContractor(
        helpers, org, cookie, "MNY02 OWN " + idx + " " + k + " " + nonce, nonce,
      ));
    }
    for (let k = 0; k < 4; k++) {
      ownedPayments.push(await recordPayment(helpers, org, cookie, ownedContractors[k].id, idx + "-" + k));
    }
    attackers.push({ org, cookie, ownedContractors, ownedPayments });
  }
  const victimName = "MNY02 VICTIM ONLY " + nonce;
  const victimContract = await createContractor(
    helpers, victim, f.ownerSessions[0].cookie, victimName, nonce,
  );
  const victimPayment = await recordPayment(
    helpers, victim, f.ownerSessions[0].cookie, victimContract.id, "victim",
  );
  assert.ok(victimContract.id > 6 && victimPayment.id > 6,
    "Real victim-only contractor and payment IDs must exceed historical IDs 1..6");
  for (const attacker of attackers) {
    assert.ok(attacker.ownedContractors.every(row => row.id < victimContract.id));
    assert.ok(attacker.ownedPayments.every(row => row.id < victimPayment.id));
  }
  const [actualVictimContract] = await db.select().from(contractors)
    .where(eq(contractors.id, victimContract.id)).limit(1);
  const [actualVictimPayment] = await db.select().from(contractorPayments)
    .where(eq(contractorPayments.id, victimPayment.id)).limit(1);
  assert.equal(actualVictimContract.organizationId, victim.id);
  assert.equal(actualVictimPayment.organizationId, victim.id);
  assert.equal(actualVictimPayment.contractorId, victimContract.id);
  const originalVictim = await victimSnapshot(victim.id);

  for (const attacker of attackers) {
    const { org, cookie, ownedContractors, ownedPayments } = attacker;
    const ownGet = expectStatus(await request("/api/contractors?organizationId=" + org.id, { cookie }),
      200, "Own contractor GET returns real populated company-wide records");
    assert.ok(Array.isArray(ownGet.json) && ownedContractors.every(row =>
      ownGet.json.some(item => item.id === row.id && item.organizationId === org.id)));
    assert.ok(!ownGet.json.some(item => item.id === victimContract.id));
    const foreignGet = expectStatus(await request("/api/contractors?organizationId=" + victim.id, { cookie }),
      403, "Foreign employer contractor GET explicitly denied");
    noVictimResponse(foreignGet, victimName);
    const forgedGet = expectStatus(await request(
      "/api/contractors?organizationId=" + org.id + "&contractorId=" + victimContract.id, { cookie }),
    200, "Extra forged contractor selector cannot expand owned GET");
    assert.ok(forgedGet.json.some(item => item.id === ownedContractors[0].id));
    assert.ok(!forgedGet.json.some(item => item.id === victimContract.id));

    const foreignPost = expectStatus(await request("/api/contractors", {
      method: "POST", cookie, body: {
        organizationId: victim.id, name: "Forged tenant contractor",
        email: "not-real@example.invalid", rate: 100,
      },
    }), 403, "Foreign organization POST denied before any insert");
    noVictimResponse(foreignPost, victimName);

    const foreignPatch = expectStatus(await request("/api/contractors", {
      method: "PATCH", cookie, body: {
        id: victimContract.id, organizationId: org.id, name: "Attempted victim overwrite",
      },
    }), 403, "PATCH with real foreign contractor ID denied");
    noVictimResponse(foreignPatch, victimName);
    const patchedName = "MNY02 owned edited " + org.id;
    const ownPatch = expectStatus(await request("/api/contractors", {
      method: "PATCH", cookie, body: {
        id: ownedContractors[0].id, organizationId: victim.id, name: patchedName,
      },
    }), 200, "Own contractor PATCH ignores forged body employer selector");
    assert.equal(ownPatch.json?.id, ownedContractors[0].id);
    assert.equal(ownPatch.json?.organizationId, org.id);
    assert.equal(ownPatch.json?.name, patchedName);
    const [actualOwnPatch] = await db.select().from(contractors)
      .where(eq(contractors.id, ownedContractors[0].id));
    assert.equal(actualOwnPatch?.organizationId, org.id);
    assert.equal(actualOwnPatch?.name, patchedName);

    const foreignDelete = expectStatus(await request(
      "/api/contractors?id=" + victimContract.id + "&organizationId=" + org.id,
      { method: "DELETE", cookie },
    ), 403, "DELETE of real victim contractor ID denied");
    noVictimResponse(foreignDelete, victimName);
    const noPaymentsContract = ownedContractors.at(-1);
    const ownDelete = expectStatus(await request(
      "/api/contractors?id=" + noPaymentsContract.id + "&organizationId=" + victim.id,
      { method: "DELETE", cookie },
    ), 200, "DELETE owned unused contractor ignores forged employer selector");
    assert.equal(ownDelete.json?.success, true);
    assert.equal((await db.select().from(contractors)
      .where(eq(contractors.id, noPaymentsContract.id))).length, 0);

    const ownReport = expectStatus(await request(
      "/api/contractors/payments?organizationId=" + org.id + "&month=" + PERIOD, { cookie }),
    200, "Owned EWT GET contains real recorded money-path source rows");
    assert.equal(ownReport.json?.form, "0619-E");
    assert.ok(ownedPayments.every(row => ownReport.json?.payments?.some(p =>
      p.id === row.id && p.organizationId === org.id && p.contractorId === row.contractorId)));
    assert.ok(!ownReport.json.payments.some(p => p.id === victimPayment.id));
    const foreignReport = expectStatus(await request(
      "/api/contractors/payments?organizationId=" + victim.id + "&month=" + PERIOD, { cookie }),
    403, "Foreign EWT GET denied");
    noVictimResponse(foreignReport, victimName);
    const forgedReport = expectStatus(await request(
      "/api/contractors/payments?organizationId=" + org.id + "&month=" + PERIOD
        + "&contractorId=" + victimContract.id, { cookie }),
    200, "Forged query contractorId must not expand owned EWT GET");
    assert.ok(forgedReport.json?.payments?.some(p => p.id === ownedPayments[0].id));
    assert.ok(!forgedReport.json.payments.some(p => p.id === victimPayment.id));

    const csv = expectStatus(await request(
      "/api/contractors/payments?organizationId=" + org.id + "&month=" + PERIOD + "&format=csv",
      { cookie },
    ), 200, "Owned EWT CSV contains actual nonempty contribution totals");
    assert.match(csv.headers.get("content-type") || "", /text\/csv/);
    assert.match(csv.text, /WC180/);
    noVictimResponse(csv, victimName);

    const foreignPaymentPost = expectStatus(await request("/api/contractors/payments", {
      method: "POST", cookie, body: {
        organizationId: victim.id, contractorId: victimContract.id,
        grossAmountPhp: 300, paymentDate: PAYMENT_DATE,
      },
    }), 403, "POST with real victim employer and contractor denied");
    noVictimResponse(foreignPaymentPost, victimName);
    const mismatchedContractorPost = expectStatus(await request("/api/contractors/payments", {
      method: "POST", cookie, body: {
        organizationId: org.id, contractorId: victimContract.id,
        grossAmountPhp: 300, paymentDate: PAYMENT_DATE,
      },
    }), 404, "Forged victim contractor ID in owned employer POST rejected");
    noVictimResponse(mismatchedContractorPost, victimName);

    // A source-reachable integrity flaw: FK only enforces contractor existence,
    // not organization equality. Inject ONE fictional legacy misattribution
    // directly into disposable PG. GET must fail closed, not include any victim
    // contractor identity and not silently understate the owned report total.
    const [corrupt] = await db.insert(contractorPayments).values({
      organizationId: org.id, contractorId: victimContract.id,
      paymentDate: PAYMENT_DATE, grossAmountPhp: "100.00",
      withholdingAtc: "WC180", withholdingRate: "5.000",
      withholdingAmount: "5.00", netAmountPhp: "95.00",
      reference: "fictional-foreign-attribution-" + nonce,
      createdBy: "MNY02 isolated test only",
    }).returning();
    try {
      const blockedJson = expectStatus(await request(
        "/api/contractors/payments?organizationId=" + org.id + "&month=" + PERIOD,
        { cookie },
      ), 409, "Read fails closed on non-NULL foreign contractor FK");
      noVictimResponse(blockedJson, victimName);
      assert.equal(blockedJson.json?.error, "Contractor payment attribution requires review.");
      const blockedCsv = expectStatus(await request(
        "/api/contractors/payments?organizationId=" + org.id + "&month=" + PERIOD + "&format=csv",
        { cookie },
      ), 409, "CSV fails closed on the same foreign contractor FK");
      noVictimResponse(blockedCsv, victimName);
      assert.doesNotMatch(blockedCsv.headers.get("content-type") ?? "", /text\/csv/);
    } finally {
      await db.delete(contractorPayments).where(eq(contractorPayments.id, corrupt.id));
    }
    const restored = expectStatus(await request(
      "/api/contractors/payments?organizationId=" + org.id + "&month=" + PERIOD,
      { cookie },
    ), 200, "Owned real EWT report must recover once fictional mismatch is cleared");
    assert.ok(restored.json?.payments?.some(p => p.id === ownedPayments[0].id));
    assert.ok(!restored.json?.payments?.some(p => p.id === victimPayment.id));
  }

  assert.deepEqual(await victimSnapshot(victim.id), originalVictim,
    "Every forged/denied contractor and EWT request preserves victim contractor, payment, audit and payroll records");
  console.log("MNY02-CONTRACTORS PASS: 6 real HTTP methods; 2 independent employers; foreign 403/404, own CRUD/payment, exact victim SQL invariants and cross-FK 409/CSV fail-closed (fictional PG16 only)");
}
