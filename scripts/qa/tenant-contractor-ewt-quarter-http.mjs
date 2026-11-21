/**
 * Contractor quarterly EWT GET: isolated PG16 real HTTP, two fictional employers.
 * Nonempty own/foreign/forged tests, exact victim DB invariant, malformed data
 * and multi-entity source-attribution refusal. Never run on production/Neon.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, contractorPayments, contractors, legalEntities,
  organizations, sessions, userOrganizations, users,
} from "../../src/db/schema";
import { encryptGovernmentId } from "../../src/lib/government-id-crypto";

const HOST = "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const ROUTE = "/api/contractors/ewt-quarter";

function assertIsolated() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "GitHub disposable runner only");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, HOST);
  assert.equal(process.env.DATABASE_URL, DB);
  for (const key of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_BILLING_ENABLED", "PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED",
    "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED",
  ]) assert.notEqual(process.env[key], "true", key + " must be OFF");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.ok(!process.env[key], "Provider secret may not enter this isolated test");
  }
}
async function mintOwner(org, label, nonce) {
  const [user] = await db.insert(users).values({
    email: "ewt-quarter-" + label + "-" + nonce + "@example.invalid",
    name: "Fictional " + label, passwordHash: "no-real-login", role: "owner",
  }).returning({ id: users.id });
  await db.insert(userOrganizations).values({ userId: user.id, organizationId: org.id, role: "owner", active: true });
  const raw = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: user.id, tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 3600000), lastSeenAt: new Date(),
    mfaVerifiedAt: new Date(), authMethod: "oidc",
  });
  return "__Host-linaw_session=" + raw;
}
async function newContractor(org, label, suffix, tin = "123456789") {
  const [row] = await db.insert(contractors).values({
    organizationId: org.id, name: label,
    email: "fictional-" + suffix + "@example.invalid", country: "PH",
    currency: "PHP", rate: "1000.00", rateType: "monthly",
    tin: encryptGovernmentId(tin, { required: true }),
    withholdingAtc: "WI010", withholdingRate: "10.000",
  }).returning({ id: contractors.id, organizationId: contractors.organizationId, name: contractors.name });
  return row;
}
async function pay(org, contractorId, day, gross, atc, rate, tax) {
  const [row] = await db.insert(contractorPayments).values({
    organizationId: org.id, contractorId,
    paymentDate: day, grossAmountPhp: gross,
    withholdingAtc: atc, withholdingRate: rate,
    withholdingAmount: tax, netAmountPhp: (Number(gross) - Number(tax)).toFixed(2),
    createdBy: "Fictional PG16 tenant proof only",
  }).returning({ id: contractorPayments.id });
  return row;
}
async function request(path, cookie, headers = {}) {
  const res = await fetch(HOST + path, {
    method: "GET", headers: cookie ? { cookie, ...headers } : headers,
    redirect: "manual", cache: "no-store",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* never assume HTML is JSON */ }
  return { status: res.status, text, json, headers: res.headers };
}
function status(res, code, label) {
  assert.equal(res.status, code, label + ": HTTP " + res.status + " " + res.text.slice(0, 100));
  return res;
}
function noVictim(res, victimName, victimId, paymentId) {
  assert.ok(!res.text.includes(victimName), "Foreign payee name leaked");
  assert.ok(!res.text.includes('"contractorId":' + victimId), "Foreign payee ID leaked");
  assert.ok(!res.text.includes('"paymentIds":[' + paymentId), "Foreign payment ID leaked");
}
async function snapshot(orgId) {
  return {
    legalEntities: await db.select().from(legalEntities).where(eq(legalEntities.organizationId, orgId)).orderBy(legalEntities.id),
    contractors: await db.select().from(contractors).where(eq(contractors.organizationId, orgId)).orderBy(contractors.id),
    payments: await db.select().from(contractorPayments).where(eq(contractorPayments.organizationId, orgId)).orderBy(contractorPayments.id),
    audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id),
  };
}
async function main() {
  assertIsolated();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const [own, victim] = await db.insert(organizations).values([
    { name: "EWT Own " + nonce, legalName: "Fictional Own " + nonce },
    { name: "EWT Victim " + nonce, legalName: "Fictional Victim " + nonce },
  ]).returning({ id: organizations.id });
  const [ownEntity, victimEntity] = await db.insert(legalEntities).values([
    { organizationId: own.id, code: "PRIMARY", legalName: "Fictional Own Legal", displayName: "Own Legal", primaryEntity: true },
    { organizationId: victim.id, code: "PRIMARY", legalName: "Fictional Victim Legal", displayName: "Victim Legal", primaryEntity: true },
  ]).returning({ id: legalEntities.id });
  const ownCookie = await mintOwner(own, "own", nonce);
  const victimCookie = await mintOwner(victim, "victim", nonce);
  for (let i = 0; i < 7; i++) await newContractor(own, "Fictional filler " + i, nonce + "-f" + i);
  const a = await newContractor(own, "Fictional Design Studio " + nonce, nonce + "-a");
  const b = await newContractor(own, "Fictional Lessor " + nonce, nonce + "-b", "987654321");
  const victimName = "Victim-only fictional payee " + nonce;
  const v = await newContractor(victim, victimName, nonce + "-v");
  assert.ok(v.id > 6 && v.id > a.id && v.id > b.id, "Real, higher-ID victim payee (not a guessed 1..6)");

  const paymentIds = [];
  for (const [contractorId, day, gross, atc, rate, tax] of [
    [a.id, "2026-07-10", "50000.00", "WI010", "10.000", "5000.00"],
    [a.id, "2026-08-20", "30000.00", "WI010", "10.000", "3000.00"],
    [a.id, "2026-09-05", "20000.00", "WI010", "10.000", "2000.00"],
    [a.id, "2026-08-01", "10000.00", "WI011", "15.000", "1500.00"],
    [b.id, "2026-07-01", "40000.00", "WC100", "5.000", "2000.00"],
    [b.id, "2026-09-30", "60000.00", "WC100", "5.000", "3000.00"],
  ]) paymentIds.push((await pay(own, contractorId, day, gross, atc, rate, tax)).id);
  const victimPayment = await pay(victim, v.id, "2026-08-01", "12000.00", "WI010", "10.000", "1200.00");
  assert.ok(victimPayment.id > Math.max(...paymentIds), "Real persisted victim payment after own payments");
  const beforeVictim = await snapshot(victim.id);

  const ownURL = ROUTE + "?organizationId=" + own.id + "&legalEntityId=" + ownEntity.id + "&year=2026&quarter=3";
  const victimURL = ROUTE + "?organizationId=" + victim.id + "&legalEntityId=" + victimEntity.id + "&year=2026&quarter=3";
  status(await request(ownURL, null), 401, "Anonymous denial");
  const ownReport = status(await request(ownURL, ownCookie), 200,
    "1 legitimate populated own quarterly report");
  assert.match(ownReport.headers.get("cache-control") ?? "", /(?:^|,\s*)no-store(?:,|$)/, "Sensitive report must explicitly disable caching");
  assert.equal(ownReport.json?.filingReady, false);
  assert.equal(ownReport.json?.reviewable, true);
  assert.equal(ownReport.json?.sourceSchedule, true);
  assert.deepEqual(ownReport.json?.issues, []);
  assert.deepEqual(ownReport.json?.totals, {
    totalIncome: "210000.00", taxWithheld: "16500.00", payments: 6,
  }, "Independent hand-derived totals, not recomputed by the application");
  assert.equal(ownReport.json?.payees?.length, 2);
  assert.deepEqual(ownReport.json.payees.find(p => p.contractorId === a.id).lines
    .find(l => l.atc === "WI010").months, ["50000.00", "30000.00", "20000.00"]);
  assert.deepEqual(ownReport.json.byAtc.map(x => [x.atc, x.totalIncome, x.taxWithheld]), [
    ["WC100", "100000.00", "5000.00"],
    ["WI010", "100000.00", "10000.00"],
    ["WI011", "10000.00", "1500.00"],
  ]);
  assert.ok(paymentIds.every(id => ownReport.json.payees.some(p => p.lines.some(l => l.paymentIds.includes(id)))));
  noVictim(ownReport, victimName, v.id, victimPayment.id);

  const foreign = status(await request(victimURL, ownCookie), 403,
    "2 real victim employer denied");
  noVictim(foreign, victimName, v.id, victimPayment.id);
  const otherDirection = status(await request(ownURL, victimCookie), 403,
    "Reverse foreign employer denied");
  noVictim(otherDirection, victimName, v.id, victimPayment.id);

  status(await request(ownURL.replace("legalEntityId=" + ownEntity.id,
    "legalEntityId=" + victimEntity.id), ownCookie), 403,
    "4 foreign legalEntityId rejected");
  status(await request(ownURL + "&contractorId=" + v.id, ownCookie), 404,
    "4 forged foreign payee rejected");
  status(await request(ownURL + "&contractorId=" + a.id, ownCookie), 200,
    "Legitimate own payee selection succeeds");
  status(await request(ownURL.replace("&legalEntityId=" + ownEntity.id, ""), ownCookie), 400,
    "Missing legal-employer selector denied");
  status(await request(ownURL + "&legalEntityId=" + victimEntity.id, ownCookie), 400,
    "Duplicate legal-entity selector denied");
  status(await request(ownURL, ownCookie, { "x-legal-entity-id": String(victimEntity.id) }), 403,
    "Forged inconsistent header selector denied");

  // 0011 allows a foreign contractor FK on an owned payment. The entire
  // quarter must fail closed; an optional own-payee filter must not hide it.
  const [misattributed] = await db.insert(contractorPayments).values({
    organizationId: own.id, contractorId: v.id, paymentDate: "2026-07-15",
    grossAmountPhp: "100.00", withholdingAtc: "WI010",
    withholdingRate: "10.000", withholdingAmount: "10.00",
    netAmountPhp: "90.00", createdBy: "fictional cross-FK integrity probe",
  }).returning({ id: contractorPayments.id });
  try {
    const leak = status(await request(ownURL, ownCookie), 409,
      "4 persisted foreign payee attribution fails closed");
    assert.equal(leak.json?.code, "EWT_PAYMENT_ATTRIBUTION_UNVERIFIED");
    noVictim(leak, victimName, v.id, victimPayment.id);
    status(await request(ownURL + "&contractorId=" + a.id, ownCookie), 409,
      "Payee filter cannot conceal foreign attribution");
  } finally {
    await db.delete(contractorPayments).where(eq(contractorPayments.id, misattributed.id));
  }

  // Existing source does not attribute payments to legalEntityId. Refuse
  // second active entity rather than silently relabel every payment.
  const [anotherEntity] = await db.insert(legalEntities).values({
    organizationId: own.id, code: "SECOND", legalName: "Fictional Second Legal",
    displayName: "Second", primaryEntity: false,
  }).returning({ id: legalEntities.id });
  try {
    const ambiguous = status(await request(ownURL, ownCookie), 409,
      "One organization with two employers refuses false attribution");
    assert.equal(ambiguous.json?.code, "EWT_LEGAL_EMPLOYER_ATTRIBUTION_UNVERIFIED");
  } finally {
    await db.delete(legalEntities).where(and(
      eq(legalEntities.id, anotherEntity.id), eq(legalEntities.organizationId, own.id)));
  }

  const restored = status(await request(ownURL, ownCookie), 200,
    "Owned data returns after fictional integrity probes are removed");
  assert.deepEqual(restored.json?.totals, ownReport.json.totals);
  assert.deepEqual(await snapshot(victim.id), beforeVictim,
    "3 real victim contractor, EWT payment, employer and audit DB rows unchanged");

  console.log("EWT-QUARTER PG16 PASS: 1 GET method; own 200, real victim 403, no victim DB change, forged employer/payee denial, cross-FK 409; 210000.00/16500.00 independent cents; fictional only; independent review PENDING.");
}
await main();
